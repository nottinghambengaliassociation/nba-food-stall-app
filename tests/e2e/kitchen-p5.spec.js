/**
 * P5-K-* — Phase V (v1.4.0): what the food counter sees when an order is
 * edited or cancelled.
 *
 * Spec: CLAUDE.md -> "Phase V" item 4 and the status table at the head of that
 * section ("Only the cash counter edits or cancels. The food counter never
 * edits or cancels; it sees changes live"), plus
 * design/FoodCounterChanges.dc.html.
 * Plan: qa/test-plan.md section 50.
 *
 * This file tests the brief. Where the app disagrees with it, the app is wrong.
 *
 * Emulator only. Nothing here touches live Firestore.
 */
import { test, expect } from './session.js';
import AxeBuilder from '@axe-core/playwright';
import {
  clearFirestore, openApp, tid, boxOf, heightOf, expectNoConsoleErrors,
  waitForOrders, readCollection, seedDoc, londonDay, londonTimeOn, shot,
  viewportWidth, orderByNo, waitForOrder, startEdit, saveEdit, openCashPanel,
  cancelOrderWithReason, seedP5Day, patchDoc
} from './helpers.js';

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const r2 = (n) => Math.round(n * 100) / 100;

const DAY = () => londonDay();
const l = (id, name, qty) => ({ id, name, qty, price: 500 });
const minsAgo = (n) => Date.now() - n * 60000;

const isPhone = (page) => viewportWidth(page) < 700;

/** Open the food counter and wait for the board. */
async function openKitchen(page) {
  const errors = await openApp(page, '#/kitchen');
  await expect(page.locator('header').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
  return errors;
}

/** Bring a card into view: phone shows one tab at a time. */
async function showLane(page, lane) {
  if (!isPhone(page)) return;
  const tab = tid(page, `tab-${lane}`);
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(300);
  }
}

const card = (page, no) => tid(page, `order-card-${no}`);
const lineTag = (page, no, id) => page.locator([
  `[data-testid="line-tag-${no}-${id}"]`,
  `[data-testid="order-line-${no}-${id}"] .line-tag`
].join(', ')).first();
const gotIt = (page, no) => page.locator([
  `[data-testid="got-it-${no}"]`,
  `[data-testid="order-card-${no}"] button:has-text("Got it")`
].join(', ')).first();
const removeBtn = (page, no) => page.locator([
  `[data-testid="remove-${no}"]`,
  `[data-testid="order-card-${no}"] button:has-text("Remove")`
].join(', ')).first();

/** The number shown on a column (tablet) or tab (phone) header. */
async function laneCount(page, lane) {
  const holder = isPhone(page) ? tid(page, `tab-${lane}`) : tid(page, `col-${lane}`);
  if (!(await holder.count())) return null;
  const text = norm(await holder.innerText());
  const m = text.match(/\d+/);
  return m ? Number(m[0]) : null;
}

test.beforeEach(async () => { await clearFirestore(); });

/* ==================================================== P5-K-01 no controls */

test('P5-K-01 the food counter never edits or cancels', async ({ page }) => {
  await seedP5Day();
  const errors = await openKitchen(page);

  for (const lane of ['new', 'preparing', 'ready']) {
    await showLane(page, lane);
    const text = norm(await page.locator('main, body').first().innerText());
    expect(text, `CLAUDE.md Phase V: "The food counter never edits or cancels" (${lane} lane)`)
      .not.toMatch(/\bEdit\b/);
    expect(text, `the ${lane} lane offers no cancel`).not.toMatch(/Cancel(…|\.\.\.)/);
  }

  for (const name of ['open-orders', 'open-orders-drawer', 'cancel-dialog', 'edit-banner']) {
    const el = tid(page, name);
    if (await el.count()) {
      expect(await el.isVisible().catch(() => false),
        `"${name}" belongs to the cash counter; CLAUDE.md Phase V: "Only the cash counter edits or cancels"`
      ).toBe(false);
    }
  }
  for (const no of ['A-041', 'A-042', 'A-044']) {
    expect(await tid(page, `edit-${no}`).count(), `no Edit button for ${no} on the food counter`).toBe(0);
    expect(await tid(page, `cancel-${no}`).count(), `no Cancel button for ${no} on the food counter`).toBe(0);
  }

  await expectNoConsoleErrors(errors, '#/kitchen');
});

