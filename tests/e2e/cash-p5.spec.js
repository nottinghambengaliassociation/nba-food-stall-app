/**
 * P5-* — Phase V (v1.4.0): edit or cancel an open order, from the cash counter.
 *
 * Spec: CLAUDE.md -> "Phase V: Edit or cancel an open order, plus Samosa Chat
 * (v1.4.0)" items 1-3 and 7, the status table at the head of that section, and
 * the mock-ups design/CashOpenOrders.dc.html (tablet/desktop),
 * design/CashOpenOrdersSmall.dc.html (iPhone 13) and
 * design/OrderChangesRules.dc.html (the money prompts and the data fields).
 * Plan: qa/test-plan.md sections 46-49.
 *
 * This file tests the brief. Where the app disagrees with it, the app is wrong.
 *
 * WHERE IT RUNS: `tablet` (1280x800, the drawer), `phone` (390x844) and
 * `iphone13` (390x664, the small phone the H3/Phase V header geometry is
 * written against — added to that project's testMatch in playwright.config.js).
 *
 * Emulator only. Nothing here touches live Firestore.
 */
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import {
  clearFirestore, openApp, gotoRoute, tid, boxOf, heightOf, addItem, placeOrder,
  openCashPanel, closeCashPanel, isSmallCash, selectPayment, cashReceivedVisible,
  expectNoConsoleErrors, waitForOrders, readCollection, londonDay, shot,
  // Phase V
  MENU_IDS_P5, seedP5Day, P5_EXPECT, openOrdersButton, openOrdersPanel,
  openOrdersSearch, openOrdersClose, openOrdersEmpty, openOrderRow,
  openEditButton, openCancelButton, openOrdersCount, openOpenOrders,
  closeOpenOrders, listedOpenOrders, editBanner, editDelta, saveChanges,
  discardChanges, editBlocked, editEmptyOffer, editEmptyCancel, lineChangeTag,
  lineRemoved, inEditMode, startEdit, saveEdit, cancelDialog, cancelReasonButton,
  cancelRefund, cancelKeep, cancelConfirm, openCancelDialog, cancelOrderWithReason,
  orderByNo, waitForOrder, orderSnapshot, kitchenAdvance, cancelDialogRole
} from './helpers.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100;
const TOL = 1;

/** Open #/cash on the scripted open day and wait for the tiles. */
async function openCashWithBoard(page) {
  await seedP5Day();
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  // Wait for the live snapshot to bring the seeded orders in.
  await expect
    .poll(async () => openOrdersCount(page), { timeout: 20000, message: 'the Open orders badge must count the four open orders' })
    .toBe(P5_EXPECT.openCount);
  return errors;
}

/** Open #/cash with nothing seeded. */
async function openCash(page) {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(250);
  return errors;
}

/** The order panel (tablet) or the Review & send sheet (phone). */
async function panelLocator(page) {
  if (isSmallCash(page)) return tid(page, 'review-sheet').first();
  const name = tid(page, 'customer-name').first();
  return name.locator('xpath=ancestor::*[self::aside or self::section or self::form][1]');
}

test.beforeEach(async () => { await clearFirestore(); });

/* ===================================================== P5-01 / P5-02 header */

test('P5-01 the header carries an Open orders button with a live count badge', async ({ page }) => {
  const errors = await openCashWithBoard(page);

  const btn = openOrdersButton(page);
  await expect(btn, 'CLAUDE.md Phase V 1: an Open orders button in the cash counter header').toBeVisible();
  expect(await btn.evaluate((el) => !!el.closest('header')), 'it lives in the dark header').toBe(true);

  const label = norm(await btn.innerText()) + ' ' + ((await btn.getAttribute('aria-label')) || '');
  if (isSmallCash(page)) {
    expect(label, 'CLAUDE.md Phase V 1: below 700 px the button reads "Orders"').toMatch(/Orders/i);
  } else {
    expect(label, 'CLAUDE.md Phase V 1: "Open orders" with a count badge').toMatch(/Open orders/i);
  }

  expect(await openOrdersCount(page),
    'the badge counts today\'s new + preparing + ready orders from every till'
  ).toBe(P5_EXPECT.openCount);

  const box = await boxOf(btn);
  expect(box.height, `the Open orders button is ${r2(box.height)}px tall; CLAUDE.md Design: at least 44-48px`)
    .toBeGreaterThanOrEqual(43.5);

  // The count is live: cancelling one takes it to three.
  await cancelOrderWithReason(page, 'A-044', 'mistake');
  await closeOpenOrders(page).catch(() => {});
  await expect
    .poll(async () => openOrdersCount(page), { timeout: 15000, message: 'the badge must follow the data' })
    .toBe(P5_EXPECT.openCount - 1);

  await expectNoConsoleErrors(errors, '#/cash open orders button');
});

test('P5-01b phone: Orders sits between the connection dot and ☰, header still one row', async ({ page }) => {
  test.skip(!isSmallCash(page), 'CLAUDE.md Phase V 1: the phone header placement');
  await openCashWithBoard(page);

  const geo = await page.evaluate(() => {
    const header = document.querySelector('header');
    const r = header.getBoundingClientRect();
    const box = (sel) => {
      const el = header.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const kids = [...header.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().height > 0 && el.children.length === 0)
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { what: el.dataset.testid || el.tagName.toLowerCase(), top: b.top, bottom: b.bottom, right: b.right };
      });
    return {
      header: { top: r.top, bottom: r.bottom, right: r.right, height: r.height },
      orders: box('[data-testid="open-orders"]'),
      pill: box('[data-testid="conn-pill"]'),
      menu: box('[data-testid="menu-button"]'),
      kids
    };
  });

  expect(geo.orders, 'CLAUDE.md Phase V 1: the phone header carries the Orders button').not.toBeNull();
  expect(geo.header.height,
    `CLAUDE.md H3 1: the header stays one row at about 52 px; it is ${r2(geo.header.height)}px`
  ).toBeLessThanOrEqual(56 + TOL);

  expect(geo.orders.left, 'Orders sits after the connection dot').toBeGreaterThanOrEqual(geo.pill.right - TOL);
  expect(geo.orders.right, 'Orders sits before the ☰ button').toBeLessThanOrEqual(geo.menu.left + TOL);

  const spilled = geo.kids.filter((k) => k.bottom > geo.header.bottom + TOL || k.top < geo.header.top - TOL);
  expect(spilled.map((k) => k.what), 'adding Orders must not wrap the header onto a second row').toEqual([]);
  const wide = geo.kids.filter((k) => k.right > geo.header.right + TOL).map((k) => k.what);
  expect(wide, 'nothing in the header may spill past the right edge').toEqual([]);
});

