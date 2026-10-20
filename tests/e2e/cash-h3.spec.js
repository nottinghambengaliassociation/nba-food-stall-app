/**
 * H3-* — Hotfix H3 (v1.3.1): the phone cash counter.
 *
 * Spec: CLAUDE.md -> "Hotfix H3: phone cash counter layout (v1.3.1)" items 1-8,
 * and the mock-ups design/CashCounterSmall.dc.html (menu + order bar),
 * design/CashCounterSmallOpen.dc.html (Review & send sheet) and
 * design/CashCounterSmall17.dc.html (402x694). The second and third render the
 * same component at different props, so the first is the one with the detail.
 * Plan: qa/test-plan.md section 28.
 *
 * This file tests the brief. Where the app disagrees with it, the app is wrong.
 *
 * WHERE IT RUNS. The layout applies to "the cash counter on every screen
 * narrower than 700 px", so the H3 block below runs on `phone` (390x844) and
 * on the three H3 projects `iphone13` (390x664), `iphone17` (402x694) and
 * `promax` (430x752), and is skipped at 700 px and wider. The last block is
 * the opposite: the tablet cash counter must be untouched, so it runs only at
 * 700 px and wider.
 *
 * Emulator only. Nothing here writes to live Firestore.
 */
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import {
  clearFirestore, openApp, gotoRoute, setTill, tid, boxOf, heightOf,
  addItem, placeOrder, openCashPanel, closeCashPanel, otherAmount,
  revealOtherAmount, quickTenderButtons, quickTender, tenderText,
  expectNoConsoleErrors, waitForOrders, readCollection, shot, londonDay,
  selectPayment, cashReceivedVisible,
  // Phase V (v1.4.0): Open orders replaces the recent strip and the ☰ item.
  openOpenOrders, openOrdersPanel, openOrderRow, listedOpenOrders, cancelOrderWithReason
} from './helpers.js';

/**
 * CLAUDE.md -> Menu: exactly eight items, in sort order. Phase V (v1.4.0)
 * adds `samosa_chat` and keeps the H3 geometry: "It appears last on the till
 * (8 tiles, still no scrolling at 390×664 on phone)".
 */
const MENU_IDS = ['fuchka', 'momo', 'chat', 'sweet_box', 'samosa_only', 'choc_strawberry', 'marshmallow', 'samosa_chat'];
/** Ids H3 deletes outright: "Don't reuse those ids." */
const GONE_IDS = ['fountain', 'samosa', 'straw'];

const HEADER_MAX = 56;      // CLAUDE.md H3 1: "Header, one row, 52 px"
const HEADER_TARGET = 52;
const TILE_TARGET = 112;    // H3 2: "about 112 px tall"
const ICON_TARGET = 40;     // H3 2: "icon 40 px"
const BAR_TARGET = 60;      // H3 3 and 4: the order bar and the Send footer
const MENU_BUTTON = 44;     // H3 1: "a ☰ button (44 px)"
const STEPPER_MIN = 48;     // H3 4: "steppers 48 px"
const SHEET_TOP = 40;       // H3 4: "top offset 40 px"
const TOL = 1;
const SIZE_TOL = 1.5;

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100;

/* ===================================================================== H3
 * Everything below 700 px.
 */