/* ================================================== P5-K-02 a new order edited */

test('P5-K-02 a New order edited updates in place with a "Changed" tag until Start', async ({ page, context }) => {
  await seedP5Day();
  const errors = await openKitchen(page);
  await showLane(page, 'new');
  await expect(card(page, 'A-044')).toBeVisible({ timeout: 20000 });
  const before = await boxOf(card(page, 'A-044'));

  // The cash counter edits it in a second context.
  const cash = await context.newPage();
  await cash.goto('/#/cash');
  await expect(cash.locator('[data-testid="tile-fuchka"]')).toBeVisible({ timeout: 20000 });
  await startEdit(cash, 'A-044');
  await openCashPanel(cash);
  await cash.locator('[data-testid="line-inc-chat"]').click();
  await cash.waitForTimeout(250);
  await saveEdit(cash);
  await waitForOrder('A-044', (o) => Number(o.editCount) > 0, { label: 'the edit to land' });
  await cash.close();

  // Within 2 s, without a reload.
  await expect(card(page, 'A-044'),
    'CLAUDE.md Phase V 4: "the card updates in place"'
  ).toContainText('2×', { timeout: 6000 });
  const tag = page.locator([
    `[data-testid="changed-tag-A-044"]`,
    `[data-testid="order-card-A-044"] :text-is("Changed")`
  ].join(', ')).first();
  await expect(tag, 'CLAUDE.md Phase V 4: a small "Changed" tag').toBeVisible({ timeout: 6000 });

  const after = await boxOf(card(page, 'A-044'));
  expect(Math.abs(after.x - before.x), 'the card stays where it was, in the New column').toBeLessThanOrEqual(2);

  // The tag goes once Start is tapped.
  await tid(page, 'action-A-044').click();
  await waitForOrders((o) => o.some((x) => x.orderNo === 'A-044' && x.status === 'preparing'),
    { label: 'A-044 to start' });
  await showLane(page, 'preparing');
  await expect(tag, 'CLAUDE.md Phase V 4: the tag lasts "until Start"').toBeHidden({ timeout: 8000 });

  await expectNoConsoleErrors(errors, '#/kitchen with an edited new order');
});

/* ============================================ P5-K-03 a preparing order edited */