test('P5-02 the Recent strip and the ☰ Recent orders item are gone; Next A-0NN moved into ☰', async ({ page }) => {
  await openCashWithBoard(page);

  // No recent strip anywhere (Phase V 1: "replacing the Recent strip").
  for (const name of ['recent-list', 'recent-sheet', 'recent-A-041', 'recent-A-044']) {
    const el = tid(page, name);
    if (await el.count()) {
      expect(await el.isVisible().catch(() => false),
        `CLAUDE.md Phase V 1: "${name}" belongs to the Recent strip, which Open orders replaces`
      ).toBe(false);
    }
  }

  if (!isSmallCash(page)) {
    expect(norm(await page.locator('header').first().innerText()),
      'the tablet header still advertises the next order number'
    ).toMatch(/A-\d{3}/);
    return;
  }

  // Phone: the ☰ menu (Phase V 1).
  const header = page.locator('header').first();
  expect(norm(await header.innerText()),
    'CLAUDE.md Phase V 1: "Next A-045" moves into the ☰ menu, out of the header bar'
  ).not.toMatch(/Next\s+[A-Z]-\d{3}/);

  await tid(page, 'menu-button').click();
  const menu = tid(page, 'app-menu');
  await expect(menu).toBeVisible();
  expect(await tid(page, 'menu-recent').count(),
    'CLAUDE.md Phase V 1: "The ☰ Recent orders item is removed"'
  ).toBe(0);
  expect(norm(await menu.innerText()),
    'CLAUDE.md Phase V 1: "Next A-045" sits in the ☰ menu above the version line'
  ).toMatch(/Next\s+[A-Z]-\d{3}/);

  // Above the version line.
  const order = await page.evaluate(() => {
    const menuEl = document.querySelector('[data-testid="app-menu"]');
    const next = menuEl.querySelector('[data-testid="menu-next"]');
    const version = menuEl.querySelector('[data-testid="menu-version"]');
    if (!next || !version) return null;
    return { next: next.getBoundingClientRect().top, version: version.getBoundingClientRect().top };
  });
  if (order) {
    expect(order.next, 'CLAUDE.md Phase V 1: the next number sits above the version line')
      .toBeLessThan(order.version);
  }
});

/* ========================================================= P5-03 the panel */

test('P5-03 the drawer opens, is the right shape, and closes three ways', async ({ page }) => {
  const errors = await openCashWithBoard(page);
  const panel = openOrdersPanel(page);

  await openOpenOrders(page);
  const role = await panel.getAttribute('role');
  expect(role, 'CLAUDE.md Phase V 1: role="dialog"').toBe('dialog');

  const box = await boxOf(panel);
  const vp = page.viewportSize();
  if (!isSmallCash(page)) {
    expect(Math.abs(box.width - 480),
      `CLAUDE.md Phase V 1: the drawer is 480 px wide; it is ${r2(box.width)}px`
    ).toBeLessThanOrEqual(8);
    expect(Math.abs((box.x + box.width) - vp.width),
      'CLAUDE.md Phase V 1: a right-hand drawer'
    ).toBeLessThanOrEqual(8);
  } else {
    expect(box.width, 'the phone sheet spans the screen').toBeGreaterThanOrEqual(vp.width - 8);
    expect(Math.abs((box.y + box.height) - vp.height),
      'CLAUDE.md Phase V 1: a bottom sheet, same style as Review & send'
    ).toBeLessThanOrEqual(8);
  }

  // (a) Close
  await openOrdersClose(page).click();
  await expect(panel, 'CLAUDE.md Phase V 1: "closes on Close"').toBeHidden({ timeout: 10000 });

  // (b) backdrop tap. On tablet the drawer is 480 px on the right, so the
  // middle of the screen is backdrop. On phone the sheet is full width from
  // 40 px down (design/CashOpenOrdersSmall.dc.html: the sheet is
  // `top: 40px; left/right/bottom: 0` over a backdrop at `inset: 0`), so the
  // only backdrop a finger can reach is that 40 px strip at the top.
  await openOpenOrders(page);
  if (isSmallCash(page)) await page.mouse.click(8, 8);
  else await page.mouse.click(8, Math.round(vp.height / 2));
  await expect(panel, 'CLAUDE.md Phase V 1: "... backdrop tap"').toBeHidden({ timeout: 10000 });

  // (c) Escape
  await openOpenOrders(page);
  await page.keyboard.press('Escape');
  await expect(panel, 'CLAUDE.md Phase V 1: "... or Escape"').toBeHidden({ timeout: 10000 });

  await expectNoConsoleErrors(errors, '#/cash open orders drawer');
});

test('P5-04 it lists today\'s open orders from every till, newest first', async ({ page }) => {
  await openCashWithBoard(page);
  await openOpenOrders(page);

  expect(await listedOpenOrders(page),
    'CLAUDE.md Phase V 1: "today\'s orders from all tills with status new, preparing or ready, newest first"'
  ).toEqual(P5_EXPECT.open);

  for (const no of P5_EXPECT.closed) {
    expect(await openOrderRow(page, no).count(),
      `${no} is collected or cancelled, so it is not an open order`
    ).toBe(0);
  }

  // A till-B order is listed on an A till.
  await expect(openOrderRow(page, 'B-012'),
    'CLAUDE.md Phase V 1: every till sees every till\'s open orders'
  ).toBeVisible();
});

test('P5-05 search by order number and by name, case-insensitively', async ({ page }) => {
  await openCashWithBoard(page);
  await openOpenOrders(page);
  const box = openOrdersSearch(page);
  await expect(box, 'CLAUDE.md Phase V 1: a "Search order number or name" box').toBeVisible();

  const search = async (q) => {
    await box.fill(q);
    await page.waitForTimeout(350);
    return listedOpenOrders(page);
  };

  expect(await search('a-04')).toEqual(['A-044', 'A-042', 'A-041']);
  expect(await search('B-0')).toEqual(['B-012']);
  expect(await search('ahmed')).toEqual(['A-041']);
  expect(await search('AHMED'), 'case-insensitive').toEqual(['A-041']);
  expect(await search('  ahmed  '), 'trimmed').toEqual(['A-041']);
  expect(await search('zzz')).toEqual([]);
  await expect(openOrdersEmpty(page), 'nothing matched says so').toBeVisible({ timeout: 5000 });
  expect(norm(await openOrdersPanel(page).innerText())).toMatch(/No open orders match/i);

  expect(await search(''), 'clearing the box brings them all back').toEqual(P5_EXPECT.open);
});