test.describe('H3 the small cash counter', () => {
  test.skip(({ viewport }) => !viewport || viewport.width >= 700,
    'CLAUDE.md H3: the rebuilt cash counter applies below 700 px only');

  test.beforeEach(async () => { await clearFirestore(); });

  /** Open #/cash and wait for the tiles. */
  async function openCash(page) {
    const errors = await openApp(page, '#/cash');
    await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(300);
    return errors;
  }

  /* ------------------------------------------------------------- H3-a 1 */

  test('H3-a1 the header is one row, at most 56px tall, and nothing in it wraps', async ({ page }, info) => {
    const errors = await openCash(page);
    const header = page.locator('header').first();
    const geo = await header.evaluate((el) => {
      const hr = el.getBoundingClientRect();
      const kids = [...el.querySelectorAll('*')]
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
        })
        .map((n) => {
          const r = n.getBoundingClientRect();
          return {
            what: n.dataset.testid || n.getAttribute('aria-label') || n.tagName.toLowerCase(),
            top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height
          };
        });
      return {
        height: hr.height, top: hr.top, bottom: hr.bottom, right: hr.right,
        viewport: window.innerWidth,
        kids,
        text: (el.innerText || '').replace(/\s+/g, ' ').trim()
      };
    });

    expect(geo.height,
      `CLAUDE.md H3 1: "Header, one row, 52 px". At ${info.project.name} ` +
      `(${geo.viewport}px wide) the header is ${r2(geo.height)}px tall.`
    ).toBeLessThanOrEqual(HEADER_MAX);
    expect(geo.height, 'the header must still be a real bar, not collapsed').toBeGreaterThanOrEqual(44);
    expect(Math.abs(geo.height - HEADER_TARGET),
      `the mock-up draws a 52px header; this one is ${r2(geo.height)}px`
    ).toBeLessThanOrEqual(6);

    // One row: every visible child sits inside the header band, so nothing has
    // wrapped onto a second line.
    const spilled = geo.kids.filter((k) => k.bottom > geo.bottom + TOL || k.top < geo.top - TOL);
    expect(spilled.map((k) => `${k.what} (${r2(k.top)}..${r2(k.bottom)})`),
      `CLAUDE.md H3 1: the header is one row; these children fall outside the ` +
      `${r2(geo.top)}..${r2(geo.bottom)} band:\n${JSON.stringify(spilled, null, 1)}`
    ).toEqual([]);

    // Nothing in the header runs past the right edge.
    const wide = geo.kids.filter((k) => k.right > geo.right + TOL).map((k) => k.what);
    expect(wide, 'no header control may spill past the right edge').toEqual([]);

    await expectNoConsoleErrors(errors, '#/cash header');
  });

  test('H3-a2 the header carries the till picker, a connection label, the next number and ☰', async ({ page }) => {
    await openCash(page);
    const header = page.locator('header').first();

    const till = tid(page, 'till-select');
    await expect(till, 'CLAUDE.md H3 1: a till picker in the header').toBeVisible();
    expect(await till.evaluate((el) => !!el.closest('header')), 'the till picker is in the header').toBe(true);
    expect(norm(await header.innerText()), 'the mock-up reads "Till A"').toMatch(/Till\s*A/i);

    const pill = tid(page, 'conn-pill');
    await expect(pill, 'CLAUDE.md H3 1: a connection dot with a short label').toBeVisible();
    await expect(pill, 'online reads "Online" (the long "Online · synced" is the tablet form)')
      .toContainText(/Online/i, { timeout: 20000 });
    expect(norm(await pill.innerText()).length,
      'CLAUDE.md H3 1: a SHORT label in a 52px one-row header'
    ).toBeLessThanOrEqual(22);

    // CLAUDE.md Phase V 1: the header gains an "Orders" button with a count
    // badge between the connection dot and ☰, and "Next A-045" moves into the
    // ☰ menu above the version line.
    const orders = tid(page, 'open-orders');
    await expect(orders, 'CLAUDE.md Phase V 1: an Orders button in the phone header').toBeVisible();
    expect(norm(await orders.innerText()) + ((await orders.getAttribute('aria-label')) || ''),
      'CLAUDE.md Phase V 1: it reads "Orders" with the count'
    ).toMatch(/Orders/i);
    expect(norm(await header.innerText()),
      'CLAUDE.md Phase V 1: "Next A-045" moves into the ☰ menu'
    ).not.toMatch(/Next\s+A-\d{3}/);
    await tid(page, 'menu-button').click();
    expect(norm(await tid(page, 'app-menu').innerText()), 'CLAUDE.md Phase V 1: "Next A-045"').toMatch(/Next\s+A-\d{3}/);
    await page.keyboard.press('Escape');

    const menuBtn = tid(page, 'menu-button');
    const box = await boxOf(menuBtn);
    expect(box, 'the ☰ button is missing').not.toBeNull();
    expect(box.width, `☰ is ${r2(box.width)}px wide; CLAUDE.md H3 1 says 44px`).toBeGreaterThanOrEqual(MENU_BUTTON - SIZE_TOL);
    expect(box.height, `☰ is ${r2(box.height)}px tall; CLAUDE.md H3 1 says 44px`).toBeGreaterThanOrEqual(MENU_BUTTON - SIZE_TOL);
    expect(await menuBtn.getAttribute('aria-expanded'), 'CLAUDE.md H3 1: ☰ carries aria-expanded').toBe('false');
  });

  test('H3-a3 the till picker reads and writes the landing page till letter', async ({ page }) => {
    await openApp(page, '#/');
    await setTill(page, 'B');

    await gotoRoute(page, '#/cash');
    await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
    const select = tid(page, 'till-select');
    await expect(select).toBeVisible();
    expect(await select.inputValue(),
      'CLAUDE.md H3 1: the till picker uses "the same stored till letter as the landing page"'
    ).toBe('B');
    // Phase V 1: the next number lives in the ☰ menu now.
    await tid(page, 'menu-button').click();
    await expect(tid(page, 'app-menu')).toContainText(/Next\s+B-001/);
    await page.keyboard.press('Escape');

    // ... and the other way round.
    await select.selectOption('C');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/till/i.test(k)) return localStorage.getItem(k);
      }
      return null;
    }), 'changing the till in the header must store the letter').toBe('C');

    await gotoRoute(page, '#/');
    const landing = tid(page, 'till-letter');
    await expect(landing).toBeVisible();
    expect(await landing.inputValue(),
      'the landing page must show the letter the cash header just set'
    ).toBe('C');
  });

  test('H3-a4 "Next A-0NN" tracks the next sequence number, inside the ☰ menu', async ({ page }) => {
    await openCash(page);
    // CLAUDE.md Phase V 1: "Next A-045" moves into the ☰ menu above the
    // version line; the header bar keeps the till, the dot, Orders and ☰.
    const nextText = async () => {
      await tid(page, 'menu-button').click();
      await expect(tid(page, 'app-menu')).toBeVisible();
      const text = norm(await tid(page, 'app-menu').innerText());
      await page.keyboard.press('Escape');
      await expect(tid(page, 'app-menu')).toBeHidden({ timeout: 5000 });
      return text;
    };

    expect(await nextText(), 'a fresh till is about to issue A-001').toMatch(/Next\s+A-001/);

    const no = await placeOrder(page, { items: { momo: 1 }, name: 'Seq', payment: 'card' });
    expect(no).toBe('A-001');
    expect(await nextText(), 'after A-001 the menu must advertise A-002').toMatch(/Next\s+A-002/);

    await placeOrder(page, { items: { momo: 1 }, payment: 'card' });
    expect(await nextText()).toMatch(/Next\s+A-003/);
  });

  /* ------------------------------------------------------- H3-a: the menu */

  test('H3-a5 ☰ opens a menu with Food counter, Reports, Sign out, the next number and the version', async ({ page }) => {
    const errors = await openCash(page);
    const button = tid(page, 'menu-button');
    const menu = tid(page, 'app-menu');

    await expect(menu).toBeHidden();
    await button.click();
    await expect(menu, 'CLAUDE.md H3 1: ☰ opens a dropdown').toBeVisible();
    expect(await button.getAttribute('aria-expanded')).toBe('true');

    // CLAUDE.md Phase V 1: "The ☰ Recent orders item is removed" (Open orders
    // replaces it, from its own header button).
    expect(await tid(page, 'menu-recent').count(),
      'CLAUDE.md Phase V 1: the ☰ Recent orders item is removed'
    ).toBe(0);
    expect(norm(await menu.innerText()),
      'CLAUDE.md Phase V 1: "Next A-045" moves into the ☰ menu above the version line'
    ).toMatch(/Next\s+[A-Z]-\d{3}/);

    for (const [name, label] of [
      ['menu-food', /Food counter/i],
      ['menu-reports', /Reports/i],
      ['menu-signout', /Sign out/i]
    ]) {
      const item = tid(page, name);
      await expect(item, `CLAUDE.md H3 1: the ☰ menu lists ${name}`).toBeVisible();
      expect(norm(await item.innerText()), `${name} label`).toMatch(label);
      const h = await heightOf(item);
      expect(h, `${name} is ${r2(h)}px tall; CLAUDE.md Design: touch targets at least 48px`).toBeGreaterThanOrEqual(47.5);
    }

    expect(norm(await menu.innerText()), 'CLAUDE.md H3 1: the menu ends with the version line')
      .toMatch(/v\d+\.\d+\.\d+|dev/);

    // Sign out is the red one (CLAUDE.md H3 1).
    const colour = await tid(page, 'menu-signout').evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = (colour.match(/\d+/g) || []).map(Number);
    expect(r > 120 && g < 90 && b < 90,
      `Sign out is ${colour}; CLAUDE.md H3 1 draws it red (#B5050F)`).toBe(true);

    await expectNoConsoleErrors(errors, '#/cash ☰ menu');
  });

  test('H3-a6 the menu closes on an outside tap, on Escape and on choosing an item', async ({ page }) => {
    await openCash(page);
    const button = tid(page, 'menu-button');
    const menu = tid(page, 'app-menu');

    // (a) outside tap
    await button.click();
    await expect(menu).toBeVisible();
    await tid(page, 'tile-fuchka').click({ position: { x: 5, y: 5 } });
    await expect(menu, 'CLAUDE.md H3 1: "It closes on outside tap"').toBeHidden({ timeout: 5000 });
    expect(await button.getAttribute('aria-expanded')).toBe('false');

    // (b) Escape
    await button.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu, 'CLAUDE.md H3 1: "... Escape"').toBeHidden({ timeout: 5000 });
    expect(await button.getAttribute('aria-expanded')).toBe('false');

    // (c) choosing an item (Recent orders is gone in Phase V, so this uses
    // Food counter, which also proves the menu closes on navigation)
    await button.click();
    await expect(menu).toBeVisible();
    await tid(page, 'menu-food').click();
    await expect(menu, 'CLAUDE.md H3 1: "... or choosing an item"').toBeHidden({ timeout: 5000 });
  });

  test('H3-a7 every menu item goes where it says', async ({ page }) => {
    await openCash(page);
    const open = async () => {
      await tid(page, 'menu-button').click();
      await expect(tid(page, 'app-menu')).toBeVisible();
    };

    await open();
    await tid(page, 'menu-food').click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10000 }).toBe('#/kitchen');

    await gotoRoute(page, '#/cash');
    await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
    await open();
    await tid(page, 'menu-reports').click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10000 }).toMatch(/^#\/reports/);

    // CLAUDE.md Phase V 1: Recent orders is gone from the ☰ menu; the Open
    // orders sheet is reached from its own header button instead.
    await gotoRoute(page, '#/cash');
    await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
    await openOpenOrders(page);
    await expect(openOrdersPanel(page), 'CLAUDE.md Phase V 1: Orders opens a bottom sheet')
      .toBeVisible({ timeout: 10000 });
  });

  test('H3-a8 Sign out from the menu keeps the unsent-order confirm', async ({ page }) => {
    await openCash(page);
    await addItem(page, 'fuchka', 2);
    await page.waitForTimeout(250);

    // window.confirm must never be used (CLAUDE.md Login 8).
    let nativeConfirm = false;
    page.on('dialog', async (d) => { nativeConfirm = true; await d.dismiss(); });

    await tid(page, 'menu-button').click();
    await tid(page, 'menu-signout').click();
    await page.waitForTimeout(400);

    // The in-page confirm, under either spelling of its test id.
    const confirmBox = page.locator(
      '[data-testid="sign-out-confirm"], [data-testid="signout-confirm"], [role="dialog"][aria-labelledby*="signout"]'
    ).first();
    await expect(confirmBox,
      'CLAUDE.md H3 1 and Login 8: Sign out with items in the cart shows the in-page confirm'
    ).toBeVisible({ timeout: 10000 });
    expect(nativeConfirm, 'CLAUDE.md Login 8: "Never window.confirm"').toBe(false);
    expect(norm(await page.locator('body').innerText())).toMatch(/Discard the unsent order and sign out\?/i);

    // Cancel keeps the order and the session.
    await confirmBox.getByRole('button', { name: /^Cancel$/i }).first().click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => location.hash)).toBe('#/cash');
    await expect(tid(page, 'order-bar'), 'Cancel keeps the unsent order').toBeVisible();

    // Confirming signs out.
    await tid(page, 'menu-button').click();
    await tid(page, 'menu-signout').click();
    await expect(confirmBox).toBeVisible({ timeout: 10000 });
    await confirmBox.getByRole('button', { name: /sign out/i }).first().click();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10000 }).toBe('#/login');
    expect(await page.evaluate(() => localStorage.getItem('nba.session'))).toBeNull();
  });

  /* ------------------------------------------------------------ H3-b tiles */

  test('H3-b1 eight tiles in three columns, all on screen with nothing in the cart', async ({ page }, info) => {
    const errors = await openCash(page);

    const rendered = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
      .map((t) => t.dataset.testid.replace(/^tile-/, '')));
    expect(rendered, 'CLAUDE.md Menu after Phase V: exactly eight tiles, in sort order').toEqual(MENU_IDS);
    for (const id of GONE_IDS) {
      expect(await tid(page, `tile-${id}`).count(), `"${id}" was deleted by H3 and must not be a tile`).toBe(0);
    }

    const geo = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-testid^="tile-"]')];
      const area = tiles[0] ? tiles[0].closest('main') || tiles[0].parentElement.parentElement : null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        tiles: tiles.map((t) => {
          const r = t.getBoundingClientRect();
          const icon = t.querySelector('svg');
          const ir = icon ? icon.getBoundingClientRect() : null;
          return {
            id: t.dataset.testid.replace(/^tile-/, ''),
            top: r.top, bottom: r.bottom, left: r.left, right: r.right,
            width: r.width, height: r.height,
            icon: ir ? { w: ir.width, h: ir.height } : null,
            text: (t.innerText || '').replace(/\s+/g, ' ').trim()
          };
        }),
        area: area ? {
          scrollHeight: area.scrollHeight, clientHeight: area.clientHeight,
          top: area.getBoundingClientRect().top, bottom: area.getBoundingClientRect().bottom
        } : null
      };
    });

    // Three columns: the tiles share three distinct left edges.
    const lefts = [...new Set(geo.tiles.map((t) => Math.round(t.left)))].sort((a, b) => a - b);
    expect(lefts.length, `CLAUDE.md H3 2: "3 columns"; the tiles use ${lefts.length} left edges (${lefts})`).toBe(3);

    // Every tile fully inside the viewport, with nothing in the cart.
    const offscreen = geo.tiles.filter((t) => t.bottom > geo.viewport.height + TOL || t.top < -TOL);
    expect(offscreen.map((t) => `${t.id} ${r2(t.top)}..${r2(t.bottom)}`),
      `CLAUDE.md H3 2 + Phase V 7: all 8 tiles fit without scrolling at 390x664. At ${info.project.name} ` +
      `(${geo.viewport.width}x${geo.viewport.height}) these fall below the fold:\n` +
      JSON.stringify(geo.tiles.map((t) => ({ id: t.id, top: r2(t.top), bottom: r2(t.bottom), h: r2(t.height) })), null, 1)
    ).toEqual([]);

    // ... and the menu area itself does not need to scroll.
    expect(geo.area, 'the tiles need a scrollable menu area around them').not.toBeNull();
    expect(geo.area.scrollHeight,
      `the menu area scrolls with an empty cart (scrollHeight ${geo.area.scrollHeight} > clientHeight ${geo.area.clientHeight}); ` +
      'CLAUDE.md H3 2 (8 would too) + Phase V 7 require all 8 tiles to fit'
    ).toBeLessThanOrEqual(geo.area.clientHeight + 2);

    for (const t of geo.tiles) {
      expect(Math.abs(t.height - TILE_TARGET),
        `tile-${t.id} is ${r2(t.height)}px tall; CLAUDE.md H3 2 says "about 112 px"`
      ).toBeLessThanOrEqual(16);
      expect(t.icon, `tile-${t.id} needs an inline SVG icon`).not.toBeNull();
      expect(Math.abs(t.icon.w - ICON_TARGET),
        `tile-${t.id} icon is ${r2(t.icon.w)}px; CLAUDE.md H3 2 says 40px`
      ).toBeLessThanOrEqual(6);
      expect(t.text.length, `tile-${t.id} must show its short name`).toBeGreaterThan(1);
    }

    await expectNoConsoleErrors(errors, '#/cash tiles');
    await shot(page, info.project.name, 'cash', 'h3-empty');
  });

  test('H3-b2 tapping a tile adds one and badges it; every tile is tappable with the order bar up', async ({ page }, info) => {
    await openCash(page);
    await addItem(page, 'fuchka', 2);
    await expect(tid(page, 'qty-fuchka'), 'CLAUDE.md H3 2: quantity badge top right').toHaveText(/2/);
    const badge = await boxOf(tid(page, 'qty-fuchka'));
    const tile = await boxOf(tid(page, 'tile-fuchka'));
    expect(badge.x + badge.width, 'the badge sits at the top right of its tile')
      .toBeLessThanOrEqual(tile.x + tile.width + TOL);
    expect(badge.y, 'the badge sits at the top of its tile').toBeLessThan(tile.y + tile.height / 2);

    await expect(tid(page, 'order-bar')).toBeVisible();

    // With the bar up, every tile must still be reachable and tappable.
    for (const id of MENU_IDS) {
      const t = tid(page, `tile-${id}`);
      await t.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const hit = await t.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(x, y);
        let coverer = top;
        while (coverer && !(coverer.dataset && coverer.dataset.testid) && coverer.parentElement) coverer = coverer.parentElement;
        const name = (n) => (n ? (n.dataset && n.dataset.testid ? `[${n.dataset.testid}]` : n.tagName.toLowerCase()) : 'nothing');
        return {
          onTile: !!top && (top === el || el.contains(top)),
          inViewport: r.top >= -1 && r.bottom <= window.innerHeight + 1,
          at: name(top), covering: name(coverer),
          rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) }
        };
      });
      expect(hit.inViewport, `tile-${id} could not be scrolled fully into view: ${JSON.stringify(hit.rect)}`).toBe(true);
      expect(hit.onTile,
        `CLAUDE.md H3 2: "Bottom padding keeps the last row clear of the order bar". ` +
        `At the centre of tile-${id} the element is ${hit.at} inside ${hit.covering}.`
      ).toBe(true);
    }

    // Prove it on the last tile by tapping at its coordinates.
    const last = tid(page, `tile-${MENU_IDS[MENU_IDS.length - 1]}`);
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tid(page, `qty-${MENU_IDS[MENU_IDS.length - 1]}`),
      'a tap at the centre of the last tile must add one, not land on the order bar'
    ).toHaveText(/1/, { timeout: 5000 });

    await shot(page, info.project.name, 'cash', 'h3-bar');
  });

  /* -------------------------------------------------------- H3-c order bar */

  test('H3-c the order bar is hidden when empty, and shows the count and total', async ({ page }) => {
    await openCash(page);
    await expect(tid(page, 'order-bar'), 'CLAUDE.md H3 3: "hidden while the cart is empty"').toBeHidden();

    await addItem(page, 'fuchka', 1);
    const bar = tid(page, 'order-bar-open');
    await expect(bar).toBeVisible();
    expect(norm(await bar.innerText()), 'one item is singular in the mock-up').toMatch(/1 item\b/);
    expect(norm(await bar.innerText())).toContain('£5.00');
    expect(norm(await bar.innerText()), 'CLAUDE.md H3 3: "Review & send"').toMatch(/Review & send/i);

    await addItem(page, 'momo', 2);
    await expect(bar).toContainText('3 items');
    await expect(bar).toContainText('£15.00');

    const box = await boxOf(bar);
    expect(Math.abs(box.height - BAR_TARGET),
      `the order bar button is ${r2(box.height)}px tall; CLAUDE.md H3 3 says "one 60 px teal button"`
    ).toBeLessThanOrEqual(4);

    // Fixed to the bottom of the viewport.
    const vh = page.viewportSize().height;
    expect(vh - (box.y + box.height),
      'CLAUDE.md H3 3: the bar is fixed to the bottom (safe-area padding aside)'
    ).toBeLessThanOrEqual(40);

    // Emptying the cart takes it away again.
    await openCashPanel(page);
    for (let i = 0; i < 4; i++) {
      const dec = tid(page, 'line-dec-momo');
      if (!(await dec.count())) break;
      await dec.click();
      await page.waitForTimeout(150);
    }
    const decF = tid(page, 'line-dec-fuchka');
    if (await decF.count()) { await decF.click(); await page.waitForTimeout(200); }
    await expect(tid(page, 'order-bar'), 'an empty cart hides the bar again').toBeHidden({ timeout: 10000 });
  });

  /* ------------------------------------------------------------ H3-d sheet */

  test('H3-d1 the sheet is a dialog 40px from the top, over a backdrop', async ({ page }, info) => {
    await openCash(page);
    await addItem(page, 'fuchka', 2);
    await tid(page, 'order-bar-open').click();

    const sheet = tid(page, 'review-sheet');
    await expect(sheet).toBeVisible({ timeout: 10000 });
    expect(await sheet.getAttribute('role'), 'CLAUDE.md H3 4: role="dialog"').toBe('dialog');

    // Measured in the page so a scrolled document cannot shift the reading of
    // a position:fixed element.
    const geo = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="review-sheet"]');
      const r = el.getBoundingClientRect();
      return {
        top: r.top, bottom: r.bottom, height: r.height,
        scrollY: window.scrollY, viewport: window.innerHeight,
        position: getComputedStyle(el).position, cssTop: getComputedStyle(el).top
      };
    });
    expect(Math.abs(geo.top - SHEET_TOP),
      `the sheet starts at y=${r2(geo.top)} (css ${geo.position} top:${geo.cssTop}, scrollY ${geo.scrollY}); ` +
      'CLAUDE.md H3 4 says "top offset 40 px"'
    ).toBeLessThanOrEqual(4);
    expect(geo.bottom, 'the sheet reaches the bottom of the screen').toBeGreaterThanOrEqual(geo.viewport - 2);

    // A dimmed backdrop behind it.
    const backdrop = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('body *')];
      const found = nodes.find((n) => {
        const c = getComputedStyle(n);
        if (c.position !== 'fixed' && c.position !== 'absolute') return false;
        const r = n.getBoundingClientRect();
        if (r.width < window.innerWidth - 2 || r.height < window.innerHeight - 2) return false;
        const m = c.backgroundColor.match(/rgba?\(([^)]+)\)/);
        if (!m) return false;
        const parts = m[1].split(',').map((x) => parseFloat(x));
        const alpha = parts.length > 3 ? parts[3] : 1;
        return alpha > 0.1 && alpha < 1;
      });
      return found ? getComputedStyle(found).backgroundColor : null;
    });
    expect(backdrop, 'CLAUDE.md H3 4: the sheet "slides up over the menu" with a dimmed backdrop').not.toBeNull();

    // The order bar is not competing with the sheet footer.
    const bar = tid(page, 'order-bar');
    if (await bar.count()) {
      expect(await bar.isVisible(), 'the order bar steps aside while the sheet is open').toBe(false);
    }

    expect(norm(await sheet.innerText()), 'CLAUDE.md H3 4: header "Order · <n> items"').toMatch(/Order\s*·\s*2 items/);
    await shot(page, info.project.name, 'cash', 'h3-sheet');
  });

  test('H3-d2 Add more, Escape and the browser Back button all close the sheet', async ({ page }) => {
    await openCash(page);
    await addItem(page, 'fuchka', 2);
    const bar = tid(page, 'order-bar-open');
    const sheet = tid(page, 'review-sheet');

    // (a) Add more
    await bar.click();
    await expect(sheet).toBeVisible();
    await tid(page, 'sheet-add-more').click();
    await expect(sheet, 'CLAUDE.md H3 4: "an Add more button that closes it"').toBeHidden({ timeout: 5000 });
    await expect(tid(page, 'tile-fuchka'), 'Add more goes back to the menu').toBeVisible();

    // (b) Escape
    await bar.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet, 'CLAUDE.md H3 4: "Escape ... close it"').toBeHidden({ timeout: 5000 });

    // (c) browser Back
    await bar.click();
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet, 'CLAUDE.md H3 4: "the browser Back button close it"').toBeHidden({ timeout: 8000 });
    expect(await page.evaluate(() => location.hash),
      'Back closes the sheet; it must not leave the cash counter'
    ).toBe('#/cash');
    await expect(tid(page, 'order-bar'), 'the cart survives closing the sheet').toBeVisible();
  });

  test('H3-d3 focus moves into the sheet and back to the order bar', async ({ page }) => {
    await openCash(page);
    await addItem(page, 'fuchka', 1);
    const bar = tid(page, 'order-bar-open');
    await bar.click();
    const sheet = tid(page, 'review-sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => {
      const sheetEl = document.querySelector('[data-testid="review-sheet"]');
      const active = document.activeElement;
      return !!sheetEl && !!active && sheetEl.contains(active);
    }), 'CLAUDE.md H3 4: "Focus moves into the sheet on open"').toBe(true);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden({ timeout: 5000 });
    await expect
      .poll(() => page.evaluate(() => document.activeElement && document.activeElement.dataset.testid),
        { timeout: 5000, message: 'CLAUDE.md H3 4: "... and back to the order bar on close"' })
      .toBe('order-bar-open');
  });

  test('H3-d4 removing the last item closes the sheet', async ({ page }) => {
    await openCash(page);
    await addItem(page, 'momo', 2);
    await openCashPanel(page);
    const sheet = tid(page, 'review-sheet');
    await expect(sheet).toBeVisible();

    await tid(page, 'line-dec-momo').click();
    await page.waitForTimeout(200);
    await expect(sheet, 'one item left: the sheet stays open').toBeVisible();

    await tid(page, 'line-dec-momo').click();
    await expect(sheet, 'CLAUDE.md H3 4: "Removing the last item closes the sheet"').toBeHidden({ timeout: 8000 });
    await expect(tid(page, 'order-bar'), 'and the order bar goes with it').toBeHidden();
    await expect(tid(page, 'tile-momo')).toBeVisible();
  });

  test('H3-d5 the cart lines keep the H2 grid with 48px steppers', async ({ page }, info) => {
    await openCash(page);
    for (let i = 0; i < MENU_IDS.length; i++) await addItem(page, MENU_IDS[i], i + 1);
    await openCashPanel(page);
    for (const id of MENU_IDS) {
      await expect(tid(page, `line-${id}`), `line-${id} must be in the cart`).toHaveCount(1, { timeout: 10000 });
    }
    await page.waitForTimeout(400);

    const m = await page.evaluate((ids) => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
      };
      const q = (name) => document.querySelector(`[data-testid="${name}"]`);
      return ids.map((id) => {
        const row = q(`line-${id}`);
        const name = row ? row.querySelector('.line__name') : null;
        return {
          id,
          text: name ? (name.textContent || '').replace(/\s+/g, ' ').trim() : '',
          row: rect(row),
          name: rect(name),
          nameScrollWidth: name ? name.scrollWidth : null,
          nameClientWidth: name ? name.clientWidth : null,
          dec: rect(q(`line-dec-${id}`)),
          inc: rect(q(`line-inc-${id}`)),
          containerClientWidth: row && row.parentElement ? row.parentElement.clientWidth : null
        };
      });
    }, MENU_IDS);

    const report = m.map((r) => `${r.id.padEnd(16)}"${r.text}" dec.left=${r2(r.dec.left)} inc.left=${r2(r.inc.left)} ` +
      `dec=${r2(r.dec.width)}x${r2(r.dec.height)}`).join('\n');
    // eslint-disable-next-line no-console
    console.log(`\n[H3-d5 ${info.project.name}] sheet cart geometry\n${report}\n`);

    for (const key of ['dec', 'inc']) {
      const lefts = m.map((r) => r[key].left);
      expect(Math.max(...lefts) - Math.min(...lefts),
        `CLAUDE.md H3 4 ("the H2 aligned grid"): every row's line-${key}-* must share one left x (±${TOL}px)\n${report}`
      ).toBeLessThanOrEqual(TOL);
    }

    for (const r of m) {
      expect(r.nameScrollWidth, `"${r.text}" must wrap, not overflow\n${report}`)
        .toBeLessThanOrEqual(r.nameClientWidth + TOL);
      expect(r.name.right, `"${r.text}" must not run under its own − button\n${report}`)
        .toBeLessThanOrEqual(r.dec.left + TOL);
      expect(r.row.width, `row line-${r.id} must fit its column\n${report}`)
        .toBeLessThanOrEqual(r.containerClientWidth + TOL);
      for (const key of ['dec', 'inc']) {
        expect(r[key].width,
          `CLAUDE.md H3 4: "steppers 48 px". line-${key}-${r.id} is ${r2(r[key].width)}px wide.\n${report}`
        ).toBeGreaterThanOrEqual(STEPPER_MIN - SIZE_TOL);
        expect(r[key].height,
          `CLAUDE.md H3 4: "steppers 48 px". line-${key}-${r.id} is ${r2(r[key].height)}px tall.\n${report}`
        ).toBeGreaterThanOrEqual(STEPPER_MIN - SIZE_TOL);
      }
    }
  });

  test('H3-d6 the Send footer is visible without scrolling, even with a long cart', async ({ page }, info) => {
    await openCash(page);
    for (const id of MENU_IDS) await addItem(page, id, 1);
    await openCashPanel(page);
    await expect(tid(page, 'line-marshmallow')).toHaveCount(1, { timeout: 10000 });
    await page.waitForTimeout(400);

    const send = tid(page, 'send-order');
    await expect(send).toBeVisible();
    const geo = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="send-order"]');
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      return {
        rect: { top: r.top, bottom: r.bottom, height: r.height },
        viewport: window.innerHeight,
        onButton: !!top && (top === el || el.contains(top)),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim()
      };
    });

    expect(geo.rect.bottom,
      `CLAUDE.md H3 4: "Footer pinned ... always visible". The Send button runs to ` +
      `y=${r2(geo.rect.bottom)} in a ${geo.viewport}px viewport with all ${MENU_IDS.length} items in the cart.`
    ).toBeLessThanOrEqual(geo.viewport + TOL);
    expect(geo.rect.top, 'the Send button must be on screen').toBeGreaterThanOrEqual(-TOL);
    expect(geo.onButton, 'nothing may cover the Send button').toBe(true);
    expect(Math.abs(geo.rect.height - BAR_TARGET),
      `the Send button is ${r2(geo.rect.height)}px tall; CLAUDE.md H3 4 says 60px`
    ).toBeLessThanOrEqual(4);
    // One of each item at £5: eight after Phase V 7 added Samosa Chat.
    expect(geo.text, 'CLAUDE.md H3 4: "Send to food counter · £x.xx"')
      .toMatch(new RegExp(`Send to food counter\\s*·\\s*£${(MENU_IDS.length * 5).toFixed(2)}`));

    // Scrolling the sheet body must not take the footer with it.
    await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="review-sheet"]');
      for (const n of sheet.querySelectorAll('*')) {
        if (n.scrollHeight > n.clientHeight + 4) n.scrollTop = n.scrollHeight;
      }
    });
    await page.waitForTimeout(300);
    const after = await boxOf(send);
    expect(after.y + after.height, 'the footer stays pinned while the body scrolls')
      .toBeLessThanOrEqual(page.viewportSize().height + TOL);
  });

  test('H3-d7 the sheet holds the name, the total and the payment toggle', async ({ page }) => {
    await openCash(page);
    await addItem(page, 'fuchka', 3);
    await openCashPanel(page);

    const name = tid(page, 'customer-name');
    await expect(name, 'CLAUDE.md H3 4: "Name to call out"').toBeVisible();
    await name.fill('Priya');
    expect(await heightOf(name)).toBeGreaterThanOrEqual(47.5);

    await expect(tid(page, 'order-total')).toContainText('£15.00');
    for (const id of ['pay-cash', 'pay-card']) {
      const btn = tid(page, id);
      await expect(btn).toBeVisible();
      expect(await heightOf(btn), `${id} must be at least 48px tall`).toBeGreaterThanOrEqual(47.5);
      expect(await btn.getAttribute('aria-pressed'), `${id} exposes aria-pressed`).not.toBeNull();
    }
  });

  /* ------------------------------------------------- H3-e cash received */

  test('H3-e the cash received calculator lives in the sheet', async ({ page }) => {
    const errors = await openCash(page);
    await addItem(page, 'fuchka', 3); // £15.00
    await openCashPanel(page);
    // H4 1: the sheet starts on Card and hides the block, so Cash is tapped.
    expect(await cashReceivedVisible(page),
      'CLAUDE.md H4 1: a new order starts on Card, which hides Cash received').toBe(false);
    await selectPayment(page, 'cash');
    await page.waitForTimeout(200);

    expect(norm(await tenderText(page)), 'CLAUDE.md H3 4: "Cash received (optional)"').toMatch(/Cash received/i);

    const buttons = await quickTenderButtons(page);
    expect(await buttons.count(), 'CLAUDE.md H3 4: "quick buttons Exact, £5, £10, £20, £50"').toBe(5);
    expect((await buttons.allInnerTexts()).map(norm)).toEqual(['Exact', '£5', '£10', '£20', '£50']);
    for (let i = 0; i < 5; i++) {
      const h = await heightOf(buttons.nth(i));
      expect(h, `quick button ${i} is ${r2(h)}px tall; CLAUDE.md Cash 3: at least 44px on phone`).toBeGreaterThanOrEqual(43.5);
    }

    // Change and Short, in the short phone wording beside the label.
    await (await quickTender(page, 2000)).click();
    await page.waitForTimeout(250);
    expect(norm(await tenderText(page)), 'CLAUDE.md H3 4: "Change £x.xx" beside the label').toContain('Change £5.00');

    await (await quickTender(page, 1000)).click();
    await page.waitForTimeout(250);
    expect(norm(await tenderText(page)), 'CLAUDE.md H3 4: "Short £x.xx"').toContain('Short £5.00');

    // Tapping the selected button again deselects it.
    await (await quickTender(page, 1000)).click();
    await page.waitForTimeout(250);
    expect(norm(await tenderText(page))).not.toMatch(/Change|Short|Check amount/);

    // The Other amount link reveals the box, with the same parsing.
    const revealed = await revealOtherAmount(page);
    expect(revealed, 'CLAUDE.md H3 4: "an Other amount link that reveals the existing Other amount box"').toBe(true);
    const box = await otherAmount(page);
    await expect(box).toBeVisible();
    expect(await box.getAttribute('inputmode')).toBe('decimal');

    for (const [typed, want] of [
      ['17.50', 'Change £2.50'],
      ['17.5', 'Change £2.50'],
      ['£17.50', 'Change £2.50'],
      ['17', 'Change £2.00'],
      ['1,000', 'Change £985.00'],
      ['12', 'Short £3.00'],
      ['abc', 'Check amount']
    ]) {
      await box.fill('');
      await box.fill(typed);
      await page.waitForTimeout(250);
      expect(norm(await tenderText(page)), `typing "${typed}" on a £15.00 order should read "${want}"`).toContain(want);
    }

    // Card hides the whole block.
    await tid(page, 'pay-card').click();
    await page.waitForTimeout(300);
    await expect(tid(page, 'tender-2000'), 'Card hides the cash received block').toBeHidden();
    expect(norm(await tenderText(page))).not.toMatch(/Change|Short|Check amount/);

    await expectNoConsoleErrors(errors, '#/cash sheet cash received');
  });

  /* ------------------------------------------------------------- H3-f send */

  test('H3-f Send writes the order, clears the cart, closes the sheet and toasts', async ({ page }, info) => {
    const errors = await openCash(page);
    await addItem(page, 'fuchka', 2);
    await addItem(page, 'momo', 1);
    await openCashPanel(page);
    await tid(page, 'customer-name').fill('Priya');
    // Hotfix H4 (v1.3.2): the sheet opens on Card, so this cash order picks
    // Cash before keying £20 into the calculator.
    await selectPayment(page, 'cash');
    await (await quickTender(page, 2000)).click();
    await page.waitForTimeout(200);

    await tid(page, 'send-order').click();

    const toast = tid(page, 'order-toast');
    await expect(toast, 'CLAUDE.md H3 5: the confirmation toast').toBeVisible({ timeout: 10000 });
    expect(norm(await toast.innerText())).toMatch(/A-001/);

    await expect(tid(page, 'review-sheet'), 'CLAUDE.md H3 5: send "closes the sheet"').toBeHidden({ timeout: 8000 });
    await expect(tid(page, 'order-bar'), 'CLAUDE.md H3 5: send "clears the cart"').toBeHidden({ timeout: 8000 });
    await expect(tid(page, 'qty-fuchka')).toBeHidden();

    // The toast is on screen and not clipped.
    const tbox = await boxOf(toast);
    expect(tbox.y, 'the toast must be on screen').toBeGreaterThanOrEqual(0);
    expect(tbox.y + tbox.height, 'the toast must be on screen').toBeLessThanOrEqual(page.viewportSize().height + TOL);

    const [order] = await waitForOrders((o) => o.length === 1, { label: 'the sheet order' });
    expect(order.orderNo).toBe('A-001');
    expect(order.name).toBe('Priya');
    expect(order.total).toBe(1500);
    expect(order.payment).toBe('cash');
    expect(order.status).toBe('new');
    expect(order.till).toBe('A');
    expect(order.day).toBe(londonDay());
    expect(Object.keys(order), 'cash received is screen-only: no tendered field').not.toContain('tendered');
    expect(Object.keys(order), 'no changeGiven field').not.toContain('changeGiven');

    // 4 s, per CLAUDE.md H3 5.
    await expect(toast).toBeHidden({ timeout: 9000 });
    await expectNoConsoleErrors(errors, '#/cash send from the sheet');
    expect(info.project.name.length).toBeGreaterThan(0);
  });

  /* -------------------------------------------- H3-g / P5 open orders */

  test('H3-g the Orders button opens the Open orders sheet, with live status and Cancel', async ({ page }) => {
    const errors = await openCash(page);

    // CLAUDE.md Phase V 1 replaces both the H3 recent sheet and the Phase I
    // strip: the ☰ Recent orders item is gone and the header carries an
    // "Orders" button with a count badge.
    await placeOrder(page, { items: { momo: 1 }, name: 'One', payment: 'card' });
    await expect(tid(page, 'recent-list'),
      'CLAUDE.md Phase V 1: the recent strip is replaced by Open orders'
    ).toBeHidden();
    expect(await tid(page, 'menu-recent').count(),
      'CLAUDE.md Phase V 1: "The ☰ Recent orders item is removed"'
    ).toBe(0);

    for (let i = 2; i <= 6; i++) {
      await placeOrder(page, { items: { momo: 1 }, name: `Cust${i}`, payment: 'card' });
      await page.waitForTimeout(150);
    }

    await openOpenOrders(page);
    const sheet = openOrdersPanel(page);
    await expect(sheet, 'CLAUDE.md Phase V 1: a bottom sheet of today\'s open orders').toBeVisible({ timeout: 10000 });

    // Every open order, newest first — no five-order limit any more.
    expect(await listedOpenOrders(page),
      'CLAUDE.md Phase V 1: "today\'s orders from all tills ... newest first"'
    ).toEqual(['A-006', 'A-005', 'A-004', 'A-003', 'A-002', 'A-001']);
    expect(norm(await openOrderRow(page, 'A-006').innerText()), 'live status').toMatch(/new/i);

    // Cancel while New, through the Phase V reason dialog.
    await cancelOrderWithReason(page, 'A-006', 'mistake');
    const orders = await waitForOrders(
      (o) => o.some((x) => x.orderNo === 'A-006' && x.status === 'cancelled'),
      { label: 'A-006 to be cancelled' });
    for (const o of orders.filter((x) => x.orderNo === 'A-006')) {
      expect(o.status).toBe('cancelled');
      expect(o.cancelReason, 'CLAUDE.md Phase V 3: the reason is stored').toBe('mistake');
    }
    await openOpenOrders(page);
    await expect
      .poll(async () => listedOpenOrders(page), { timeout: 10000, message: 'a cancelled order is not open' })
      .toEqual(['A-005', 'A-004', 'A-003', 'A-002', 'A-001']);

    await expectNoConsoleErrors(errors, '#/cash open orders sheet');
  });

  /* ------------------------------------------------- H3-i layout and axe */

  test('H3-i1 no horizontal scroll at 360px, empty cart, full cart and open sheet', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const errors = await openCash(page);

    const overflow = async (where) => {
      const o = await page.evaluate(() => {
        const d = document.documentElement;
        const widest = [...document.querySelectorAll('body *')]
          .map((n) => ({ w: Math.round(n.getBoundingClientRect().right), what: n.dataset.testid || n.className }))
          .filter((x) => x.w > d.clientWidth + 1).slice(0, 5);
        return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, widest };
      });
      expect(o.scrollWidth,
        `CLAUDE.md Design: no horizontal scroll at 360px (${where}: ${o.scrollWidth} > ${o.clientWidth}); ` +
        `widest: ${JSON.stringify(o.widest)}`
      ).toBeLessThanOrEqual(o.clientWidth + 1);
    };

    await overflow('empty cart');
    for (const id of MENU_IDS) await addItem(page, id, 2);
    await page.waitForTimeout(300);
    await overflow('full cart, order bar up');
    await openCashPanel(page);
    await page.waitForTimeout(300);
    await overflow('review sheet open');
    await tid(page, 'menu-button').click().catch(() => {});

    await expectNoConsoleErrors(errors, '#/cash at 360px');
  });

  test('H3-i2 axe: zero serious or critical violations, sheet closed, sheet open and menu open', async ({ page }) => {
    await openCash(page);

    const axe = async (where) => {
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
      expect(bad, `axe serious/critical on the cash counter, ${where}:\n${detail}`).toEqual([]);
    };

    await axe('empty cart');

    await tid(page, 'menu-button').click();
    await expect(tid(page, 'app-menu')).toBeVisible();
    await axe('☰ menu open');
    await page.keyboard.press('Escape');

    await addItem(page, 'fuchka', 2);
    await addItem(page, 'choc_strawberry', 1);
    await page.waitForTimeout(300);
    await axe('order bar up');

    await openCashPanel(page);
    await axe('review sheet open');

    await closeCashPanel(page);
    await openOpenOrders(page);
    await expect(openOrdersPanel(page)).toBeVisible();
    await axe('open orders sheet open');
  });

  /* ------------------------------------------------------------ H3-j menu */

  test('H3-j Marshmallow is renamed, Chocolate Fountain is gone, Samosa Chat is there', async ({ page }) => {
    await openCash(page);

    const tile = tid(page, 'tile-marshmallow');
    await expect(tile).toBeVisible();
    expect(norm(await tile.innerText()),
      'CLAUDE.md H3 7: the tile reads the short name "Choc Marshmallow"'
    ).toContain('Choc Marshmallow');

    await addItem(page, 'marshmallow', 1);
    await openCashPanel(page);
    const cartText = norm(await tid(page, 'line-marshmallow').innerText());
    expect(cartText,
      'CLAUDE.md H3 7: the cart names the renamed item, never the old "Marshmallow (V)"'
    ).toMatch(/Chocolate Marshmallow \(V\)|Choc Marshmallow/);
    expect(cartText.replace(/Choc(olate)? Marshmallow( \(V\))?/g, ''),
      'the old wording "Marshmallow (V)" must be gone'
    ).not.toMatch(/Marshmallow/);

    await tid(page, 'send-order').click();
    const [order] = await waitForOrders((o) => o.length === 1, { label: 'the marshmallow order' });
    expect(order.items[0].name, 'the order line stores the new full name').toBe('Chocolate Marshmallow (V)');

    const samosaChat = tid(page, 'tile-samosa_chat');
    await expect(samosaChat, 'CLAUDE.md Phase V 7: Samosa Chat is the eighth tile').toBeVisible();
    expect(norm(await samosaChat.innerText()), 'its short name is "Samosa Chat"').toContain('Samosa Chat');

    const menu = await readCollection('menu');
    expect(menu.map((m) => m._id).sort(), 'CLAUDE.md Menu: the menu is exactly the eight-item table')
      .toEqual([...MENU_IDS].sort());
  });
});