test('P5-K-03 a Preparing order edited shows the amber card and needs Got it', async ({ page }, info) => {
  // Seeded directly so the "what changed" wording is pinned to known data.
  const day = DAY();
  await seedDoc('orders', {
    orderNo: 'A-041', name: 'Ahmed', till: 'A', day, payment: 'cash', status: 'preparing',
    items: [l('momo', 'Momo', 3), l('fuchka', 'Fuchka / Gol Gappa', 1)], total: 2000,
    createdAtMs: minsAgo(5), startedAtMs: minsAgo(4),
    editCount: 1, editedAtMs: minsAgo(1),
    history: [{
      atMs: minsAgo(1), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 500,
      before: { items: [l('momo', 'Momo', 2), l('chat', 'Papri Chat', 1)], total: 1500, name: 'Ahmed', payment: 'cash' }
    }]
  });

  const errors = await openKitchen(page);
  await showLane(page, 'preparing');
  const c = card(page, 'A-041');
  await expect(c).toBeVisible({ timeout: 20000 });

  const banner = page.locator([
    '[data-testid="changed-banner-A-041"]',
    '[data-testid="order-card-A-041"] [role="alert"]'
  ].join(', ')).first();
  await expect(banner, 'CLAUDE.md Phase V 4: an amber "ORDER CHANGED · CHECK ITEMS" header')
    .toBeVisible({ timeout: 10000 });
  expect(norm(await banner.innerText())).toMatch(/ORDER CHANGED\s*·\s*CHECK ITEMS/i);

  // Amber card.
  const colours = await c.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopColor };
  });
  const [br, bg, bb] = (colours.border.match(/\d+/g) || []).map(Number);
  expect(br > 120 && br > bb && bg < br,
    `the changed card border is ${colours.border}; CLAUDE.md Phase V 4 paints it amber (#B45309)`
  ).toBe(true);

  // Line tags from the latest history entry's `before`.
  expect(norm(await lineTag(page, 'A-041', 'momo').innerText()),
    'CLAUDE.md Phase V 4: "+1 (was 2)"'
  ).toMatch(/^\+1 \(was 2\)$/);
  expect(norm(await lineTag(page, 'A-041', 'fuchka').innerText()),
    'CLAUDE.md Phase V 4: a line that was not there is NEW'
  ).toMatch(/^NEW$/i);
  const removedLine = tid(page, 'order-line-A-041-chat');
  await expect(removedLine, 'the removed line is still shown, struck through').toBeVisible();
  expect(norm(await removedLine.innerText()), 'CLAUDE.md Phase V 4: REMOVED').toMatch(/REMOVED/i);
  const struck = await removedLine.evaluate((el) => [el, ...el.querySelectorAll('*')]
    .some((n) => /line-through/.test(getComputedStyle(n).textDecorationLine)));
  expect(struck, 'the removed line is struck through').toBe(true);

  // The note.
  const note = tid(page, 'change-note-A-041');
  await expect(note).toBeVisible();
  expect(norm(await note.innerText()),
    'CLAUDE.md Phase V 4: "Changed at till A, 1 min ago"'
  ).toMatch(/Changed at till A/i);

  // Ready is replaced by Got it.
  const action = tid(page, 'action-A-041');
  if (await action.count()) {
    expect(await action.isVisible().catch(() => false),
      'CLAUDE.md Phase V 4: "The Ready button is replaced by Got it"'
    ).toBe(false);
  }
  const ack = gotIt(page, 'A-041');
  await expect(ack, 'CLAUDE.md Phase V 4: a Got it button').toBeVisible();
  const h = await heightOf(ack);
  expect(h, `Got it is ${r2(h)}px tall; CLAUDE.md Phase V 4 says 64 px`).toBeGreaterThanOrEqual(62);
  const ackColour = await ack.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [ar, ag, ab] = (ackColour.match(/\d+/g) || []).map(Number);
  expect(ar > 120 && ar > ab && ag < ar, `Got it is ${ackColour}; CLAUDE.md Phase V 4 says #B45309`).toBe(true);

  // Tapping it writes changeSeenAtMs and gives Ready back.
  await ack.click();
  const after = await waitForOrder('A-041', (o) => Number(o.changeSeenAtMs) > 0, { label: 'Got it to write' });
  expect(Number(after.changeSeenAtMs),
    'CLAUDE.md Phase V 4: "Got it ... writes changeSeenAtMs"'
  ).toBeGreaterThan(0);
  expect(after.status, 'Got it does not move the order on').toBe('preparing');

  await expect(banner, 'the amber header clears once it has been seen').toBeHidden({ timeout: 8000 });
  await expect(tid(page, 'action-A-041'), 'and Ready comes back').toBeVisible({ timeout: 8000 });

  await shot(page, info.project.name, 'kitchen', 'changed');
  await expectNoConsoleErrors(errors, '#/kitchen with a changed card');
});