test('P5-06 a row shows the order, its items, its meta line and two 48 px buttons', async ({ page }) => {
  await openCashWithBoard(page);
  await openOpenOrders(page);

  for (const [no, want] of Object.entries(P5_EXPECT.rows)) {
    const row = openOrderRow(page, no);
    await expect(row, `${no} must be listed`).toBeVisible();
    const text = norm(await row.innerText());
    expect(text, `${no} shows its order number`).toContain(no);
    expect(text, `${no} shows the name to call out`).toContain(want.name);
    expect(text, `${no} shows its status pill`).toMatch(new RegExp(want.status, 'i'));
    expect(text, `${no} shows its items as "${want.items}"`).toContain(want.items);
    expect(text, `${no} shows the time it was placed`).toContain(want.time);
    expect(text, `${no} shows the till it was placed on`).toMatch(new RegExp(`till ${want.till}`, 'i'));
    expect(text, `${no} shows how it was paid`).toMatch(new RegExp(want.pay, 'i'));
    expect(text, `${no} shows its total`).toContain(want.total);

    for (const [what, loc] of [['Edit', openEditButton(page, no)], ['Cancel', openCancelButton(page, no)]]) {
      await expect(loc, `${no} needs a ${what} button`).toBeVisible();
      const b = await boxOf(loc);
      expect(b.height, `${what} on ${no} is ${r2(b.height)}px tall; CLAUDE.md Phase V 1 says "two 48 px buttons"`)
        .toBeGreaterThanOrEqual(47.5);
    }
    expect(norm(await openCancelButton(page, no).innerText()), 'the brief words it "Cancel…"').toMatch(/Cancel/i);
  }
});

test('P5-07 Ready: cancel only', async ({ page }) => {
  await openCashWithBoard(page);
  await openOpenOrders(page);

  const edit = openEditButton(page, 'A-042');
  await expect(edit).toBeVisible();
  await expect(edit,
    'CLAUDE.md Phase V 1: Edit is "disabled for ready"'
  ).toBeDisabled();
  expect(await edit.getAttribute('title'),
    'CLAUDE.md Phase V 1: title "Ready: cancel only"'
  ).toMatch(/Ready: cancel only/i);

  await expect(openCancelButton(page, 'A-042'), 'a Ready order can still be cancelled').toBeEnabled();

  for (const no of ['A-041', 'B-012', 'A-044']) {
    await expect(openEditButton(page, no), `${no} is new or preparing, so Edit is enabled`).toBeEnabled();
  }
});

/* ============================================================ P5-08.. edit */

test('P5-08 Edit loads the order into the panel in edit mode', async ({ page }) => {
  const errors = await openCashWithBoard(page);
  await startEdit(page, 'A-041');

  await expect(openOrdersPanel(page), 'the drawer closes when Edit starts').toBeHidden({ timeout: 10000 });

  // The order is in the panel (tablet) / the cart and the Review sheet (phone).
  await openCashPanel(page);
  await expect(tid(page, 'customer-name')).toHaveValue('Ahmed');
  await expect(tid(page, 'order-total')).toContainText('£15.00');
  await expect(tid(page, 'line-momo')).toContainText('2');
  await expect(tid(page, 'line-chat')).toBeVisible();
  await expect(tid(page, 'pay-cash'), 'it keeps the payment it was placed with').toHaveAttribute('aria-pressed', 'true');

  // CLAUDE.md Phase V 2: the banner names the order and the customer on every
  // layout. The status pill and the "Was ..." line belong to the tablet panel
  // banner — that clause ends "the panel gets a 3 px #B45309 border", and the
  // phone form is specified separately as "an amber strip under the header
  // with Discard", which is exactly what design/CashOpenOrdersSmall.dc.html
  // draws (strip "Editing A-041 · Ahmed" + Discard, sheet header "Edit A-041").
  const bannerText = norm(await editBanner(page).innerText());
  expect(bannerText, 'CLAUDE.md Phase V 2: "Editing A-041 · Ahmed"').toMatch(/Editing\s+A-041/);
  expect(bannerText, 'the banner names the customer').toContain('Ahmed');

  if (!isSmallCash(page)) {
    expect(bannerText, 'CLAUDE.md Phase V 2: the banner shows the status pill').toMatch(/Preparing/i);
    expect(bannerText,
      'CLAUDE.md Phase V 2: "Was 2× Momo, 1× Papri Chat, £15.00, Cash"'
    ).toMatch(/Was\s+2× Momo, 1× Papri Chat, £15\.00, Cash/);

    const border = await (await panelLocator(page)).evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.borderTopWidth, colour: s.borderTopColor };
    });
    expect(parseFloat(border.width),
      `CLAUDE.md Phase V 2: "the panel gets a 3 px #B45309 border"; it is ${border.width}`
    ).toBeGreaterThanOrEqual(2.5);
    const [r, g, b] = (border.colour.match(/\d+/g) || []).map(Number);
    expect(Math.abs(r - 0xB4) + Math.abs(g - 0x53) + Math.abs(b - 0x09),
      `the edit border is ${border.colour}; CLAUDE.md Phase V 2 says #B45309`
    ).toBeLessThanOrEqual(60);
  } else {
    // Phone: the sheet says which order is being edited ...
    expect(norm(await tid(page, 'review-sheet').innerText()),
      'design/CashOpenOrdersSmall.dc.html: the sheet header reads "Edit A-041"'
    ).toMatch(/Edit\s+A-041/);

    // ... and an amber strip under the header with Discard, with an amber
    // "Review changes ›" order bar behind it (CLAUDE.md Phase V 2).
    await closeCashPanel(page);
    const strip = editBanner(page);
    await expect(strip, 'the amber strip stays under the header with the sheet closed').toBeVisible();
    expect(norm(await strip.innerText()), 'the strip names the order being edited')
      .toMatch(/Editing\s+A-041\s*·?\s*Ahmed/);
    await expect(discardChanges(page),
      'CLAUDE.md Phase V 2: "an amber strip under the header with Discard"'
    ).toBeVisible();
    const stripColour = await strip.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [sr, sg, sb] = (stripColour.match(/\d+/g) || []).map(Number);
    expect(sr >= sg && sg > sb, `the edit strip is ${stripColour}; CLAUDE.md Phase V 2 paints it amber`).toBe(true);

    const bar = tid(page, 'order-bar-open');
    await expect(bar).toBeVisible();
    expect(norm(await bar.innerText()),
      'CLAUDE.md Phase V 2: "the order bar becomes amber \\"Review changes ›\\""'
    ).toMatch(/Review changes/i);
    const colour = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = (colour.match(/\d+/g) || []).map(Number);
    expect(r > 120 && r > b && g < r,
      `the order bar is ${colour}; CLAUDE.md Phase V 2 paints it amber (#B45309)`
    ).toBe(true);
  }

  await expectNoConsoleErrors(errors, '#/cash edit mode');
});

