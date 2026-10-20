// H-21 — Hotfix H2 (19 Oct 2026): cart line alignment on the cash counter.
// Spec: CLAUDE.md -> "Hotfix H2: cart line alignment (19 Oct 2026)" and
// "Cash counter 2" ("line items with − and + (each at least 52×52 px)").
// Plan: qa/test-plan.md section 24.
//
// The bug: every cart row was a flex row sized by its item name, so
// "Chocolate Strawberry" pushed its − / + buttons further right than "Momo"
// did and the steppers did not line up down the column.
//
// The assertions therefore compare the rows AGAINST EACH OTHER, never against
// a hardcoded x: the defect is a difference between rows, and a test pinned to
// a number would pass or fail for the wrong reason on a different viewport.
//
// Three things are checked with the cart holding ALL SEVEN menu items, so the
// longest name and the shortest ("Momo") are both in:
//   1. every `line-dec-*` shares one left x, and every `line-inc-*` shares one
//      left x, within ±1 px;
//   2. no `.line__name` overflows its column, and no row is wider than the
//      panel it sits in;
//   3. the steppers are still big enough — a "fix" that lined the columns up by
//      shrinking the buttons would break CLAUDE.md -> Cash counter 2 and the H2
//      note "keep the 52 px steppers". Hotfix H3 (v1.3.1) sets the figure for
//      the small Review & send sheet at 48 px (CLAUDE.md H3 4), so the minimum
//      is read from the viewport: 52 px on tablet, 48 px below 700 px.
//
// Emulator only. Nothing here writes to live Firestore.
import { test, expect } from './session.js';
import {
  clearFirestore, openApp, tid, addItem, expectNoConsoleErrors, shot,
  isSmallCash, openCashPanel, closeCashPanel
} from './helpers.js';

/** CLAUDE.md -> Menu (after Phase V): the eight rows, in sort order. */
const ACTIVE_IDS = [
  'fuchka', 'momo', 'chat', 'sweet_box',
  'samosa_only', 'choc_strawberry', 'marshmallow', 'samosa_chat'
];

/** Longest and shortest names in the cart, the two ends of the bug. */
const LONGEST = 'marshmallow';       // "Chocolate Marshmallow (V)" after H3
const SHORTEST = 'momo';             // "Momo"

/** CLAUDE.md Cash 2 / H2 on tablet; CLAUDE.md H3 4 in the small sheet. */
const minStepper = (page) => (isSmallCash(page) ? 48 : 52);
const TOL = 1;          // ±1 px, as the hotfix brief states
const SIZE_TOL = 0.5;   // sub-pixel slack on a 2x device scale factor

const r2 = (n) => Math.round(n * 100) / 100;

test.beforeEach(async () => { await clearFirestore(); });

/**
 * One layout pass over the whole cart. Everything is read inside a single
 * `evaluate` so no re-render can land between two measurements, and so the
 * failure message can print every row's numbers at once.
 */
async function measureCart(page, ids) {
  return page.evaluate((wanted) => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
    };
    const q = (name) => document.querySelector(`[data-testid="${name}"]`);

    const rows = [];
    for (const id of wanted) {
      const row = q(`line-${id}`);
      if (!row) { rows.push({ id, missing: true }); continue; }
      const name = row.querySelector('.line__name');
      const dec = q(`line-dec-${id}`);
      const inc = q(`line-inc-${id}`);
      const qty = q(`line-qty-${id}`);
      const amount = row.querySelector('.line__amount');
      const container = row.parentElement;
      rows.push({
        id,
        text: (name ? name.textContent : '').replace(/\s+/g, ' ').trim(),
        row: rect(row),
        name: rect(name),
        nameScrollWidth: name ? name.scrollWidth : null,
        nameClientWidth: name ? name.clientWidth : null,
        dec: rect(dec),
        inc: rect(inc),
        qty: rect(qty),
        amount: rect(amount),
        containerClientWidth: container ? container.clientWidth : null,
        display: getComputedStyle(row).display,
        columns: getComputedStyle(row).gridTemplateColumns
      });
    }

    const panel = document.querySelector('[data-testid="review-sheet"]')
      || document.querySelector('[aria-label="Current order"]')
      || document.querySelector('.panel');
    const linesBox = document.querySelector('.lines');
    return {
      rows,
      panel: rect(panel),
      panelClientWidth: panel ? panel.clientWidth : null,
      lines: rect(linesBox),
      linesClientWidth: linesBox ? linesBox.clientWidth : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth
    };
  }, ids);
}