test('P5-K-04 a second edit after Got it brings the amber card back', async ({ page }) => {
  const day = DAY();
  await seedDoc('orders', {
    orderNo: 'A-041', name: 'Ahmed', till: 'A', day, payment: 'cash', status: 'preparing',
    items: [l('momo', 'Momo', 3)], total: 1500,
    createdAtMs: minsAgo(6), startedAtMs: minsAgo(5),
    editCount: 1, editedAtMs: minsAgo(3), changeSeenAtMs: minsAgo(2),
    history: [{
      atMs: minsAgo(3), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 500,
      before: { items: [l('momo', 'Momo', 2)], total: 1000, name: 'Ahmed', payment: 'cash' }
    }]
  });

  await openKitchen(page);
  await showLane(page, 'preparing');
  await expect(card(page, 'A-041')).toBeVisible({ timeout: 20000 });
  await expect(tid(page, 'changed-banner-A-041'),
    'seen already: editedAtMs is older than changeSeenAtMs, so the card is ordinary'
  ).toBeHidden();
  await expect(tid(page, 'action-A-041'), 'Ready is available again').toBeVisible();

  // A newer edit lands.
  const doc = await orderByNo('A-041');
  const { _id, ...fields } = doc;
  await patchDoc('orders', _id, {
    ...fields,
    items: [l('momo', 'Momo', 4)], total: 2000,
    editCount: 2, editedAtMs: Date.now(),
    history: [...doc.history, {
      atMs: Date.now(), action: 'edit', till: 'B', fromStatus: 'preparing', deltaPence: 500,
      before: { items: [l('momo', 'Momo', 3)], total: 1500, name: 'Ahmed', payment: 'cash' }
    }]
  });

  await expect(tid(page, 'changed-banner-A-041'),
    'CLAUDE.md Phase V 4: "edited after the last Got it (editedAtMs > changeSeenAtMs)"'
  ).toBeVisible({ timeout: 10000 });
});

/* ========================================== P5-K-05 / P5-K-06 cancelled cards */

test('P5-K-05 cancelled from preparing: a red STOP MAKING card until Remove', async ({ page }, info) => {
  const day = DAY();
  await seedDoc('orders', {
    orderNo: 'A-039', name: 'Tom', till: 'A', day, payment: 'cash', status: 'cancelled',
    items: [l('samosa_only', 'Samosa', 1), l('fuchka', 'Fuchka / Gol Gappa', 1)], total: 1000,
    createdAtMs: minsAgo(8), startedAtMs: minsAgo(7), cancelledAtMs: minsAgo(1),
    cancelReason: 'changed_mind', cancelledFrom: 'preparing'
  });
  await seedDoc('orders', {
    orderNo: 'A-050', name: 'Still Cooking', till: 'A', day, payment: 'card', status: 'preparing',
    items: [l('momo', 'Momo', 1)], total: 500,
    createdAtMs: minsAgo(3), startedAtMs: minsAgo(2)
  });

  const errors = await openKitchen(page);
  await showLane(page, 'preparing');
  const c = card(page, 'A-039');
  await expect(c, 'CLAUDE.md Phase V 4: the card stays "in the column it was in"').toBeVisible({ timeout: 20000 });

  const banner = page.locator([
    '[data-testid="cancelled-banner-A-039"]',
    '[data-testid="order-card-A-039"] [role="alert"]'
  ].join(', ')).first();
  await expect(banner).toBeVisible();
  expect(norm(await banner.innerText())).toMatch(/CANCELLED\s*·\s*STOP MAKING/i);

  const border = await c.evaluate((el) => getComputedStyle(el).borderTopColor);
  const [r, g, b] = (border.match(/\d+/g) || []).map(Number);
  expect(r > 140 && g < 90 && b < 90, `the cancelled card border is ${border}; the brief paints it red (#B91C1C)`).toBe(true);

  const struck = await tid(page, 'order-line-A-039-samosa_only').evaluate((el) => [el, ...el.querySelectorAll('*')]
    .some((n) => /line-through/.test(getComputedStyle(n).textDecorationLine)));
  expect(struck, 'CLAUDE.md Phase V 4: "items struck through"').toBe(true);

  expect(norm(await tid(page, 'cancel-note-A-039').innerText()),
    'CLAUDE.md Phase V 4: "Cancelled by cash counter, till A: Customer changed mind."'
  ).toMatch(/Cancelled by cash counter, till A:\s*Customer changed mind\./i);

  // It does not count in the column total.
  expect(await laneCount(page, 'preparing'),
    'CLAUDE.md Phase V 4: "It doesn\'t count in the column total"'
  ).toBe(1);

  // Remove writes kitchenClearedAtMs and takes the card away.
  const remove = removeBtn(page, 'A-039');
  await expect(remove, 'CLAUDE.md Phase V 4: a Remove button').toBeVisible();
  await remove.click();
  const after = await waitForOrder('A-039', (o) => Number(o.kitchenClearedAtMs) > 0, { label: 'Remove to write' });
  expect(Number(after.kitchenClearedAtMs)).toBeGreaterThan(0);
  expect(after.status, 'Remove does not change the status').toBe('cancelled');
  await expect(c, 'the card goes once it has been removed').toHaveCount(0, { timeout: 8000 });

  await shot(page, info.project.name, 'kitchen', 'cancelled');
  await expectNoConsoleErrors(errors, '#/kitchen with a cancelled card');
});