test('P5-09 Cash received is hidden in edit mode', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');          // a cash order
  await openCashPanel(page);

  expect(await cashReceivedVisible(page),
    'CLAUDE.md Phase V 2: "Cash received is hidden in edit mode"'
  ).toBe(false);
  expect(norm(await page.locator('body').innerText())).not.toMatch(/Cash received/i);
});

test('P5-10 changed lines are tagged added / +1 (was 2) / removed', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');          // 2x momo, 1x chat

  // added
  await addItem(page, 'fuchka', 1);
  await openCashPanel(page);
  expect(norm(await lineChangeTag(page, 'fuchka').innerText()),
    'CLAUDE.md Phase V 2: a line that was not on the order reads "added"'
  ).toMatch(/^added$/i);

  // +1 (was 2)
  await tid(page, 'line-inc-momo').click();
  await page.waitForTimeout(200);
  expect(norm(await lineChangeTag(page, 'momo').innerText()),
    'CLAUDE.md Phase V 2: "+1 (was 2)"'
  ).toMatch(/^\+1 \(was 2\)$/);

  // -1 (was 2)
  await tid(page, 'line-dec-momo').click();
  await tid(page, 'line-dec-momo').click();
  await page.waitForTimeout(200);
  expect(norm(await lineChangeTag(page, 'momo').innerText()),
    'CLAUDE.md Phase V 2: "−1 (was 2)" (a plain hyphen is accepted)'
  ).toMatch(/^[-−]1 \(was 2\)$/);

  // removed, struck through
  await tid(page, 'line-dec-chat').click();
  await page.waitForTimeout(250);
  const removed = lineRemoved(page, 'chat');
  await expect(removed,
    'CLAUDE.md Phase V 2: "removed lines show struck through with removed"'
  ).toBeVisible({ timeout: 5000 });
  const text = norm(await removed.innerText());
  expect(text).toMatch(/removed/i);
  expect(text, 'the removed line still names what it was').toMatch(/Papri Chat/);
  const struck = await removed.evaluate((el) => {
    const all = [el, ...el.querySelectorAll('*')];
    return all.some((n) => /line-through/.test(getComputedStyle(n).textDecorationLine)
      || n.tagName === 'S' || n.tagName === 'DEL' || n.tagName === 'STRIKE');
  });
  expect(struck, 'the removed line is struck through').toBe(true);
});

test('P5-11 edit-delta says the right thing in all six cases', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');          // £15.00, Cash
  const delta = editDelta(page);
  const read = async () => {
    await page.waitForTimeout(250);
    return norm(await delta.innerText());
  };

  await expect(delta, 'CLAUDE.md Phase V 2: a data-testid="edit-delta" payment prompt').toBeVisible();
  expect(await read(), 'nothing changed yet').toMatch(/No changes yet/i);

  // up, cash
  await tid(page, 'line-inc-momo').click();
  expect(await read()).toContain('Take £5.00 more');
  expect(await read(), 'the cash wording has no card machine in it').not.toMatch(/card machine/i);

  // up, card
  await selectPayment(page, 'card');
  expect(await read()).toContain('Take £5.00 more on the card machine');

  // down, card (back to 2x momo, then drop the Papri Chat: -£5 on the original)
  await tid(page, 'line-dec-momo').click();
  await tid(page, 'line-dec-chat').click();
  expect(await read()).toContain('Refund £5.00 on the card machine');

  // down, cash
  await selectPayment(page, 'cash');
  expect(await read()).toContain('Give back £5.00');
  expect(await read()).not.toMatch(/card machine/i);

  // same total, something else changed (the name)
  await addItem(page, 'chat', 1);
  await openCashPanel(page);
  await tid(page, 'customer-name').fill('Ahmed B');
  expect(await read(),
    'CLAUDE.md Phase V 2: same total → "No payment change"'
  ).toMatch(/No payment change/i);
});

test('P5-12 Save is disabled until something changes', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');
  await openCashPanel(page);

  const save = saveChanges(page);
  await expect(save, 'CLAUDE.md Phase V 2: "disabled until something changes"').toBeDisabled();
  expect(norm(await save.innerText()), 'CLAUDE.md Phase V 2: "Save changes · £x.xx"')
    .toMatch(/Save changes[\s·]*£15\.00/);

  await tid(page, 'line-inc-momo').click();
  await page.waitForTimeout(250);
  await expect(save, 'one tap on + is a change').toBeEnabled();
  expect(norm(await save.innerText()), 'the button carries the new total').toMatch(/£20\.00/);

  await tid(page, 'line-dec-momo').click();
  await page.waitForTimeout(250);
  await expect(save, 'undoing the change disables it again').toBeDisabled();

  const h = await heightOf(save);
  const min = isSmallCash(page) ? 60 : 80;
  expect(h, `Save is ${r2(h)}px tall; CLAUDE.md Phase V 2 says ${min}px here`).toBeGreaterThanOrEqual(min - 2);
});

test('P5-13 removing every item offers Cancel instead of Save', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');
  await openCashPanel(page);

  await tid(page, 'line-dec-momo').click();
  await tid(page, 'line-dec-momo').click();
  await tid(page, 'line-dec-chat').click();
  await page.waitForTimeout(400);

  await expect(saveChanges(page),
    'CLAUDE.md Phase V 2: "If every item is removed, Save is disabled"'
  ).toBeDisabled();

  const offer = editEmptyOffer(page);
  await expect(offer,
    'CLAUDE.md Phase V 2: "No items left. Cancel the order instead?"'
  ).toBeVisible({ timeout: 5000 });
  expect(norm(await offer.innerText())).toMatch(/No items left\.?\s*Cancel the order instead\?/i);

  await editEmptyCancel(page).click();
  await expect(cancelDialog(page),
    'the offer opens the cancel dialog for the order being edited'
  ).toBeVisible({ timeout: 10000 });
  expect(norm(await cancelDialog(page).innerText())).toContain('A-041');

  // Nothing has been written yet.
  const order = await orderByNo('A-041');
  expect(order.items, 'the order is untouched until the cancel is confirmed').toHaveLength(2);
  expect(order.status).toBe('preparing');
});