/** A compact table of the measurement, for a failure message and the log. */
function table(m) {
  const head = 'id              name                   row.left  row.w   dec.left dec.w dec.h  inc.left inc.w inc.h  qty.left amt.right';
  const body = m.rows.map((r) => {
    if (r.missing) return `${r.id.padEnd(16)}MISSING`;
    const f = (v, w = 8) => String(r2(v)).padEnd(w);
    return `${r.id.padEnd(16)}${(r.text || '').slice(0, 22).padEnd(23)}${f(r.row.left)} ${f(r.row.width, 7)} ${f(r.dec.left)} ${f(r.dec.width, 5)} ${f(r.dec.height, 6)} ${f(r.inc.left)} ${f(r.inc.width, 5)} ${f(r.inc.height, 6)} ${f(r.qty.left)} ${f(r.amount.right)}`;
  });
  return [head, ...body].join('\n');
}

/** Fill the cart with every menu item, then wait for the rows to settle. */
async function fillCart(page) {
  const errors = await openApp(page, '#/cash');
  await expect(tid(page, 'tile-fuchka')).toBeVisible({ timeout: 20000 });
  await expect(tid(page, 'tile-marshmallow')).toBeVisible({ timeout: 20000 });

  // Quantities 1..7: single digits, so the fixed quantity column and the
  // amount column are exercised without being asked to hold more than
  // the brief's grid allows. Different quantities also prove the steppers do
  // not move when the quantity or the line total changes width.
  for (let i = 0; i < ACTIVE_IDS.length; i++) {
    await addItem(page, ACTIVE_IDS[i], i + 1);
  }
  // H3: below 700 px the cart lives in the Review & send sheet.
  await openCashPanel(page);

  for (const id of ACTIVE_IDS) {
    await expect(tid(page, `line-${id}`), `line-${id} must be in the cart`).toHaveCount(1, { timeout: 10000 });
  }
  await page.waitForTimeout(400);
  return errors;
}

/* ------------------------------------------------------------------ H-21 */