test('P5-K-05b cancelled from ready shows the same red card', async ({ page }) => {
  const day = DAY();
  await seedDoc('orders', {
    orderNo: 'A-042', name: 'Sam', till: 'B', day, payment: 'card', status: 'cancelled',
    items: [l('fuchka', 'Fuchka / Gol Gappa', 1)], total: 500,
    createdAtMs: minsAgo(9), startedAtMs: minsAgo(8), readyAtMs: minsAgo(6), cancelledAtMs: minsAgo(1),
    cancelReason: 'not_collected', cancelledFrom: 'ready'
  });

  await openKitchen(page);
  await showLane(page, 'ready');
  await expect(card(page, 'A-042')).toBeVisible({ timeout: 20000 });
  await expect(tid(page, 'cancelled-banner-A-042')).toBeVisible();
  expect(norm(await tid(page, 'cancel-note-A-042').innerText())).toMatch(/till B:\s*Not collected\./i);
  expect(await laneCount(page, 'ready'), 'a cancelled card is not counted').toBe(0);
  await expect(removeBtn(page, 'A-042')).toBeVisible();
});

test('P5-K-06 cancelled from new: the card just disappears', async ({ page, context }) => {
  await seedP5Day();
  await openKitchen(page);
  await showLane(page, 'new');
  await expect(card(page, 'A-044')).toBeVisible({ timeout: 20000 });

  const cash = await context.newPage();
  await cash.goto('/#/cash');
  await expect(cash.locator('[data-testid="tile-fuchka"]')).toBeVisible({ timeout: 20000 });
  await cancelOrderWithReason(cash, 'A-044', 'mistake');
  await waitForOrder('A-044', (o) => o.status === 'cancelled', { label: 'the cancel to land' });
  await cash.close();

  await expect(card(page, 'A-044'),
    'CLAUDE.md Phase V 4: "Cancelled from new: the card just disappears"'
  ).toHaveCount(0, { timeout: 8000 });
  expect(await page.locator('[data-testid="cancelled-banner-A-044"]').count(),
    'no red Stop making card for an order that was never started'
  ).toBe(0);
});

/* ================================================== P5-K-07 the phone tabs */

test('P5-K-07 phone: the same cards in the tabs, with a dot on an unseen change', async ({ page }) => {
  test.skip(!isPhone(page), 'CLAUDE.md Phase V 4: "Phone food counter: same cards inside the existing tabs"');
  const day = DAY();
  await seedDoc('orders', {
    orderNo: 'A-041', name: 'Ahmed', till: 'A', day, payment: 'cash', status: 'preparing',
    items: [l('momo', 'Momo', 3)], total: 1500,
    createdAtMs: minsAgo(5), startedAtMs: minsAgo(4),
    editCount: 1, editedAtMs: minsAgo(1),
    history: [{
      atMs: minsAgo(1), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 500,
      before: { items: [l('momo', 'Momo', 2)], total: 1000, name: 'Ahmed', payment: 'cash' }
    }]
  });
  await seedDoc('orders', {
    orderNo: 'A-038', name: 'Quiet', till: 'A', day, payment: 'card', status: 'new',
    items: [l('momo', 'Momo', 1)], total: 500, createdAtMs: minsAgo(2)
  });

  await openKitchen(page);

  const dotShows = async (lane) => {
    const dot = tid(page, `tab-dot-${lane}`);
    if (await dot.count()) return dot.isVisible().catch(() => false);
    const tab = tid(page, `tab-${lane}`);
    const marked = await tab.evaluate((el) => /dot|unseen|change/i.test(el.className)
      || /•/.test(el.textContent || '')
      || (el.getAttribute('aria-label') || '').toLowerCase().includes('chang'));
    return marked;
  };

  expect(await dotShows('preparing'),
    'CLAUDE.md Phase V 4: "A tab with an unseen change or cancel shows a dot"'
  ).toBe(true);
  expect(await dotShows('new'), 'a quiet tab has no dot').toBe(false);

  await showLane(page, 'preparing');
  await expect(card(page, 'A-041'), 'the same card inside the tab').toBeVisible();
  await expect(tid(page, 'changed-banner-A-041')).toBeVisible();

  await tid(page, 'got-it-A-041').click();
  await waitForOrder('A-041', (o) => Number(o.changeSeenAtMs) > 0, { label: 'Got it to write' });
  await expect
    .poll(() => dotShows('preparing'), { timeout: 8000, message: 'the dot clears once the change is seen' })
    .toBe(false);
});