test('P5-14 Discard changes writes nothing', async ({ page }) => {
  await openCashWithBoard(page);
  const before = await orderSnapshot('A-041');

  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await tid(page, 'line-inc-momo').click();
  await tid(page, 'customer-name').fill('Someone Else');
  await selectPayment(page, 'card');
  await page.waitForTimeout(250);

  // CLAUDE.md Phase V 2 puts Discard in the amber strip under the header on
  // phone, so the Review sheet is closed first, the way a volunteer would.
  await closeCashPanel(page);
  await discardChanges(page).click();
  await page.waitForTimeout(600);

  expect(await inEditMode(page), 'CLAUDE.md Phase V 2: Discard leaves edit mode').toBe(false);
  expect(await orderSnapshot('A-041'),
    'CLAUDE.md Phase V 2: "Discard changes leaves edit mode with nothing written"'
  ).toBe(before);

  // Back to a new, empty order on Card (H4 1).
  if (!isSmallCash(page)) {
    await expect(tid(page, 'order-total')).toContainText('£0.00');
    await expect(tid(page, 'customer-name')).toHaveValue('');
    await expect(tid(page, 'pay-card'), 'Hotfix H4 1: a new order starts on Card').toHaveAttribute('aria-pressed', 'true');
    await expect(tid(page, 'send-order'), 'the Send button is back').toBeVisible();
  } else {
    await expect(tid(page, 'order-bar'), 'the cart is empty, so the order bar is hidden').toBeHidden();
  }
});

test('P5-15 leaving edit mode another way asks first', async ({ page }) => {
  await openCashWithBoard(page);
  let nativeConfirm = false;
  page.on('dialog', async (d) => { nativeConfirm = true; await d.dismiss(); });

  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await tid(page, 'line-inc-momo').click();
  await page.waitForTimeout(250);
  await closeCashPanel(page);

  const confirmBox = page.locator([
    '[data-testid="edit-leave-confirm"]', '[data-testid="discard-confirm"]',
    '[data-testid="sign-out-confirm"]', '[data-testid="signout-confirm"]',
    '[role="alertdialog"]', '[role="dialog"]'
  ].join(', '));

  // (a) Edit on another order asks first.
  await openOpenOrders(page);
  await openEditButton(page, 'A-044').click();
  await page.waitForTimeout(500);
  const asked = page.locator('body');
  expect(norm(await asked.innerText()),
    'CLAUDE.md Phase V 2: "starting Edit on another order asks first with an in-page confirm"'
  ).toMatch(/discard|unsaved|changes/i);
  expect(nativeConfirm, 'CLAUDE.md Login 8: never window.confirm').toBe(false);

  // Cancel keeps the edit as it was.
  const keep = confirmBox.locator('button', { hasText: /^(Cancel|Keep editing|Keep)$/i }).first();
  if (await keep.count()) {
    await keep.click();
    await page.waitForTimeout(400);
    expect(await inEditMode(page), 'Cancel keeps edit mode').toBe(true);
    expect(norm(await editBanner(page).innerText()), 'still editing the same order').toContain('A-041');
  }

  // (b) Sign out asks too, and writes nothing.
  const snapshot = await orderSnapshot('A-041');
  if (isSmallCash(page)) {
    await closeOpenOrders(page).catch(() => {});
    await tid(page, 'menu-button').click();
    await tid(page, 'menu-signout').click();
  } else {
    await closeOpenOrders(page).catch(() => {});
    await tid(page, 'sign-out').first().click();
  }
  await page.waitForTimeout(500);
  expect(norm(await page.locator('body').innerText()),
    'CLAUDE.md Phase V 2: Sign out while editing asks first, like the unsent-order confirm'
  ).toMatch(/sign out\?|discard/i);
  expect(nativeConfirm, 'never window.confirm').toBe(false);
  expect(await orderSnapshot('A-041'), 'nothing is written by asking').toBe(snapshot);
});

test('P5-16 a new order cannot be built while editing', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');
  await openCashPanel(page);

  const send = tid(page, 'send-order');
  if (await send.count()) {
    expect(await send.isVisible().catch(() => false),
      'CLAUDE.md Phase V 2: "A new order can\'t be built while editing"'
    ).toBe(false);
  }

  // Tiles add to the order being edited, not to a second one.
  await addItem(page, 'fuchka', 1);
  await openCashPanel(page);
  await expect(tid(page, 'order-total')).toContainText('£20.00');
  expect(norm(await editBanner(page).innerText()), 'still the same edit').toContain('A-041');
  expect((await readCollection('orders')).length, 'no second order was written').toBe(6);
});

test('P5-17 Save writes the edit and leaves the order its place in the queue', async ({ page }) => {
  const errors = await openCashWithBoard(page);
  const before = await orderByNo('A-041');
  const startedAt = Date.now();

  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await tid(page, 'line-inc-momo').click();          // 3x momo
  await tid(page, 'line-dec-chat').click();          // drop the Papri Chat
  await tid(page, 'customer-name').fill('Ahmed B');
  await page.waitForTimeout(250);
  expect(norm(await editDelta(page).innerText()), 'the same total, by a different route')
    .toMatch(/No payment change/i);

  await saveEdit(page);

  const after = await waitForOrder('A-041', (o) => Number(o.editCount) > 0, { label: 'the edit to land' });
  expect(after.items.map((l) => `${l.qty}x${l.id}`).sort(), 'CLAUDE.md Phase V 2: items are updated')
    .toEqual(['3xmomo']);
  expect(after.total).toBe(1500);
  expect(after.name).toBe('Ahmed B');
  expect(after.payment).toBe('cash');
  expect(after.editCount, 'CLAUDE.md Phase V 2: editCount + 1').toBe(1);
  expect(Number(after.editedAtMs), 'editedAtMs is stamped').toBeGreaterThanOrEqual(startedAt);

  expect(Array.isArray(after.history), 'CLAUDE.md Phase V 2: "append to history"').toBe(true);
  expect(after.history).toHaveLength(1);
  const entry = after.history[0];
  expect(entry.action).toBe('edit');
  expect(entry.till, 'the till that made the change').toBe('A');
  expect(entry.fromStatus).toBe('preparing');
  expect(entry.deltaPence, 'new total minus old total').toBe(0);
  expect(entry.before.total, 'the order as it stood before').toBe(1500);
  expect(entry.before.name).toBe('Ahmed');
  expect(entry.before.payment).toBe('cash');
  expect(entry.before.items.map((l) => `${l.qty}x${l.id}`).sort()).toEqual(['1xchat', '2xmomo']);

  // Its identity and its place in the queue never change.
  for (const field of ['orderNo', 'till', 'day', 'createdAtMs', 'status', 'startedAtMs']) {
    expect(after[field], `CLAUDE.md Phase V 2: ${field} never changes on an edit`).toEqual(before[field]);
  }

  // The toast names the order and the money.
  const toast = tid(page, 'order-toast');
  await expect(toast, 'CLAUDE.md Phase V 2: "Toast: A-041 updated. ..."').toBeVisible({ timeout: 10000 });
  expect(norm(await toast.innerText())).toMatch(/A-041 updated\./);

  // And the panel is a new, empty order on Card.
  expect(await inEditMode(page), 'the panel returns to a new empty order').toBe(false);
  if (!isSmallCash(page)) {
    await expect(tid(page, 'order-total')).toContainText('£0.00');
    await expect(tid(page, 'pay-card'), 'Hotfix H4 1 still holds after an edit')
      .toHaveAttribute('aria-pressed', 'true');
  }
  await expectNoConsoleErrors(errors, '#/cash after saving an edit');
});