test('H-21 with every item in the cart the steppers line up, nothing overflows, the stepper size is kept', async ({ page }, info) => {
  const consoleErrors = await fillCart(page);

  const m = await measureCart(page, ACTIVE_IDS);
  const report = table(m);
  // eslint-disable-next-line no-console
  console.log(`\n[H-21 ${info.project.name} ${m.viewport.width}x${m.viewport.height}] cart line geometry\n${report}\n` +
    `panel: left=${r2(m.panel.left)} width=${r2(m.panel.width)} clientWidth=${m.panelClientWidth}; ` +
    `lines clientWidth=${m.linesClientWidth}; row display=${m.rows[0].display}; columns=${m.rows[0].columns}\n`);

  expect(m.rows.filter((r) => r.missing).map((r) => r.id), 'all eight items must be in the cart').toEqual([]);
  expect(m.rows.map((r) => r.id), 'the cart holds all eight items').toEqual(ACTIVE_IDS);

  // Sanity: the two ends of the bug really are both present. The longest name
  // is read off the cart rather than pinned to a string, so a later menu
  // rewording cannot quietly turn this into a one-ended test.
  const longest = m.rows.slice().sort((a, b) => b.text.length - a.text.length)[0];
  const shortest = m.rows.find((r) => r.id === SHORTEST);
  expect(shortest.text, 'the shortest name must be in the cart').toBe('Momo');
  expect(longest.text.length,
    `the cart must hold a name clearly longer than "Momo" for this test to mean anything; longest is "${longest.text}"`
  ).toBeGreaterThan(shortest.text.length + 6);

  /* --- 1. the steppers share one column, row against row ---------------- */

  for (const key of ['dec', 'inc']) {
    const lefts = m.rows.map((r) => r[key].left);
    const min = Math.min(...lefts);
    const max = Math.max(...lefts);
    const spread = max - min;
    const detail = m.rows.map((r) => `${r.id}="${r.text}" ${key}.left=${r2(r[key].left)}`).join('\n  ');
    expect(spread,
      `CLAUDE.md H2: every row's line-${key}-* must sit at the same left x (±${TOL} px), ` +
      `whatever the length of the item name. Spread is ${r2(spread)} px ` +
      `(min ${r2(min)} on "${m.rows.find((r) => r[key].left === min).text}", ` +
      `max ${r2(max)} on "${m.rows.find((r) => r[key].left === max).text}").\n  ${detail}\n\n${report}`
    ).toBeLessThanOrEqual(TOL);
  }

  // Named spelling-out of the exact defect: the longest name against the shortest.
  for (const key of ['dec', 'inc']) {
    const delta = Math.abs(longest[key].left - shortest[key].left);
    expect(delta,
      `CLAUDE.md H2: "${longest.text}" must not push its ${key === 'dec' ? '−' : '+'} button ` +
      `further right than "Momo" does. ` +
      `${longest.id} ${key}.left=${r2(longest[key].left)}, ${SHORTEST} ${key}.left=${r2(shortest[key].left)}, ` +
      `difference ${r2(delta)} px.\n\n${report}`
    ).toBeLessThanOrEqual(TOL);
  }

  // The quantity and the line total are in fixed columns too, so the whole
  // right-hand block is a column, not just the two buttons.
  for (const [key, edge] of [['qty', 'left'], ['amount', 'right']]) {
    const vals = m.rows.map((r) => r[key][edge]);
    const spread = Math.max(...vals) - Math.min(...vals);
    expect(spread,
      `CLAUDE.md H2: .line__${key} is in a fixed column with tabular numbers, so its ${edge} edge ` +
      `must be the same on every row (±${TOL} px). Spread ${r2(spread)} px.\n\n${report}`
    ).toBeLessThanOrEqual(TOL);
  }

  // And the rows themselves are the same width and start at the same x.
  const rowLefts = m.rows.map((r) => r.row.left);
  const rowWidths = m.rows.map((r) => r.row.width);
  expect(Math.max(...rowLefts) - Math.min(...rowLefts), `all rows start at the same x\n\n${report}`).toBeLessThanOrEqual(TOL);
  expect(Math.max(...rowWidths) - Math.min(...rowWidths), `all rows are the same width\n\n${report}`).toBeLessThanOrEqual(TOL);

  /* --- 2. nothing overflows -------------------------------------------- */

  for (const r of m.rows) {
    expect(r.nameScrollWidth,
      `CLAUDE.md H2: .line__name wraps instead of overflowing. "${r.text}" has ` +
      `scrollWidth ${r.nameScrollWidth} > clientWidth ${r.nameClientWidth}, so the name is clipped ` +
      `or spilling out of its column.\n\n${report}`
    ).toBeLessThanOrEqual(r.nameClientWidth + TOL);

    expect(r.name.right,
      `"${r.text}" must not run under its own − button: name right ${r2(r.name.right)} ` +
      `vs line-dec-${r.id} left ${r2(r.dec.left)}.\n\n${report}`
    ).toBeLessThanOrEqual(r.dec.left + TOL);

    expect(r.row.width,
      `row line-${r.id} is ${r2(r.row.width)} px wide inside a ${r.containerClientWidth} px column — ` +
      `a cart row may never be wider than the panel that holds it.\n\n${report}`
    ).toBeLessThanOrEqual(r.containerClientWidth + TOL);

    expect(r.row.right,
      `row line-${r.id} spills past the right edge of the order panel ` +
      `(row right ${r2(r.row.right)} vs panel right ${r2(m.panel.right)}).\n\n${report}`
    ).toBeLessThanOrEqual(m.panel.right + TOL);

    expect(r.amount.right,
      `the line total of line-${r.id} spills past the panel ` +
      `(${r2(r.amount.right)} vs ${r2(m.panel.right)}).\n\n${report}`
    ).toBeLessThanOrEqual(m.panel.right + TOL);
  }

  // The whole document must still not scroll sideways (CLAUDE.md -> Design).
  expect(m.docScrollWidth,
    `a full cart must not create horizontal scroll (${m.docScrollWidth} > ${m.docClientWidth})`
  ).toBeLessThanOrEqual(m.docClientWidth + TOL);

  /* --- 3. the 52 px steppers are kept ----------------------------------- */

  const MIN_STEPPER = minStepper(page);
  for (const r of m.rows) {
    for (const key of ['dec', 'inc']) {
      expect(r[key].width,
        `CLAUDE.md Cash counter 2 / H2 / H3 4: line-${key}-${r.id} ` +
        `is ${r2(r[key].width)} px wide, under ${MIN_STEPPER}. Aligning the columns by shrinking ` +
        `the buttons is not the fix.\n\n${report}`
      ).toBeGreaterThanOrEqual(MIN_STEPPER - SIZE_TOL);
      expect(r[key].height,
        `CLAUDE.md Cash counter 2 / H2 / H3 4: line-${key}-${r.id} is ${r2(r[key].height)} px tall, ` +
        `under ${MIN_STEPPER}.\n\n${report}`
      ).toBeGreaterThanOrEqual(MIN_STEPPER - SIZE_TOL);
    }
  }

  await shot(page, info.project.name, 'cash', 'cart-aligned');
  await expectNoConsoleErrors(consoleErrors, '#/cash with a full cart');
});

