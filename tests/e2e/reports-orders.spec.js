// P4-* — Phase IV "Orders list and order detail" (#/reports/orders).
// Spec: CLAUDE.md "Phase IV: Orders list and order detail" 1–10, the
// orchestrator's Phase IV DOM contract, and the mock-ups
// design/ReportsOrders.dc.html (tablet) and design/ReportsOrdersMobile.dc.html
// (phone). Fixture and hand-calculated figures: helpers.ordersFixture /
// ordersExpect, the same numbers as tests/unit/orders-fixtures.js.
//
// Read-only screen: nothing here may write to Firestore (P4-13 proves it).
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import {
  clearFirestore, openApp, gotoRoute, tid, londonDay, heightOf, boxOf,
  seedOrdersDay, ordersExpect, textOf, gbp, parseCsv, shot,
  attachConsole, expectNoConsoleErrors, readCollection, placeOrder,
  ordersNav, ordersRow, ordersOpen, ordersCard, ordersBack, ordersExport,
  orderEntry, openOrder, listedOrders, detailText, detailField
} from './helpers.js';

const isPhone = (info) => info.project.name === 'phone';

/* Mock-up colours, as Chromium reports them. */
const PILL = {
  New: { bg: 'rgb(253, 230, 138)' },                                   // #FDE68A
  Preparing: { bg: 'rgb(191, 219, 254)' },                             // #BFDBFE
  Ready: { bg: 'rgb(15, 118, 110)', fg: 'rgb(255, 255, 255)' },        // #0F766E on white
  Collected: { bg: 'rgb(231, 229, 228)' },                             // #E7E5E4
  Cancelled: { bg: 'rgb(255, 255, 255)', fg: 'rgb(185, 28, 28)' }      // white, #B91C1C
};
const SELECTED_ROW = 'rgb(254, 243, 199)';  // #FEF3C7
const CANCELLED_TOTAL = 'rgb(120, 113, 108)'; // #78716C

/** Open #/reports/orders with the scripted day already rendered. */
async function openOrders(page, query = '') {
  const errors = await openApp(page, '#/reports/orders' + query);
  await expect(tid(page, 'orders-summary')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
  return { errors, X: ordersExpect() };
}

async function summaryText(page) {
  return (await textOf(tid(page, 'orders-summary'))).replace(/\s+/g, ' ').trim();
}

/** The status pill inside a row or card: its computed colours. */
async function pillColours(page, no, label) {
  const entry = orderEntry(page, no);
  return entry.evaluate((root, text) => {
    const hits = [...root.querySelectorAll('*')].filter((n) => (n.textContent || '').trim() === text);
    const el = hits[hits.length - 1];
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color, border: cs.borderTopColor };
  }, label);
}