test('P5-17b the toast repeats the payment prompt', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await tid(page, 'line-inc-momo').click();     // +£5, cash
  await page.waitForTimeout(200);
  await saveEdit(page);

  await expect(tid(page, 'order-toast')).toBeVisible({ timeout: 10000 });
  expect(norm(await tid(page, 'order-toast').innerText()),
    'CLAUDE.md Phase V 2: "Toast: A-041 updated. Take £5.00 more."'
  ).toMatch(/A-041 updated\.\s*Take £5\.00 more\./);
});

test('P5-18 a name cleared in edit mode saves as Guest', async ({ page }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-044');
  await openCashPanel(page);
  await tid(page, 'customer-name').fill('');
  await tid(page, 'line-inc-chat').click();
  await page.waitForTimeout(250);
  await saveEdit(page);

  const after = await waitForOrder('A-044', (o) => Number(o.editCount) > 0, { label: 'the edit to land' });
  expect(after.name, 'CLAUDE.md Phase V 2: name ("Guest" if blank)').toBe('Guest');
});

test('P5-19 the order moving on under us blocks the save and writes nothing', async ({ page, context }) => {
  await openCashWithBoard(page);
  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await tid(page, 'line-inc-momo').click();
  await page.waitForTimeout(250);

  // The food counter takes it to Ready while the panel is open.
  const kitchen = await context.newPage();
  await kitchen.goto('/#/kitchen');
  await kitchenAdvance(kitchen, 'A-041', 'preparing');
  await waitForOrders((o) => o.some((x) => x.orderNo === 'A-041' && x.status === 'ready'),
    { label: 'A-041 to go ready' });
  await kitchen.close();
  await page.waitForTimeout(600);

  const snapshot = await orderSnapshot('A-041');
  const save = saveChanges(page);
  if (await save.isEnabled().catch(() => false)) await save.click();
  await page.waitForTimeout(800);

  const after = await orderByNo('A-041');
  expect(after.editCount, 'CLAUDE.md Phase V 2: "write nothing"').toBeFalsy();
  expect(after.items.find((l) => l.id === 'momo').qty, 'the items are untouched').toBe(2);
  expect(await orderSnapshot('A-041')).toBe(snapshot);

  const alert = editBlocked(page);
  await expect(alert,
    'CLAUDE.md Phase V 2: an amber role="alert" when the status has moved on'
  ).toBeVisible({ timeout: 10000 });
  expect(await alert.getAttribute('role'), 'role="alert"').toBe('alert');
  expect(norm(await alert.innerText())).toMatch(
    /A-041 is now Ready, so it can't be edited\. Cancel it or start a new order\./i
  );
});

/* =========================================================== P5-20.. cancel */

test('P5-20 the cancel dialog says what is being cancelled, and Keep order writes nothing', async ({ page }) => {
  const errors = await openCashWithBoard(page);
  const before = await orderSnapshot('A-041');

  const dialog = await openCancelDialog(page, 'A-041');
  // CLAUDE.md Phase V 3: 'Confirm dialog (role="alertdialog")'. The app draws
  // a backdrop wrapper around the card and puts the role on the card, which
  // satisfies the brief; the role is asserted wherever it sits.
  const role = cancelDialogRole(page);
  expect(await role.count(), 'CLAUDE.md Phase V 3: the confirm carries role="alertdialog"')
    .toBeGreaterThan(0);
  await expect(role.first(), 'and it is on screen').toBeVisible();
  expect(await role.first().getAttribute('aria-modal'), 'a modal confirm traps the screen').toBe('true');

  const text = norm(await dialog.innerText());
  expect(text, 'CLAUDE.md Phase V 3: "Cancel A-041 for Ahmed?"').toMatch(/Cancel A-041 for Ahmed\?/);
  expect(text, 'it lists the items').toContain('2× Momo, 1× Papri Chat');
  expect(text, 'it shows the total').toContain('£15.00');
  expect(text, 'it shows the status').toMatch(/Preparing/i);
  expect(text,
    'CLAUDE.md Phase V 3: for preparing or ready, "The food counter has already started this."'
  ).toMatch(/food counter has already started this/i);
  expect(text, 'and the red Stop making card warning').toMatch(/red .?Stop making.? card/i);

  expect(norm(await cancelRefund(page).innerText()),
    'CLAUDE.md Phase V 3: a cash order says "Give back £15.00 cash"'
  ).toMatch(/Give back £15\.00 cash/);

  await cancelKeep(page).click();
  await expect(dialog, 'Keep order closes the dialog').toBeHidden({ timeout: 10000 });
  expect(await orderSnapshot('A-041'), 'Keep order writes nothing').toBe(before);

  // A new order gets no "already started" line, and a card order refunds on the machine.
  const newDialog = await openCancelDialog(page, 'A-044');
  const newText = norm(await newDialog.innerText());
  expect(newText, 'a New order has not been started').not.toMatch(/already started/i);
  expect(norm(await cancelRefund(page).innerText()),
    'CLAUDE.md Phase V 3: a card order says "Refund £15.00 on the card machine"'
  ).toMatch(/Refund £15\.00 on the card machine/);

  await expectNoConsoleErrors(errors, '#/cash cancel dialog');
});