/* --------------------------------------------------------------- H-21.2 */

test('H-21.2 the steppers stay in their column while the cart is edited', async ({ page }, info) => {
  await fillCart(page);

  // Removing the shortest name and leaving the longest must not move the column.
  const before = await measureCart(page, ACTIVE_IDS);
  const beforeDec = before.rows.find((r) => r.id === LONGEST).dec.left;

  // fillCart gives Momo a quantity of 2, so step it down to zero. Six other
  // rows stay in the cart, so the H3 sheet does not close under us.
  for (let i = 0; i < 6; i++) {
    if (await tid(page, `line-${SHORTEST}`).count() === 0) break;
    await tid(page, `line-dec-${SHORTEST}`).click();
    await page.waitForTimeout(200);
  }
  await expect(tid(page, `line-${SHORTEST}`), 'the Momo row leaves when its quantity hits 0').toHaveCount(0);

  const remaining = ACTIVE_IDS.filter((id) => id !== SHORTEST);
  const after = await measureCart(page, remaining);
  // eslint-disable-next-line no-console
  console.log(`\n[H-21.2 ${info.project.name}] after removing the shortest row\n${table(after)}\n`);

  for (const key of ['dec', 'inc']) {
    const lefts = after.rows.map((r) => r[key].left);
    expect(Math.max(...lefts) - Math.min(...lefts),
      `the ${key} column must stay aligned after an edit\n\n${table(after)}`
    ).toBeLessThanOrEqual(TOL);
  }

  const afterDec = after.rows.find((r) => r.id === LONGEST).dec.left;
  expect(Math.abs(afterDec - beforeDec),
    `removing a row must not move the stepper column: ${r2(beforeDec)} -> ${r2(afterDec)}`
  ).toBeLessThanOrEqual(TOL);

  // Pushing the longest line to a two-digit quantity must not move it either:
  // the quantity sits in its own fixed column with tabular numbers.
  const startQty = Number((await tid(page, `line-qty-${LONGEST}`).innerText()).trim());
  const targetQty = Math.max(12, startQty + 4);
  for (let i = startQty; i < targetQty; i++) {
    await tid(page, `line-inc-${LONGEST}`).click();
    await page.waitForTimeout(80);
  }
  await expect(tid(page, `line-qty-${LONGEST}`)).toHaveText(new RegExp(`\\b${targetQty}\\b`));

  const twoDigit = await measureCart(page, remaining);
  for (const key of ['dec', 'inc']) {
    const lefts = twoDigit.rows.map((r) => r[key].left);
    expect(Math.max(...lefts) - Math.min(...lefts),
      `a two-digit quantity must not shift the ${key} column\n\n${table(twoDigit)}`
    ).toBeLessThanOrEqual(TOL);
  }
  for (const r of twoDigit.rows) {
    expect(r.row.width, `row line-${r.id} must still fit its column`).toBeLessThanOrEqual(r.containerClientWidth + TOL);
  }
});

/* --------------------------------------------------------------- H-21.3 */

test('H-21.3 the cart lines up at 360px too, with every item in it', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await fillCart(page);

  const m = await measureCart(page, ACTIVE_IDS);
  // eslint-disable-next-line no-console
  console.log(`\n[H-21.3 360x740] cart line geometry\n${table(m)}\n`);

  for (const key of ['dec', 'inc']) {
    const lefts = m.rows.map((r) => r[key].left);
    expect(Math.max(...lefts) - Math.min(...lefts),
      `CLAUDE.md H2 at the narrowest supported width: the ${key} column must still line up\n\n${table(m)}`
    ).toBeLessThanOrEqual(TOL);
  }
  for (const r of m.rows) {
    expect(r.nameScrollWidth, `"${r.text}" must wrap, not overflow, at 360px\n\n${table(m)}`)
      .toBeLessThanOrEqual(r.nameClientWidth + TOL);
    expect(r.dec.width, `line-dec-${r.id} keeps its ${minStepper(page)} px at 360px`).toBeGreaterThanOrEqual(minStepper(page) - SIZE_TOL);
    expect(r.inc.width, `line-inc-${r.id} keeps its ${minStepper(page)} px at 360px`).toBeGreaterThanOrEqual(minStepper(page) - SIZE_TOL);
    expect(r.row.right, `row line-${r.id} must not spill past the panel at 360px`)
      .toBeLessThanOrEqual(m.panel.right + TOL);
  }
  expect(m.docScrollWidth, `CLAUDE.md Design: no horizontal scroll at 360px with a full cart`)
    .toBeLessThanOrEqual(m.docClientWidth + TOL);
});