/* ============================================ P5-K-08 the station filter */

test('P5-K-08 Samosa Chat is a Chaat line on the station filter', async ({ page }) => {
  const day = DAY();
  await seedDoc('orders', {
    orderNo: 'A-060', name: 'Mixed', till: 'A', day, payment: 'card', status: 'new',
    items: [l('samosa_chat', 'Samosa Chat', 1), l('marshmallow', 'Chocolate Marshmallow (V)', 1)],
    total: 1000, createdAtMs: minsAgo(1)
  });

  await openKitchen(page);
  await showLane(page, 'new');
  await expect(card(page, 'A-060')).toBeVisible({ timeout: 20000 });

  const off = async (id) => tid(page, `order-line-A-060-${id}`).evaluate((el) => {
    const flagged = el.dataset.off === 'true' || /off|grey|muted|dim/i.test(el.className);
    const faded = Number(getComputedStyle(el).opacity) < 0.95;
    return flagged || faded;
  });

  await tid(page, 'station-all').click();
  await page.waitForTimeout(300);
  expect(await off('samosa_chat'), 'under All nothing is greyed').toBe(false);
  expect(await off('marshmallow'), 'under All nothing is greyed').toBe(false);

  await tid(page, 'station-chaat').click();
  await page.waitForTimeout(300);
  expect(await off('samosa_chat'),
    'CLAUDE.md Menu table + Phase V 7: samosa_chat is a Chaat line'
  ).toBe(false);
  expect(await off('marshmallow'),
    'CLAUDE.md Food counter 4: "Lines not for the station are greyed but still shown"'
  ).toBe(true);

  await tid(page, 'station-sweets').click();
  await page.waitForTimeout(300);
  expect(await off('samosa_chat'), 'Samosa Chat is not a sweet').toBe(true);
  expect(await off('marshmallow')).toBe(false);
});

/* ==================================================== P5-K-09 axe, console */

test('P5-K-09 axe: zero serious or critical violations with a changed and a cancelled card', async ({ page }) => {
  const day = DAY();
  await seedDoc('orders', {
    orderNo: 'A-041', name: 'Ahmed', till: 'A', day, payment: 'cash', status: 'preparing',
    items: [l('momo', 'Momo', 3)], total: 1500,
    createdAtMs: minsAgo(5), startedAtMs: minsAgo(4), editCount: 1, editedAtMs: minsAgo(1),
    history: [{
      atMs: minsAgo(1), action: 'edit', till: 'A', fromStatus: 'preparing', deltaPence: 500,
      before: { items: [l('momo', 'Momo', 2)], total: 1000, name: 'Ahmed', payment: 'cash' }
    }]
  });
  await seedDoc('orders', {
    orderNo: 'A-039', name: 'Tom', till: 'A', day, payment: 'cash', status: 'cancelled',
    items: [l('fuchka', 'Fuchka / Gol Gappa', 1)], total: 500,
    createdAtMs: minsAgo(8), startedAtMs: minsAgo(7), cancelledAtMs: minsAgo(1),
    cancelReason: 'out_of_stock', cancelledFrom: 'preparing'
  });

  const errors = await openKitchen(page);
  await showLane(page, 'preparing');
  await page.waitForTimeout(800);

  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const detail = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join('\n');
  expect(bad, `axe serious/critical on the food counter with Phase V cards:\n${detail}`).toEqual([]);
  await expectNoConsoleErrors(errors, '#/kitchen with Phase V cards');
});