test('P5-21 one reason is required, and Not collected is offered for Ready only', async ({ page }) => {
  await openCashWithBoard(page);

  await openCancelDialog(page, 'A-041');     // preparing
  const confirm = cancelConfirm(page);
  await expect(confirm,
    'CLAUDE.md Phase V 3: "Cancel order (disabled until a reason is picked)"'
  ).toBeDisabled();

  for (const key of ['mistake', 'changed_mind', 'out_of_stock', 'other']) {
    await expect(cancelReasonButton(page, key), `CLAUDE.md Phase V 3: reason ${key}`).toBeVisible();
  }
  const notCollected = cancelReasonButton(page, 'not_collected');
  if (await notCollected.count()) {
    expect(await notCollected.isVisible().catch(() => false) && await notCollected.isEnabled().catch(() => false),
      'CLAUDE.md Phase V 3: "Not collected ... only for ready"'
    ).toBe(false);
  }

  await cancelReasonButton(page, 'changed_mind').click();
  await page.waitForTimeout(200);
  await expect(confirm, 'picking a reason enables Cancel order').toBeEnabled();

  const colour = await confirm.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = (colour.match(/\d+/g) || []).map(Number);
  expect(r > 140 && g < 80 && b < 80,
    `Cancel order is ${colour}; CLAUDE.md Phase V 3 paints it #B91C1C`
  ).toBe(true);

  await cancelKeep(page).click();
  await page.waitForTimeout(300);

  // Ready: Not collected is on the list.
  await openCancelDialog(page, 'A-042');
  await expect(cancelReasonButton(page, 'not_collected'),
    'CLAUDE.md Phase V 3: Not collected is offered for a Ready order'
  ).toBeVisible({ timeout: 5000 });
});

test('P5-22 confirming writes the cancel and the order leaves the list', async ({ page }) => {
  await openCashWithBoard(page);
  const before = await orderByNo('A-041');

  await cancelOrderWithReason(page, 'A-041', 'changed_mind');

  const after = await waitForOrder('A-041', (o) => o.status === 'cancelled', { label: 'the cancel to land' });
  expect(after.status).toBe('cancelled');
  expect(typeof after.cancelledAtMs, 'CLAUDE.md Phase V 3: cancelledAtMs').toBe('number');
  expect(after.cancelReason, 'CLAUDE.md Phase V 3: cancelReason').toBe('changed_mind');
  expect(after.cancelledFrom, 'CLAUDE.md Phase V 3: cancelledFrom is the status it had').toBe('preparing');
  expect(Array.isArray(after.history)).toBe(true);
  expect(after.history[after.history.length - 1]).toMatchObject({
    action: 'cancel', till: 'A', fromStatus: 'preparing', reason: 'changed_mind'
  });
  expect(after.items, 'the items are kept as they were').toHaveLength(before.items.length);
  expect(after.total).toBe(before.total);

  // The toast repeats the refund line.
  const toast = tid(page, 'order-toast');
  await expect(toast).toBeVisible({ timeout: 10000 });
  expect(norm(await toast.innerText()),
    'CLAUDE.md Phase V 3: "Toast repeats the refund line"'
  ).toMatch(/Give back £15\.00 cash/);

  // It is no longer an open order.
  await openOpenOrders(page);
  await expect
    .poll(async () => listedOpenOrders(page), { timeout: 10000, message: 'a cancelled order is not open' })
    .toEqual(['A-044', 'B-012', 'A-042']);
});

test('P5-23 cancelling an order that was collected meanwhile is refused', async ({ page, context }) => {
  await openCashWithBoard(page);
  await openCancelDialog(page, 'A-042');     // ready
  await cancelReasonButton(page, 'not_collected').click();

  // The food counter collects it while the dialog is open.
  const kitchen = await context.newPage();
  await kitchen.goto('/#/kitchen');
  await kitchenAdvance(kitchen, 'A-042', 'ready');
  await waitForOrders((o) => o.some((x) => x.orderNo === 'A-042' && x.status === 'collected'),
    { label: 'A-042 to be collected' });
  await kitchen.close();
  await page.waitForTimeout(600);

  const snapshot = await orderSnapshot('A-042');
  const confirm = cancelConfirm(page);
  if (await confirm.isVisible().catch(() => false) && await confirm.isEnabled().catch(() => false)) {
    await confirm.click();
  }
  await page.waitForTimeout(800);

  const after = await orderByNo('A-042');
  expect(after.status, 'CLAUDE.md Phase V 3: "refuse if status is collected or cancelled"').toBe('collected');
  expect(after.cancelReason, 'nothing was written').toBeFalsy();
  expect(await orderSnapshot('A-042')).toBe(snapshot);

  expect(norm(await page.locator('body').innerText()),
    'CLAUDE.md Phase V 3: "A-041 was already collected"'
  ).toMatch(/A-042 was already collected/i);
});

/* ============================================================ P5-24 offline */

test('P5-24 offline: Edit and Cancel are disabled, new orders still queue', async ({ page, context }) => {
  await openCashWithBoard(page);
  await openOpenOrders(page);

  await context.setOffline(true);
  await page.waitForTimeout(1200);

  await expect
    .poll(async () => openEditButton(page, 'A-041').isDisabled().catch(() => false),
      { timeout: 15000, message: 'CLAUDE.md Phase V 1: "Offline: Edit and Cancel are disabled"' })
    .toBe(true);
  await expect(openCancelButton(page, 'A-041'), 'Cancel is disabled offline too').toBeDisabled();
  expect(norm(await openOrdersPanel(page).innerText()),
    'CLAUDE.md Phase V 1: the note "Needs a connection"'
  ).toMatch(/Needs a connection/i);

  // A new order still queues (CLAUDE.md Phase V 1, Cash 6).
  await closeOpenOrders(page);
  await addItem(page, 'fuchka', 1);
  await openCashPanel(page);
  await tid(page, 'customer-name').fill('Queued');
  await tid(page, 'send-order').click();
  await expect(tid(page, 'order-toast'), 'an offline order still sends').toBeVisible({ timeout: 10000 });
  await expect(tid(page, 'conn-pill')).toContainText(/offline/i, { timeout: 10000 });

  await context.setOffline(false);
  await page.waitForTimeout(1500);
  await openOpenOrders(page);
  await expect
    .poll(async () => openEditButton(page, 'A-041').isEnabled().catch(() => false),
      { timeout: 20000, message: 'back online, Edit works again' })
    .toBe(true);
});

/* ====================================================== P5-25 Samosa Chat */