/** Every cell of a tablet row, with the computed colour of each. */
async function rowCells(page, no) {
  const row = await ordersRow(page, no);
  return row.evaluate((tr) => [...tr.children].map((td) => ({
    text: (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim(),
    colour: getComputedStyle(td).color
  })));
}

async function setSearch(page, text) {
  const box = tid(page, 'orders-search');
  await box.fill(text);
  await box.dispatchEvent('input');
  await page.waitForTimeout(400);
}

async function pickStatus(page, key) {
  await tid(page, `orders-status-${key}`).click();
  await page.waitForTimeout(400);
}

async function pickPay(page, key) {
  await tid(page, `orders-pay-${key}`).click();
  await page.waitForTimeout(400);
}

test.describe('Phase IV — Orders list and order detail', () => {
  test.beforeEach(async () => {
    await clearFirestore();
    await seedOrdersDay();
  });

  /* ------------------------------------------------------------ the tab */

  test('P4-01 the third tab is on all three report screens, with the right labels', async ({ page }, info) => {
    const label = isPhone(info)
      ? { day: 'One day', days: 'By day', orders: 'Orders' }
      : { day: 'One day', days: 'Sales by day', orders: 'Orders' };

    for (const route of ['#/reports', '#/reports/days', '#/reports/orders']) {
      await openApp(page, route);
      await page.waitForTimeout(900);
      const nav = await ordersNav(page);
      await expect(nav, `CLAUDE.md Phase IV 1: the Orders tab is on ${route}`).toBeVisible({ timeout: 20000 });

      const texts = await page.evaluate(() => {
        const read = (id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : null;
        };
        return {
          day: read('report-view-day') || read('report-toggle-day'),
          days: read('report-view-days') || read('report-toggle-days'),
          orders: read('report-view-orders') || read('report-toggle-orders')
        };
      });
      expect(texts.day, `${route}: One day label`).toBe(label.day);
      expect(texts.days, `${route}: by-day label at this width`).toBe(label.days);
      expect(texts.orders, `${route}: Orders label`).toBe(label.orders);

      expect(await heightOf(nav), 'CLAUDE.md Phase III 1 / Phase IV 1: pills at least 48 px')
        .toBeGreaterThanOrEqual(47.5);
    }
  });

  test('P4-02 the current tab is filled ink and each tab navigates', async ({ page }) => {
    const ink = async (id) => page.evaluate((name) => {
      const wrap = document.querySelector(`[data-testid="${name}"]`);
      if (!wrap) return null;
      const node = wrap.matches('a, button') ? wrap : (wrap.querySelector('a, button') || wrap);
      return getComputedStyle(node).backgroundColor;
    }, id);

    await openApp(page, '#/reports/orders');
    await expect(tid(page, 'orders-summary')).toBeVisible({ timeout: 20000 });
    expect(await ink('report-view-orders'), 'the current tab is filled ink #1C1917').toBe('rgb(28, 25, 23)');
    expect(await ink('report-view-day'), 'only the current tab is filled').not.toBe('rgb(28, 25, 23)');
    expect(await ink('report-view-days'), 'only the current tab is filled').not.toBe('rgb(28, 25, 23)');

    const current = await page.getAttribute('[data-testid="report-view-orders"]', 'aria-current');
    expect(current, 'the current tab is marked aria-current="page"').toBe('page');

    // Orders → One day → Orders → Sales by day → Orders
    await tid(page, 'report-view-day').click();
    await page.waitForTimeout(700);
    expect(page.url()).toMatch(/#\/reports(\?|$)/);
    await (await ordersNav(page)).click();
    await page.waitForTimeout(700);
    expect(page.url()).toContain('#/reports/orders');
    await tid(page, 'report-view-days').click();
    await page.waitForTimeout(700);
    expect(page.url()).toContain('#/reports/days');
    await (await ordersNav(page)).click();
    await page.waitForTimeout(700);
    expect(page.url()).toContain('#/reports/orders');
    await expect(tid(page, 'orders-summary')).toBeVisible({ timeout: 15000 });
  });

  /* -------------------------------------------------------------- the day */

  test('P4-03 the day defaults to today and ?day= opens that day', async ({ page }) => {
    const { X } = await openOrders(page);
    expect(await tid(page, 'orders-day').getAttribute('type'), 'Day is a date input').toBe('date');
    expect(await tid(page, 'orders-day').inputValue(), 'CLAUDE.md Phase IV 2: default today')
      .toBe(londonDay());
    expect(await listedOrders(page), "yesterday's order is not on today's list").not.toContain('A-900');

    await page.goto('/#/reports/orders?day=' + X.prevDay);
    await expect(tid(page, 'orders-summary')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(700);
    expect(await tid(page, 'orders-day').inputValue(),
      'CLAUDE.md Phase IV 2: #/reports/orders?day=YYYY-MM-DD opens that day').toBe(X.prevDay);
    expect(await listedOrders(page)).toEqual(['A-900']);
    expect(await summaryText(page), "yesterday's single order").toMatch(/^1 orders? · £5\.00$/);

    // And the date input moves the day back.
    await tid(page, 'orders-day').fill(X.day);
    await tid(page, 'orders-day').dispatchEvent('change');
    await page.waitForTimeout(800);
    expect(await listedOrders(page)).toEqual(X.newestFirst);
  });

  /* ---------------------------------------------------------- the list */

  test('P4-04 the list is newest first and every row matches the seeded order', async ({ page }, info) => {
    const { X } = await openOrders(page);
    expect(await listedOrders(page), 'CLAUDE.md Phase IV 5: newest first').toEqual(X.newestFirst);

    if (isPhone(info)) {
      for (const [no, want] of Object.entries(X.rows)) {
        const card = await ordersCard(page, no);
        const text = (await card.innerText()).replace(/\s+/g, ' ').trim();
        expect(text, `${no}: order number`).toContain(no);
        expect(text, `${no}: name`).toContain(want.name);
        expect(text, `${no}: status`).toContain(want.status);
        expect(text, `${no}: total`).toContain(want.total);
        expect(text, `${no}: "HH:MM · Pay · till X"`).toMatch(
          new RegExp(`${want.time}\\s*·\\s*${want.pay}\\s*·\\s*till\\s*${no[0]}`)
        );
        if (['A-010', 'A-011'].includes(no)) {
          // Retired ids keep their own name (CLAUDE.md Phase IV 9).
          expect(text, `${no}: retired item name`).toMatch(no === 'A-010' ? /Sweets Box/ : /Strawberry/i);
        } else {
          expect(text, `${no}: items`).toContain(want.items);
        }
      }
      return;
    }

    for (const [no, want] of Object.entries(X.rows)) {
      const cells = (await rowCells(page, no)).map((c) => c.text);
      expect(cells[0], `${no}: the Order column shows the order number`).toContain(no);
      expect(cells[1], `${no}: Time`).toBe(want.time);
      expect(cells[2], `${no}: Name`).toBe(want.name);
      if (['A-010', 'A-011'].includes(no)) {
        expect(cells[3], `${no}: retired item name`).toMatch(no === 'A-010' ? /Sweets Box/ : /Strawberry/i);
      } else {
        expect(cells[3], `${no}: Items in menu short names`).toBe(want.items);
      }
      expect(cells[4], `${no}: Total`).toBe(want.total);
      expect(cells[5], `${no}: Pay`).toBe(want.pay);
      expect(cells[6], `${no}: Status`).toBe(want.status);
      expect(cells[7], `${no}: Wait`).toBe(want.wait);
    }

    // The Order cell is a real button that opens the detail.
    const open = await ordersOpen(page, 'A-041');
    expect(await open.evaluate((el) => el.tagName.toLowerCase()),
      'CLAUDE.md Phase IV 5: Order is a real <button>').toBe('button');
    expect(await open.getAttribute('aria-label')).toMatch(/A-041/);
  });

  test('P4-05 status pill colours and the grey cancelled total', async ({ page }) => {
    const { X } = await openOrders(page);
    for (const [no, want] of Object.entries(X.rows)) {
      const got = await pillColours(page, no, want.status);
      expect(got, `${no}: a ${want.status} pill`).not.toBeNull();
      const expected = PILL[want.status];
      expect(got.bg, `${no}: ${want.status} pill background`).toBe(expected.bg);
      if (expected.fg) expect(got.fg, `${no}: ${want.status} pill text`).toBe(expected.fg);
      if (want.status === 'Cancelled') {
        expect(got.border, 'cancelled: #B91C1C border').toBe('rgb(185, 28, 28)');
      }
    }
  });

  test('P4-06 the summary line reflects the filters (CLAUDE.md Phase IV 4)', async ({ page }, info) => {
    const { X } = await openOrders(page);
    expect(await summaryText(page)).toBe(X.summary);

    const cases = [
      ['new', X.filters.new], ['preparing', X.filters.preparing], ['ready', X.filters.ready],
      ['collected', X.filters.collected], ['cancelled', X.filters.cancelled], ['all', X.filters.all]
    ];
    for (const [key, want] of cases) {
      await pickStatus(page, key);
      const text = await summaryText(page);
      expect(text, `status=${key}: count`).toMatch(new RegExp(`^${want.rows.length} orders?\\b`));
      expect(text, `status=${key}: total excludes cancelled`).toContain(gbp(want.total));
      if (want.cancelled) expect(text, `status=${key}: clause`).toContain(`(excludes ${want.cancelled} cancelled)`);
      else expect(text, `status=${key}: no clause when c = 0`).not.toMatch(/exclude/i);
    }

    if (!isPhone(info)) {
      for (const [key, want] of [['cash', X.filters.cash], ['card', X.filters.card]]) {
        await pickPay(page, key);
        const text = await summaryText(page);
        expect(text, `pay=${key}: count`).toMatch(new RegExp(`^${want.rows.length} orders?\\b`));
        expect(text, `pay=${key}: total`).toContain(gbp(want.total));
      }
      await pickPay(page, 'all');
    }
  });

  test('P4-07 every filter, searching and the empty message', async ({ page }, info) => {
    const { X } = await openOrders(page);

    for (const key of ['new', 'preparing', 'ready', 'collected', 'cancelled']) {
      await pickStatus(page, key);
      expect(await listedOrders(page), `status=${key}`).toEqual(X.filters[key].rows);
      expect(await tid(page, `orders-status-${key}`).getAttribute('aria-pressed'),
        `status=${key} is the pressed button`).toBe('true');
    }
    await pickStatus(page, 'all');
    expect(await listedOrders(page)).toEqual(X.filters.all.rows);

    if (!isPhone(info)) {
      for (const key of ['cash', 'card']) {
        await pickPay(page, key);
        expect(await listedOrders(page), `pay=${key}`).toEqual(X.filters[key].rows);
      }
      await pickPay(page, 'all');
    } else {
      await expect(tid(page, 'orders-pay-cash'),
        'CLAUDE.md Phase IV 2: no payment filter on the phone').toHaveCount(0);
    }

    for (const [term, want] of Object.entries(X.searches)) {
      await setSearch(page, term);
      expect(await listedOrders(page), `search "${term}" (case-insensitive, trimmed)`).toEqual(want.rows);
      if (want.rows.length === 0) {
        const empty = tid(page, 'orders-empty');
        await expect(empty, 'CLAUDE.md Phase IV 5: the empty message').toBeVisible();
        expect(await textOf(empty)).toBe('No orders match these filters.');
      }
    }
    await setSearch(page, '');

    // Combination: Collected + Cash + "a-0".
    await pickStatus(page, 'collected');
    if (!isPhone(info)) {
      await pickPay(page, 'cash');
      await setSearch(page, 'a-0');
      expect(await listedOrders(page), 'status + payment + search together').toEqual(X.combination.rows);
      expect(await summaryText(page)).toContain(gbp(X.combination.total));
    } else {
      await setSearch(page, 'a-0');
      expect(await listedOrders(page), 'status + search together')
        .toEqual(['A-041', 'A-040', 'A-011', 'A-010']);
    }
  });

  test('P4-08 a cancelled order is listed but kept out of the total', async ({ page }, info) => {
    const { X } = await openOrders(page);
    const entry = orderEntry(page, 'A-044');
    await expect(entry, 'CLAUDE.md Phase IV 3: cancelled orders are listed').toBeVisible();
    expect(await summaryText(page)).toBe(X.summary);
    // £95.00, not the £105.00 that would include the cancelled £10.00 order.
    expect(await summaryText(page)).not.toContain(gbp(10500));

    if (!isPhone(info)) {
      const cells = await rowCells(page, 'A-044');
      expect(cells[4].text).toBe('£10.00');
      expect(cells[4].colour, 'CLAUDE.md Phase IV 5: a cancelled total is grey').toBe(CANCELLED_TOTAL);
    }
  });

  /* ------------------------------------------------------------- detail */

  test('P4-09 the detail shows every field of the selected order', async ({ page }, info) => {
    const { X } = await openOrders(page);

    if (!isPhone(info)) {
      await expect(tid(page, 'order-detail-empty'),
        'CLAUDE.md Phase IV 6: nothing is selected to start with').toBeVisible();
      expect(await textOf(tid(page, 'order-detail-empty'))).toBe('Select an order to see its items.');
    }

    const want = X.detail['A-041'];
    await openOrder(page, 'A-041');
    const panel = tid(page, 'order-detail');
    await expect(panel).toBeVisible({ timeout: 10000 });
    const text = await detailText(page);

    expect(await detailField(page, 'order-detail-no') ?? text, 'order number').toContain('A-041');
    expect(await detailField(page, 'order-detail-name') ?? text, 'name').toContain('Priya');
    expect(await detailField(page, 'order-detail-status') ?? text, 'status pill').toContain(want.status);
    expect(await detailField(page, 'order-detail-till') ?? text, 'Till').toContain(want.till);
    expect(await detailField(page, 'order-detail-pay') ?? text, 'Payment').toContain(want.pay);
    expect(await detailField(page, 'order-detail-placed') ?? text, 'Placed time').toContain(want.time);
    expect(await detailField(page, 'order-detail-wait') ?? text, 'Wait').toContain(want.wait);
    expect(await detailField(page, 'order-detail-total') ?? text, 'Total').toContain(want.total);

    if (!isPhone(info)) {
      expect(await detailField(page, 'order-detail-placed') ?? text,
        'CLAUDE.md Phase IV 6: Placed shows the day as well as the time').toMatch(/\d{2}:\d{2}/);
    }

    // Timeline: Placed → Started → Ready → Collected with their times.
    for (const [key, time] of want.steps) {
      const step = tid(page, `order-step-${key}`);
      await expect(step, `timeline step ${key}`).toBeVisible();
      expect((await step.innerText()).replace(/\s+/g, ' ').trim(), `step ${key} time`).toContain(time);
    }
    await expect(tid(page, 'order-step-cancelled'), 'a collected order has no Cancelled step').toHaveCount(0);

    // Items: name, qty, price, line total, and a Total row
    // (CLAUDE.md Phase IV 6: "Items table with icon, name, qty, price, line total").
    expect(text, 'the Fuchka line').toContain('Fuchka');
    expect(text, 'the Momo line').toContain('Momo');
    expect(text, 'line total 2 × £5.00').toContain('£10.00');
    expect(text, 'order total').toContain('£15.00');

    if (!isPhone(info)) {
      const lines = await tid(page, 'order-detail-items').evaluate((table) =>
        [...table.querySelectorAll('tbody tr')].map((tr) =>
          [...tr.children].map((td) => (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim())));
      const fuchka = lines.find((r) => r[0].includes('Fuchka'));
      const momo = lines.find((r) => r[0].includes('Momo'));
      expect(fuchka, 'a Fuchka row in the items table').toBeTruthy();
      expect(fuchka.slice(1, 4), 'qty, price, line total').toEqual(['2', '£5.00', '£10.00']);
      expect(momo.slice(1, 4)).toEqual(['1', '£5.00', '£5.00']);
      const totalRow = lines.find((r) => r[0] === 'Total') || [];
      expect(totalRow.join(' '), 'a Total row').toContain('£15.00');
      const icons = await tid(page, 'order-detail-items').locator('svg').count();
      expect(icons, 'each item line carries its icon').toBeGreaterThanOrEqual(2);
    } else {
      expect(text, 'the phone detail shows the quantity').toMatch(/2\s*×?\s*Fuchka|Fuchka[^£]*\b2\b/);
    }

    if (!isPhone(info)) {
      const note = await detailField(page, 'order-detail-note');
      // CLAUDE.md Phase V 5 rewrites this note: "Update the detail note to
      // 'Read-only. Orders are edited and cancelled from the cash counter;
      // status changes happen on the food counter.'"
      expect(note, 'CLAUDE.md Phase IV 6 as amended by Phase V 5: the read-only note').toBe(
        'Read-only. Orders are edited and cancelled from the cash counter; status changes happen on the food counter. ' +
        'Cancelled orders are listed but excluded from every total.'
      );
    }
  });

  test('P4-10 an unfinished order shows "—" and a cancelled order shows Placed → Cancelled', async ({ page }) => {
    const { X } = await openOrders(page);

    await openOrder(page, 'A-043'); // preparing
    for (const [key, time] of X.detail['A-043'].steps) {
      const step = tid(page, `order-step-${key}`);
      await expect(step).toBeVisible();
      expect((await step.innerText()).replace(/\s+/g, ' ').trim(), `step ${key}`).toContain(time);
    }
    expect(await detailField(page, 'order-detail-wait') ?? await detailText(page),
      'not ready yet: the wait is "—"').toContain('—');

    await gotoRoute(page, '#/reports/orders');
    await page.waitForTimeout(600);
    await openOrder(page, 'A-044'); // cancelled
    await expect(tid(page, 'order-step-placed')).toBeVisible();
    await expect(tid(page, 'order-step-cancelled'),
      'CLAUDE.md Phase IV 6: Placed → Cancelled').toBeVisible();
    await expect(tid(page, 'order-step-started'), 'a cancelled order has no Started step').toHaveCount(0);
    await expect(tid(page, 'order-step-ready')).toHaveCount(0);
    await expect(tid(page, 'order-step-collected')).toHaveCount(0);
    const text = await detailText(page);
    expect(text).toContain('10:55');
    expect(text).toContain('10:56');
  });

  test('P4-20 a retired item keeps its own name and icon in the detail', async ({ page }) => {
    await openOrders(page);
    await openOrder(page, 'A-010');          // 2x the retired `samosa`
    const text = await detailText(page);
    expect(text, 'CLAUDE.md Phase IV 9: the retired item keeps its original name')
      .toMatch(/Sweets Box/);
    expect(text, 'it is not relabelled as the live Samosa item').not.toMatch(/\bSamosa\b(?! \/ Shingara)/);

    const icons = await tid(page, 'order-detail').locator('svg').count();
    expect(icons, 'CLAUDE.md Phase IV 6, 9: each item line carries its icon').toBeGreaterThan(0);

    // When the lines carry per-item test ids, the retired id is the one used.
    const retired = page.locator('[data-testid="order-line-samosa"]');
    if (await retired.count()) {
      await expect(retired).toHaveCount(1);
      await expect(page.locator('[data-testid="order-line-samosa_only"]'),
        'the retired line must not be drawn as the new item').toHaveCount(0);
    }
  });

  test('P4-11 tablet: the selected row is shaded and the panel sits beside the list', async ({ page }, info) => {
    test.skip(isPhone(info), 'the side-by-side detail panel is the tablet layout');
    await openOrders(page);

    await openOrder(page, 'A-041');
    const bg = await (await ordersRow(page, 'A-041')).evaluate((tr) => {
      const own = getComputedStyle(tr).backgroundColor;
      if (own && !/rgba\(0, 0, 0, 0\)/.test(own)) return own;
      return getComputedStyle(tr.children[0]).backgroundColor;
    });
    expect(bg, 'CLAUDE.md Phase IV 5: the selected row is shaded #FEF3C7').toBe(SELECTED_ROW);

    const other = await (await ordersRow(page, 'A-040')).evaluate((tr) => getComputedStyle(tr).backgroundColor);
    expect(other, 'only the selected row is shaded').not.toBe(SELECTED_ROW);

    const list = await boxOf(tid(page, 'orders-table'));
    const detail = await boxOf(tid(page, 'order-detail'));
    expect(detail.x, 'at 1280 px the detail is to the right of the list')
      .toBeGreaterThanOrEqual(list.x + list.width - 2);

    // Under 1100 px it stacks underneath (CLAUDE.md Phase IV 6).
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(700);
    const list2 = await boxOf(tid(page, 'orders-table'));
    const detail2 = await boxOf(tid(page, 'order-detail'));
    expect(detail2.y, 'below 1100 px the detail stacks below the list')
      .toBeGreaterThanOrEqual(list2.y + list2.height - 2);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('P4-12 phone: a card opens the full-screen detail, and both ways back work', async ({ page }, info) => {
    test.skip(!isPhone(info), 'the full-screen detail is the phone layout');
    await openOrders(page);

    await expect(tid(page, 'orders-list')).toBeVisible();
    await openOrder(page, 'A-041');
    await expect(tid(page, 'order-detail')).toBeVisible({ timeout: 10000 });
    await expect(tid(page, 'orders-list'), 'the detail takes the whole screen').toBeHidden();

    // The "All orders" button.
    const back = await ordersBack(page);
    await expect(back, 'CLAUDE.md Phase IV 7: an "All orders" back button').toBeVisible();
    expect((await back.innerText()).replace(/\s+/g, ' ').trim()).toContain('All orders');
    expect(await heightOf(back), 'touch target').toBeGreaterThanOrEqual(43.5);
    await back.click();
    await page.waitForTimeout(600);
    await expect(tid(page, 'orders-list')).toBeVisible();
    await expect(tid(page, 'order-detail')).toBeHidden();

    // The browser back button.
    await openOrder(page, 'A-042');
    await expect(tid(page, 'order-detail')).toBeVisible({ timeout: 10000 });
    await page.goBack();
    await page.waitForTimeout(800);
    await expect(tid(page, 'orders-list'),
      'CLAUDE.md Phase IV 7: the browser back button also returns to the list').toBeVisible();
    await expect(tid(page, 'order-detail')).toBeHidden();
    expect(await listedOrders(page), 'the list comes back with its rows').toHaveLength(9);
  });

  /* --------------------------------------------------------------- live */

  test('P4-13 a status change on the kitchen reaches the Orders screen without a reload', async ({ page, browser }) => {
    const { X } = await openOrders(page);
    expect(await listedOrders(page)).toEqual(X.newestFirst);

    const other = await browser.newContext();
    const kitchen = await other.newPage();
    await kitchen.goto('/#/kitchen');
    await expect(kitchen.locator('[data-testid="order-card-B-019"]')).toBeVisible({ timeout: 20000 });
    await kitchen.locator('[data-testid="action-B-019"]').click();   // New → Preparing
    await kitchen.waitForTimeout(500);

    const entry = orderEntry(page, 'B-019');
    await expect(entry, 'CLAUDE.md Phase IV 3: live onSnapshot, no refresh')
      .toContainText('Preparing', { timeout: 10000 });

    // A brand new order arrives live too.
    const cash = await other.newPage();
    await cash.goto('/#/cash');
    await expect(cash.locator('[data-testid="tile-momo"]')).toBeVisible({ timeout: 20000 });
    const no = await placeOrder(cash, { items: { momo: 1 }, name: 'Live', payment: 'cash' });
    await expect(orderEntry(page, no), 'a new order appears without a refresh')
      .toBeVisible({ timeout: 10000 });
    expect(await summaryText(page)).toMatch(/^10 orders/);
    expect(await summaryText(page)).toContain(gbp(X.liveTotal + 500));

    await other.close();
  });

  /* ---------------------------------------------------------------- CSV */

  test('P4-14 "Export these orders (CSV)" exports the filtered set', async ({ page }, info) => {
    test.skip(isPhone(info), 'design/ReportsOrdersMobile.dc.html has no export control on the phone');
    const { X } = await openOrders(page);
    const button = await ordersExport(page);
    await expect(button, 'CLAUDE.md Phase IV 8').toBeVisible();
    expect((await button.innerText()).replace(/\s+/g, ' ').trim()).toContain('Export these orders');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      button.click()
    ]);
    expect(download.suggestedFilename(), 'CLAUDE.md Phase IV 8: nba-food-stall_orders_<day>.csv')
      .toBe(`nba-food-stall_orders_${X.day}.csv`);

    const text = readFileSync(await download.path(), 'utf8');
    expect(text.split(/\r?\n/)[0], 'same columns as the One day CSV')
      .toBe('day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds,edited,cancelReason');
    const rows = parseCsv(text);
    const col = (n) => rows[0].indexOf(n);
    const body = rows.slice(1);
    expect(body, 'one row per line of every order on screen').toHaveLength(X.csvLines.all);
    expect(body.map((r) => r[col('orderNo')]),
      'CLAUDE.md Phase IV 8: the orders currently shown, and a cancelled order is shown (Phase IV 5)'
    ).toContain('A-044');
    expect(body.find((r) => r[col('orderNo')] === 'A-044')[col('status')],
      'the status column says it was cancelled').toBe('cancelled');
    expect(body.map((r) => r[col('orderNo')]), "yesterday's order is not in today's export").not.toContain('A-900');
    for (const r of body) {
      expect(r).toHaveLength(15);
      expect(r[col('day')]).toBe(X.day);
      expect(Number(r[col('lineTotal')])).toBe(Number(r[col('qty')]) * Number(r[col('price')]));
    }
    const order = [];
    for (const r of body) if (order[order.length - 1] !== r[col('orderNo')]) order.push(r[col('orderNo')]);
    expect(order, 'the export follows the list, newest first').toEqual(X.newestFirst);
    expect(text, 'the Phase I tendered field is never exported').not.toMatch(/tendered/i);
    const legacy = body.find((r) => r[col('orderNo')] === 'A-010');
    expect(legacy[col('item')], 'CLAUDE.md Phase IV 9: retired items keep their original name')
      .toBe('Sweets Box Samosa / Shingara');

    // Narrow the filters and export again: only what is on screen.
    await pickPay(page, 'cash');
    const [cashDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      (await ordersExport(page)).click()
    ]);
    const cashRows = parseCsv(readFileSync(await cashDownload.path(), 'utf8')).slice(1);
    expect(cashRows, 'CLAUDE.md Phase IV 8: the orders currently shown').toHaveLength(X.csvLines.cash);
    expect(new Set(cashRows.map((r) => r[col('payment')]))).toEqual(new Set(['cash']));

    // Filtering to Cancelled must still produce a row, not an empty file.
    await pickPay(page, 'all');
    await pickStatus(page, 'cancelled');
    const [cancelledDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      (await ordersExport(page)).click()
    ]);
    const cancelledText = readFileSync(await cancelledDownload.path(), 'utf8');
    expect(cancelledText.split(/\r?\n/)[0], 'the same columns').toBe(
      'day,orderNo,till,name,item,qty,price,lineTotal,payment,status,createdAt,readyAt,waitSeconds,edited,cancelReason');
    const cancelledRows = parseCsv(cancelledText).slice(1);
    expect(cancelledRows, 'a Cancelled-only view exports its row, not an empty file')
      .toHaveLength(X.csvLines.cancelled);
    expect(cancelledRows[0][col('orderNo')]).toBe('A-044');
    expect(cancelledRows[0][col('status')]).toBe('cancelled');
  });

  /* ---------------------------------------------------------- read-only */

  test('P4-15 the screen writes nothing to Firestore', async ({ page }, info) => {
    const fingerprint = async () => (await readCollection('orders'))
      .map((o) => [o._id, o.orderNo, o.status, o.total, o.day].join('|')).sort().join('\n');
    const before = await fingerprint();

    const { X } = await openOrders(page);
    const writes = [];
    page.on('request', (req) => {
      const url = req.url();
      if (!/127\.0\.0\.1:8080|localhost:8080/.test(url)) return;
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) {
        const body = (() => { try { return req.postData() || ''; } catch { return ''; } })();
        // The Firestore Web SDK tunnels listens through POST /Listen and
        // /Write channels; only a body carrying a document write counts.
        if (/"writes"|commit|"update"\s*:/i.test(body)) writes.push(req.method() + ' ' + url);
      }
    });

    await pickStatus(page, 'collected');
    if (!isPhone(info)) await pickPay(page, 'cash');
    await setSearch(page, 'a-0');
    await openOrder(page, 'A-041');
    await page.waitForTimeout(1200);

    expect(writes, `CLAUDE.md Phase IV: "Read-only … no writes"\n${writes.join('\n')}`).toEqual([]);
    expect(await fingerprint(), 'no order document changed').toBe(before);
    expect((await readCollection('orders')).length).toBe(10);
    expect(X.rowCount).toBe(9);
  });

  /* ------------------------------------------------------------ quality */

  test('P4-16 no horizontal scroll at 360 px and touch targets hold', async ({ page }) => {
    await openOrders(page);
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('main button, main a[href], main input, main select')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()}[${el.dataset.testid || (el.textContent || '').trim().slice(0, 16)}] = ${Math.round(r.height)}px`);
      }
      return out;
    });
    expect(small, `CLAUDE.md Design / Phase IV: filter controls at least 44 px\n${small.join('\n')}`).toEqual([]);

    const navHeights = await page.evaluate(() => ['report-view-day', 'report-view-days', 'report-view-orders']
      .map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      }));
    for (const h of navHeights) expect(h, 'the report tabs are at least 48 px').toBeGreaterThanOrEqual(47);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth, 'CLAUDE.md Design: no horizontal scroll at 360 px')
      .toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test('P4-17 no console errors on the list or the detail', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto('/#/reports/orders');
    await expect(tid(page, 'orders-summary')).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(800);
    await openOrder(page, 'A-041');
    await page.waitForTimeout(600);
    // On the phone the detail is full screen: the filters are only on the list.
    await gotoRoute(page, '#/reports/orders');
    await expect(tid(page, 'orders-summary')).toBeVisible({ timeout: 15000 });
    await pickStatus(page, 'cancelled');
    await setSearch(page, 'zzz');
    await page.waitForTimeout(600);
    await expectNoConsoleErrors(errors, '#/reports/orders');
  });

  test('P4-18 axe finds no serious or critical violations, list or detail', async ({ page }) => {
    await openOrders(page);
    for (const state of ['list', 'detail']) {
      if (state === 'detail') {
        await openOrder(page, 'A-041');
        await page.waitForTimeout(600);
      }
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
      expect(bad, `#/reports/orders (${state}) axe serious/critical violations:\n${detail}`).toEqual([]);
    }
  });

  test('P4-19 screenshots of the orders report: list, detail and empty', async ({ page }, info) => {
    const project = 'p4-' + info.project.name;
    await openOrders(page);
    await shot(page, project, 'orders', 'list');

    await openOrder(page, 'A-041');
    await page.waitForTimeout(500);
    await shot(page, project, 'orders', 'detail');

    await gotoRoute(page, '#/reports/orders');
    await page.waitForTimeout(500);
    await setSearch(page, 'zzz');
    await expect(tid(page, 'orders-empty')).toBeVisible({ timeout: 10000 });
    await shot(page, project, 'orders', 'empty');
  });
});