/* ===================================================================== H3-h
 * The tablet cash counter is untouched by H3.
 */
test.describe('H3-h the tablet cash counter is unchanged', () => {
  test.skip(({ viewport }) => !viewport || viewport.width < 700,
    'CLAUDE.md H3: "Tablet and desktop (700 px and wider) are unchanged"');

  test.beforeEach(async () => { await clearFirestore(); });

  test('H3-h at 700px and wider the order panel is always open and there is no bar or sheet', async ({ page }) => {
    const errors = await openApp(page, '#/cash');
    await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });

    // The panel is on screen with an empty cart.
    await expect(tid(page, 'customer-name'), 'the tablet order panel is always open').toBeVisible();
    await expect(tid(page, 'order-total')).toContainText('£0.00');
    const send = tid(page, 'send-order');
    await expect(send).toBeVisible();
    await expect(send, 'CLAUDE.md Cash 4: disabled when empty').toBeDisabled();
    expect(await heightOf(send), 'CLAUDE.md Cash 4: at least 72px on tablet').toBeGreaterThanOrEqual(71.5);

    // None of the H3 small-screen furniture is present.
    for (const name of ['order-bar', 'order-bar-open', 'review-sheet', 'sheet-add-more', 'menu-button', 'app-menu']) {
      const el = tid(page, name);
      if (await el.count()) {
        expect(await el.isVisible(), `"${name}" is an H3 small-screen control; the tablet layout is unchanged`).toBe(false);
      }
    }

    // With items, still no bar and no sheet, and the 52px steppers stay.
    await addItem(page, 'fuchka', 2);
    await addItem(page, 'choc_strawberry', 1);
    await page.waitForTimeout(300);
    await expect(tid(page, 'order-bar')).toBeHidden();
    await expect(tid(page, 'review-sheet')).toBeHidden();
    await expect(tid(page, 'order-total')).toContainText('£15.00');
    for (const id of ['fuchka', 'choc_strawberry']) {
      for (const key of ['dec', 'inc']) {
        const b = await boxOf(tid(page, `line-${key}-${id}`));
        expect(b.height, `line-${key}-${id} keeps its 52px on tablet`).toBeGreaterThanOrEqual(51.5);
        expect(b.width, `line-${key}-${id} keeps its 52px on tablet`).toBeGreaterThanOrEqual(51.5);
      }
    }

    // CLAUDE.md Phase V 1: on tablet the recent strip is replaced by the
    // "Open orders" header button and its 480 px right-hand drawer.
    await placeOrder(page, { items: { momo: 1 }, name: 'Tablet', payment: 'card' });
    const recent = tid(page, 'recent-A-001');
    if (await recent.count()) {
      expect(await recent.isVisible().catch(() => false),
        'CLAUDE.md Phase V 1: the Recent strip is gone from the tablet cash counter'
      ).toBe(false);
    }
    await openOpenOrders(page);
    await expect(openOrderRow(page, 'A-001'), 'the order is in the Open orders drawer')
      .toBeVisible({ timeout: 10000 });

    await expectNoConsoleErrors(errors, '#/cash tablet');
  });
});