test('P5-25 the till shows eight tiles, Samosa Chat last', async ({ page }, info) => {
  const errors = await openCash(page);

  const rendered = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="tile-"]')]
    .map((t) => t.dataset.testid.replace(/^tile-/, '')));
  expect(rendered,
    'CLAUDE.md Menu + Phase V 7: eight tiles in sort order, Samosa Chat last'
  ).toEqual(MENU_IDS_P5);

  const tile = tid(page, 'tile-samosa_chat');
  await expect(tile).toBeVisible();
  expect(await tile.locator('svg').count(), 'CLAUDE.md Phase V 7: "and its icon"').toBeGreaterThan(0);
  const text = norm(await tile.innerText());
  expect(text, 'the tile reads "Samosa Chat"').toContain('Samosa Chat');
  if (!isSmallCash(page)) expect(text, 'CLAUDE.md Cash 1: £5 on the tile').toMatch(/£5(\.00)?/);

  // It sells.
  const no = await placeOrder(page, { items: { samosa_chat: 2 }, name: 'Chaat Fan', payment: 'card' });
  expect(no).toMatch(/^A-\d{3}$/);
  const [order] = await waitForOrders((o) => o.length === 1, { label: 'the samosa chat order' });
  expect(order.items[0]).toMatchObject({ id: 'samosa_chat', qty: 2, price: 500 });
  expect(order.items[0].name, 'the line stores the menu name').toBe('Samosa Chat');
  expect(order.total).toBe(1000);

  // The seeded menu document.
  const menu = await readCollection('menu');
  expect(menu.map((m) => m._id).sort(), 'CLAUDE.md Menu: eight documents').toEqual([...MENU_IDS_P5].sort());
  const seeded = menu.find((m) => m._id === 'samosa_chat');
  expect(seeded).toMatchObject({ name: 'Samosa Chat', short: 'Samosa Chat', price: 500, station: 'chaat', active: true, sort: 8 });
  expect(String(seeded.colour).toUpperCase()).toBe('#A5F3FC');

  await expectNoConsoleErrors(errors, '#/cash with eight tiles');
  expect(info.project.name.length).toBeGreaterThan(0);
});

test('P5-25b all eight tiles fit the small phone and none is covered by the order bar', async ({ page }, info) => {
  test.skip(!isSmallCash(page), 'CLAUDE.md H3 2 + Phase V 7: the small-phone tile geometry');
  await openCash(page);

  const empty = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid^="tile-"]')];
    const area = tiles[0] ? tiles[0].closest('main') || tiles[0].parentElement.parentElement : null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      tiles: tiles.map((t) => {
        const r = t.getBoundingClientRect();
        return { id: t.dataset.testid.replace(/^tile-/, ''), top: r.top, bottom: r.bottom, left: r.left };
      }),
      area: area ? { scrollHeight: area.scrollHeight, clientHeight: area.clientHeight } : null
    };
  });

  expect(empty.tiles, 'eight tiles').toHaveLength(8);
  const lefts = [...new Set(empty.tiles.map((t) => Math.round(t.left)))];
  expect(lefts.length, 'CLAUDE.md H3 2: three columns').toBe(3);
  const offscreen = empty.tiles.filter((t) => t.bottom > empty.viewport.height + TOL || t.top < -TOL);
  expect(offscreen.map((t) => t.id),
    `CLAUDE.md Phase V 7: "8 tiles, still no scrolling at 390×664". At ${info.project.name} ` +
    `(${empty.viewport.width}x${empty.viewport.height}) these fall outside: ` +
    JSON.stringify(empty.tiles.map((t) => ({ id: t.id, top: r2(t.top), bottom: r2(t.bottom) })), null, 1)
  ).toEqual([]);
  expect(empty.area.scrollHeight,
    'the menu area must not need to scroll with an empty cart'
  ).toBeLessThanOrEqual(empty.area.clientHeight + 2);

  // With the order bar up, every tile is still tappable.
  await addItem(page, 'fuchka', 1);
  await page.waitForTimeout(300);
  for (const id of MENU_IDS_P5) {
    const t = tid(page, `tile-${id}`);
    await t.scrollIntoViewIfNeeded();
    const hit = await t.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { on: !!top && (top === el || el.contains(top)), at: top ? (top.dataset.testid || top.tagName) : 'nothing' };
    });
    expect(hit.on,
      `CLAUDE.md H3 2: the order bar must not cover tile-${id}; the centre point hits ${hit.at}`
    ).toBe(true);
  }
});

/* ============================================ P5-26 layout, axe, screenshots */

test('P5-26 no horizontal scroll at 360 px with the drawer and the dialog open', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const errors = await openCashWithBoard(page);

  const noOverflow = async (where) => {
    const o = await page.evaluate(() => {
      const d = document.documentElement;
      const widest = [...document.querySelectorAll('body *')]
        .map((n) => ({ w: Math.round(n.getBoundingClientRect().right), what: n.dataset.testid || n.className }))
        .filter((x) => x.w > d.clientWidth + 1).slice(0, 5);
      return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, widest };
    });
    expect(o.scrollWidth,
      `CLAUDE.md Design: no horizontal scroll at 360px (${where}); widest: ${JSON.stringify(o.widest)}`
    ).toBeLessThanOrEqual(o.clientWidth + 1);
  };

  await noOverflow('open orders closed');
  await openOpenOrders(page);
  await noOverflow('open orders panel');
  await openCancelDialog(page, 'A-041');
  await noOverflow('cancel dialog');
  await cancelKeep(page).click();
  await page.waitForTimeout(300);
  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await noOverflow('edit mode');

  await expectNoConsoleErrors(errors, '#/cash at 360px');
});

test('P5-26b axe: zero serious or critical violations on the Phase V screens', async ({ page }) => {
  await openCashWithBoard(page);

  const axe = async (where) => {
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
    expect(bad, `axe serious/critical on the cash counter, ${where}:\n${detail}`).toEqual([]);
  };

  await openOpenOrders(page);
  await axe('Open orders panel');

  await openCancelDialog(page, 'A-041');
  await axe('cancel dialog');
  await cancelKeep(page).click();
  await page.waitForTimeout(300);

  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await axe('edit mode');
});

test('P5-26c screenshots of the Phase V states', async ({ page }, info) => {
  await openCashWithBoard(page);
  const project = info.project.name;

  await openOpenOrders(page);
  await shot(page, project, 'cash', 'open-orders');

  await openCancelDialog(page, 'A-041');
  await shot(page, project, 'cash', 'cancel');
  await cancelKeep(page).click();
  await page.waitForTimeout(300);

  await startEdit(page, 'A-041');
  await openCashPanel(page);
  await tid(page, 'line-inc-momo').click();
  await page.waitForTimeout(300);
  await shot(page, project, 'cash', 'edit');
});
