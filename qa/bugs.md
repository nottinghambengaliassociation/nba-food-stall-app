# QA bugs — Charity Food Stall POS

Format: `BUG-<n> | severity | screen | steps | expected (CLAUDE.md) | actual | screenshot | status`

Severity key: **blocker** = requirement cannot be exercised / data loss / uncaught exception; **major** = requirement works incorrectly or breaks a stated minimum; **minor** = cosmetic or wording.

Status key: `open` → raised, `fixed` → Neo reports a fix, `verified` → Morpheus re-ran and it passes.

---

## Round 1 — 2026-10-17

Suites after test corrections (stable, reproduced on three consecutive runs):
unit **85/85 pass**; e2e **116 active tests** (58 per project) — **113 pass, 3 fail**, 6 live-smoke tests skipped by design.
Failing: `C-05` (phone), `C-07` (phone + tablet).

### BUG-1 | minor | Cash counter (`#/cash`) | status: **verified** (round 2)

**Steps**
1. Load `#/cash` (phone and tablet).
2. Tap `tile-fuchka` three times (£15.00 order).
3. Tap `pay-cash`, then tap `pay-card`.

**Expected** — `CLAUDE.md` → Cash counter 3: *"Cash or Card toggle. **Cash** shows quick tender buttons £5, £10, £20, £50 and 'Change to give'."* The quick tender buttons and the change readout belong to the cash path only; selecting Card must hide them. The data model backs this up: `tendered 2000 | null — cash only`.

**Actual** — With Card selected, `tender-500`, `tender-1000`, `tender-2000`, `tender-5000` remain visible and clickable:
`locator resolved to <button type="button" class="tender__btn" aria-pressed="false" data-testid="tender-2000">£20</button> — unexpected value "visible"`.
The stored `tendered` is correctly `null` on card orders, so this is presentation only, but it invites a volunteer to key a cash tender against a card sale.

**Test** `tests/e2e/cash.spec.js` → `C-07 cash and card toggle, quick tenders and change due`
**Screenshot** `test-results/cash-C-07-cash-and-card-toggle-quick-tenders-and-change-due-phone/test-failed-1.png` (and the `-tablet` variant)

---

### BUG-2 | blocker | Cash counter (`#/cash`), phone 390×844 | status: **verified** (round 2)

**Steps**
1. Load `#/cash` at 390×844.
2. Tap `tile-fuchka` three times (or any two different tiles).
3. Try to tap `line-inc-fuchka` on the Fuchka line.

**Expected** — `CLAUDE.md` → Cash counter 2: *"Order panel: name input, line items with − and + (each at least 52×52 px), line totals, big total."* The − and + controls must be tappable, and each element of the order panel must be readable. `CLAUDE.md` → Design: the phone layout has a *"sticky bottom order bar on cash"*, which must not cover the panel contents.

**Actual** — The whole order panel collapses on top of itself at 390 px: the Total row is drawn over the line items, the Cash/Card toggle is drawn over the second line item, the tender row is drawn under the Send button, and "Change to give" is pushed off the bottom. The + button cannot be tapped at all:
`<span class="total-row__value" data-testid="order-total">£15.00</span> from <div class="total-row">…</div> subtree intercepts pointer events` (29 retries, then timeout).
The buttons themselves measure 52×52 px, so this is stacking/height in the phone sticky sheet, not control size. The tablet layout is correct.

Raised to **blocker**: on a phone till a volunteer cannot correct a line quantity and cannot read the total reliably.

**Test** `tests/e2e/cash.spec.js` → `C-05 the minus and plus buttons are at least 52px and adjust the line`
**Screenshots**
- `qa/screenshots/phone-cash-orders.png` (shows the overlap clearly)
- `test-results/cash-C-05-the-minus-and-pl-0dc9d-st-52px-and-adjust-the-line-phone/test-failed-1.png`
- Compare with the correct tablet layout: `qa/screenshots/tablet-cash-orders.png`

---

### BUG-3 | major | Cash counter (`#/cash`) recent strip | status: **verified** (round 2)

**Steps**
1. Seed the scripted report day (one order still `new`).
2. Load `#/cash` and measure every visible control.

**Expected** — `CLAUDE.md` → Design: *"Touch targets at least 48 px."*

**Actual** — `button[cancel-A-005] = 40px`. The Cancel button in the recent-orders strip is 40 px tall.

**Test** `tests/e2e/crosscutting.spec.js` → `X-02 every visible control is at least 48px tall`
**Screenshot** `test-results/crosscutting-X-02-every-vi-5d49b-ntrol-is-at-least-48px-tall-phone/test-failed-1.png`

**Note** — seen once while Neo was still editing `public/`, then not reproducible for the rest of round 1. Round 2 confirms it independently: `.recent__cancel` measures **79.9 × 48 px** at 390, 1280 and 360 px wide. Closed as verified.

---

## Tests corrected against the brief (no app change required)

Per `CLAUDE.md` → Workflow 3 (*"If a test is wrong against the brief, Morpheus fixes the test and notes it"*):

| Test | Problem | Correction |
|---|---|---|
| `helpers.openApp` (affected `C-14`, `L-04`) | The init script cleared `localStorage` on **every** page load, including `page.reload()`, so the order sequence and the till letter could never survive a reload. That is the harness, not the app. | Clear once per tab, guarded by a `sessionStorage` sentinel. |
| `O-03` offline reload | Asserted that `page.reload()` works with `context.setOffline(true)`. Playwright's offline mode blocks the HTTP fetch of `index.html` itself, and the brief requires `persistentLocalCache` for offline *data*, not a service worker for offline *document* loads. | Rewritten to navigate within the SPA while offline and assert the menu still renders from the local cache. |
| `X-05` breakpoint | Asserted `col-new` has count 0 on phone. The brief asks for "tabs on kitchen" below 700 px; keeping the three column elements in the DOM and showing one at a time satisfies that. | Now asserts the three tabs are present and at most one column is visible. |
| `R-02`…`R-06`, `R-09` | Read KPI, peak-slot and pay-split text immediately after the element became visible, i.e. before the Firestore snapshot had landed, so the empty-state text ("No orders yet", "£0.00") was sampled. | Replaced flat waits with `expect.poll` on the rendered value. |
| `R-09` | Compared against a literal `£60.00` after a date round trip; a stray order left behind by a previous test's in-flight write made it `£75.00`. | Captures the loaded value first and asserts the round trip returns to it; `clearFirestore` now sweeps twice and `seedReportDay` verifies the emulator holds exactly the six fixture orders. |
| `C-01`, `C-05` size checks | `boundingBox()` returned `null` (reported as 0 px) when the cash screen re-rendered on a Firestore snapshot between the visibility check and the measurement. | `heightOf`/`boxOf` now retry for up to 1.8 s. |

## Round 2 — 2026-10-17 (after Neo's CSS fix)

Neo changed `public/css/app.css` only.

**Result: the suite is green.** unit **85/85 pass**; e2e **116 active tests — 116 pass, 0 fail**, 6 live-smoke skipped by design (the site is not deployed yet).

| Project | Tests run | Passed | Failed |
|---|---|---|---|
| phone 390×844 | 58 | 58 | 0 |
| tablet 1280×800 | 58 | 58 | 0 |
| (live smoke, both) | 6 | — | skipped |

### Independent verification of the fixes

Neo's hand-back was not taken on trust. A separate measurement sweep (outside the Playwright suite) enumerated every visible `button`, `a[href]`, `input`, `select`, `[role=button]`, `[role=tab]` and `label[for]` on all four routes, at **390 × 844**, **1280 × 800** and **360 × 740**, with an order already sent so the recent strip and its Cancel button were on screen, and a two-line order in the panel so the sheet was at its busiest.

Nothing interactive measured under 48 px at any of the three widths. The only elements below 48 px were `<label>` captions (`Name to call out` 23.2 px, `Day` 24.6 px, and a 1 × 1 visually-hidden `Till` label in the phone header). Those are text captions sitting above their controls, not touch targets; the controls they label are 52–64 px.

Key measurements, all three widths:

| Control | phone 390 | tablet 1280 | narrow 360 | Requirement |
|---|---|---|---|---|
| `send-order` | 358 × **72** | 332 × **84** | 328 × **72** | ≥ 72 px (Cash 4) |
| `cancel-A-001` | 79.9 × **48** | 79.9 × **48** | 79.9 × **48** | ≥ 48 px (Design) |
| `line-inc-fuchka` / `line-dec-fuchka` | **52 × 52** | **52 × 52** | **52 × 52** | ≥ 52 × 52 px (Cash 2) |
| `pay-cash` / `pay-card` | 173 × 64 | 160 × 64 | 158 × 64 | ≥ 48 px |
| `tender-2000` | 83.5 × 56 | 75.6 × 56 | 76 × 56 | ≥ 48 px |
| `customer-name` | 358 × 52 | 332 × 64 | 328 × 52 | ≥ 48 px |

Hit test on the Fuchka `+` button (`document.elementFromPoint` at the button's centre) returns the button itself at all three widths — **"OK (button receives the tap)"**, where round 1 returned `COVERED by span[order-total]`. BUG-2 is genuinely fixed, not merely passing on a timing change.

With Card selected, `tender-*` and `change-due` are both `display: none` at all three widths. BUG-1 fixed.

### Note on the de-stickied Send button

Neo flagged that Send is no longer `position: sticky` on phone, in case a test depended on it. **No test did.** The brief only requires Send to be ≥ 72 px and disabled when empty (`CLAUDE.md` → Cash 4), which is what `C-08` asserts; Playwright scrolls an element into view before clicking, so `placeOrder` is unaffected. No test change was needed.

One screenshot change was needed, though: the panel now scrolls inside its own bounds, so a `fullPage` capture was clipping whichever part of the sheet had been scrolled past. `helpers.shot()` now resets `window.scrollTo(0, 0)` and every inner scroller to the top before capturing, so `qa/screenshots/phone-cash-orders.png` shows the sheet from the toast down. That is screenshot fidelity for the handover, not a test assertion.

## Final status of every bug (Phase I)

| Id | Severity | Screen | Status |
|---|---|---|---|
| BUG-1 | minor | `#/cash` | **verified** — tender buttons and change readout hidden on Card |
| BUG-2 | blocker | `#/cash` phone | **verified** — panel rows no longer squashed; `+`/`−` receive taps |
| BUG-3 | major | `#/cash` recent strip | **verified** — Cancel is 48 px at 390, 1280 and 360 |

**Open bugs: none.** blocker 0 · major 0 · minor 0.

## Not automated (recorded, not a bug)

- **Food counter 6** — the audible Web Audio beep and `navigator.wakeLock` cannot be verified in headless Chromium. The suite checks only that the sound toggle exists in the header (`K-11`).

## Round 3 — live smoke, 2026-10-17

Run against `https://nottinghambengaliassociation.github.io/nba-food-stall-app/` (HTTP 200, real Firebase config served, `PASTE_` placeholder count = 0).

Command: `LIVE_SMOKE=1 npx playwright test tests/e2e/live-smoke.spec.js` — **5 passed, 1 skipped by design, 0 failed.**

| Check | phone | tablet | Result |
|---|---|---|---|
| S-01 `#/` loads | pass | pass | header renders |
| S-01 `#/cash` loads | pass | pass | tiles render from the live menu |
| S-01 `#/kitchen` loads | pass | pass | board renders |
| S-01 `#/reports` loads | pass | pass | KPIs render |
| S-01 console errors | **0** | **0** | nothing ignored either — the raw capture was empty |
| S-02 "Storage not configured" banner | absent | absent | deployed config is wired up |
| S-02 connection pill | `Online · synced` | `Online · synced` | pass |
| S-03 QA-SMOKE round trip | skipped | **pass** | writes run once, not once per viewport |

### S-03 detail

The order-placing test is deliberately gated to one viewport (`tablet`) so the live smoke leaves two documents behind rather than four.

- `A-001` · name `QA-SMOKE` · card · £5.00 · placed at the till → appeared on the live kitchen → **Start → Ready → Collected** → left the board. Final status `collected`.
- `A-002` · name `QA-SMOKE` · card · £5.00 · placed, then **cancelled** from the recent strip while `new`. Final status `cancelled`.
- Live `#/reports` for the day then read: **orders 1, sales £5.00**, tile subtitle "excludes 1 cancelled". The cancelled order is correctly excluded.

Verified independently of the test, by a read-only REST query against the live project:

| docId | orderNo | name | status | day | till | total | payment |
|---|---|---|---|---|---|---|---|
| `rBed5Z0VLcKPHzJ53Sxc` | `A-001` | QA-SMOKE | `collected` | `2026-10-17` | A | 500 | card |
| `9OmbVmAbZ4I9hCk3KDGf` | `A-002` | QA-SMOKE | `cancelled` | `2026-10-17` | A | 500 | card |

Timestamp fields were checked on both documents and behave per the data model: unset stages are written as `null`, and each stamp is filled only at its transition. `A-001` carries `createdAtMs`, `startedAtMs`, `readyAtMs`, `collectedAtMs` with `cancelledAtMs: null`; `A-002` carries `createdAtMs`, `cancelledAtMs` with the other three `null`. No bug.

### The live menu seed was triggered by this run

Before the smoke run, a read-only probe showed the live project held **0 `menu` documents and 0 `orders`** — completely empty. Loading `#/cash` therefore fired the first-load seed, which wrote the six menu documents. Verified afterwards:

| id | price | station | colour |
|---|---|---|---|
| fuchka | 500 | chaat | #FDE68A |
| momo | 500 | momo | #BFDBFE |
| chat | 500 | chaat | #FECACA |
| samosa | 500 | sweets | #FED7AA |
| straw | 500 | sweets | #E9D5FF |
| fountain | 500 | sweets | #E7D3BF |

All six match the menu table in `CLAUDE.md`, all at 500 pence, `sort` 1–6. **This matters for the handover:** the live menu now exists and will not be re-seeded (seeding only runs when `menu` is empty), so prices can be edited in the Firebase console from here on, and the organisers will not see a seed happen on the day.

### QA data left in the live project — needs cleanup

**Yes, two documents need removing before the event**, and I did not remove them (deleting from the real project is Trinity's, per `CLAUDE.md` → Rules).

- Collection `orders`, day `2026-10-17`: `A-001` and `A-002`, both named exactly `QA-SMOKE`.
- Document ids: `rBed5Z0VLcKPHzJ53Sxc` and `9OmbVmAbZ4I9hCk3KDGf`.
- They are identifiable by `name == "QA-SMOKE"`.

If the event is on a different London date these two are harmless — reports query `where("day","==",day)`, so they will never appear in the event day's figures. They only matter if someone opens reports for `2026-10-17`. The **six `menu` documents must be kept**; only the two orders are test data.

One further note for the handover: the smoke run consumed `A-001` and `A-002` from the till-A sequence, but that sequence lives in `localStorage` on the device that placed them (this CI browser context, now discarded). Volunteers' tablets start from `A-001` on the day regardless, so nothing needs resetting.

### Live screenshots

14 files written to `qa/screenshots/`:

- `live-phone-landing.png`, `live-phone-cash.png`, `live-phone-kitchen.png`, `live-phone-reports.png`
- `live-tablet-landing.png`, `live-tablet-cash.png`, `live-tablet-kitchen.png`, `live-tablet-reports.png`
- `live-phone-cash-pill.png`, `live-tablet-cash-pill.png` (connection pill evidence)
- `live-cash-qa-smoke-sent.png`, `live-kitchen-qa-smoke.png`, `live-cash-qa-smoke-cancelled.png`, `live-reports-qa-smoke.png` (the QA-SMOKE round trip)

A plain-text run log is at `qa/live-smoke-record.txt`.

## Final state

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (Vitest) | 85 | 0 | 0 |
| e2e phone 390×844 | 58 | 0 | — |
| e2e tablet 1280×800 | 58 | 0 | — |
| live smoke | 5 | 0 | 1 (by design) |

**Open bugs: none.** blocker 0 · major 0 · minor 0. BUG-1, BUG-2 and BUG-3 all verified fixed.

---

## Round 3 — Phase II, 2026-10-18

Phase II features under test: **A** login / session / sign out (`G-01`…`G-20`), **B** Cash received (optional) (`T-01`…`T-13`), plus the Phase I suite re-run with login gating every route.

Clean full run, nothing else on the machine (`npm run test:unit`, then `npm run test:e2e`):

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (Vitest, 7 files) | 116 | 0 | 0 |
| e2e phone 390×844 | 88 | 0 | 4 (3 live-smoke + `T-08`, tablet-only by design) |
| e2e tablet 1280×800 | 89 | 0 | 3 (live-smoke) |
| **e2e total** | **177** | **0** | **7** |

Zero flaky tests in the clean run. Live smoke is deliberately not run this round: Phase II is not deployed yet.

**Open bugs: none.** blocker 0 · major 0 · minor 0.

### BUG-4 | major | Cash counter (`#/cash`), cash received | status: **verified**

**Steps**
1. `#/cash`, add 1 × Momo (£5.00), Cash selected.
2. Tap the **£20** quick button — "Change to give: £15.00" appears.
3. Tap **−** on the Momo line so the panel is empty.
4. Add 1 × Momo again, starting a fresh order.

**Expected** — `CLAUDE.md` → Cash counter 3: *"Switching to Card, sending, or **clearing the order** resets it."* Emptying the panel clears the order, so the next order must start with no quick button selected and no message.

**Actual** (first run of round 3) — the £20 selection survived, and the new £5.00 order opened showing **"Change to give: £15.00"**. A volunteer could hand back £15 against a £5 order that no one had tendered for.

**Test** `tests/e2e/tender.spec.js` → `T-09 it resets on Card, on send and on clearing the order`, part (d)
**Screenshot** `test-results/tender-T-09-…-tablet/test-failed-1.png` (transient; the fixed state is in `qa/screenshots/tablet-cash-tender.png`)
**Fix** Neo reset the cash-received state whenever the panel empties. Re-verified on phone and tablet in the clean run.

### BUG-5 | major | Cash counter (`#/cash`), stored order | status: **withdrawn (requirement change)**

Raised when a short amount (`10` on a £15.00 order) was stored as `tendered: null`, losing the figure. The user's requirement change of 2026-10-18 retired the question entirely: **Cash received is purely an on-screen calculator and nothing about it is persisted.** There is no stored tender to be wrong about. The tests were rewritten to assert the opposite — that an order document contains neither `tendered` nor `changeGiven` — and they pass. No action for Neo.

### Not bugs — confirmed against the brief

- **Sign out is 44 × 44 below 700 px.** `CLAUDE.md` → Login 7 specifies "icon-only 44×44 button", which is under the general 48 px rule in Design. `X-02` now exempts Sign out at phone width only; at 700 px and wider the 48 px floor still applies, and it is met.
- **No dark header on `#/login`.** Both login mock-ups are a plain centred card. `#/login` is not in the `X-04` dark-header route list.
- **Quick cash buttons at 44 px on phone / 54 px on tablet.** Explicit minimums in Cash 3, so also exempted from the 48 px floor in `X-02`.
- **Two `<h1>`s on the login screen** (the screen-title in the header plus the "Nottingham Bengali Association" card heading). Not a violation of anything in the brief, and axe reports no serious or critical issue on `#/login`.

### Test-side changes this round (not Neo's code)

1. `tests/e2e/session.js` (new) — a shared Playwright `test` that seeds `localStorage["nba.session"]` in the default context *and* in every `browser.newContext()`, so the Phase I suites run signed in. Every existing spec now imports `test`/`expect` from it. Login behaviour itself is exercised only by `tests/e2e/login.spec.js`, which uses the ungated base `test`.
2. `tests/e2e/creds.js` (new) — reads `APP_LOGIN_USER` / `APP_LOGIN_PASSWORD` from the gitignored `.secrets/app-login.env` at run time. No credential is written into any test, fixture, screenshot or log; failed logins use an obviously fake password; the `G-08` failure screenshot was dropped because it captured the real username, and `G-20` captures the same state with a made-up one.
3. `tests/unit/secrets.test.js` → `U-25` now also fails if either credential appears in a tracked file, and asserts `.secrets/` and `public/js/login-config.js` are untracked.
4. CSV expectations (`U-20`, `U-28`, `R-07`) and the order-shape checks (`C-05`, `C-06`, `D-01`) were updated to the 2026-10-18 requirement change: thirteen CSV columns, no `tendered`/`changeGiven` on the document.
5. `playwright.config.js` — `retries: 1` locally as well as in CI. The Firestore emulator is shared with whoever else is running the suite on this machine and can restart mid-run; the retry keeps a 12-minute suite from being written off by someone else's `emulators:exec`. The final numbers above come from a clean run with zero retries used.

---

## Round 4 — Hotfix H1 (split menu items), 2026-10-19

Under test: `CLAUDE.md` → "Menu" (the ten-row table) and "Hotfix H1: split menu items (18 Oct 2026)" 1–6. Plan: `qa/test-plan.md` sections 20–23 (`H-*`), written from the brief before reading Neo's code. **Phase III (`#/reports/days`) is deliberately out of scope this round.**

Clean full run with nothing else on the machine — no other Playwright process, no other Firestore emulator on 8080 (`npm run test:unit`, then `npm run test:e2e`):

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (Vitest, 8 files) | 166 | 0 | 0 |
| e2e phone 390×844 | 99 | 0 | 14 (13 live-gated + `T-08`, tablet-only by design) |
| e2e tablet 1280×800 | 100 | 0 | 13 (live-gated) |
| **e2e total** | **199** | **0** | **27** |

Zero flaky tests, zero retries used. New this round: 50 unit cases (`tests/unit/menu.test.js`) and 22 e2e cases (`tests/e2e/menu-h1.spec.js`, 11 per viewport).

The 27 skips are the gated live specs — 16 `S-*` (`LIVE_SMOKE=1`) and 10 `H-20.*` (`LIVE_H1=1`) — plus the tablet-only `T-08`. H1 is not deployed, so neither live spec is run.

**Open bugs: none.** blocker 0 · major 0 · minor 0. No `BUG-*` was raised this round: every H1 case passed against Neo's implementation first time.

### The two highest-risk cases, confirmed

**1. Eighth tile at 390×844 is not covered by the sticky order bar** — `H-09`, both viewports.
Not a visibility check: with an order in the panel (bar at its tallest) each of the eight tiles is scrolled into its own tile area and `document.elementFromPoint` is read at the tile's exact centre. The element returned must be the tile or a descendant for all eight; the assertion message names the covering element so a failure would say what covered it. The eighth tile (`fountain`) is then clicked **by coordinate** with `page.mouse.click` and `qty-fountain` must read 1 — a tap that lands on the bar would not move the badge. This is the Phase I `BUG-2` failure mode, where a passing visibility assertion hid a covered control, so visibility alone is not accepted as evidence. Measured geometry on phone: the tile area is its own scroller ending at y≈338 and the order panel starts at y≈338, so there is no overlap at any scroll position. `H-10` adds: no horizontal scroll at 360×740 on any of the four routes with a full cart, and no tile spilling past the right edge.

**2. Orders holding the retired ids still render, report and export under their ORIGINAL names** — `H-05`, `H-06`, `H-11`, `H-12`, `H-13`, `H-15`, both viewports.
Fixtures are shaped exactly like the live 17 Oct documents (`{id:'samosa', name:'Sweets Box Samosa / Shingara'}`, `{id:'straw', name:'Chocolate Strawberry & Marshmallow (V)'}`), seeded straight into the emulator and never touched by the UI.

- **Kitchen** (`H-11`): the card renders, both lines keep their original names, each line carries an inline SVG (the retained `samosa` and `straw` icons), no "unknown"/"undefined" text, and Start → Ready → Collected still works on it. Screenshots `qa/screenshots/<project>-kitchen-legacy.png`.
- **Reports** (`H-12`): `item-row-samosa` "Sweets Box Samosa / Shingara" 2 × £10.00 and `item-row-samosa_only` "Samosa" 3 × £15.00 are **separate rows**; likewise `item-row-straw` and `item-row-choc_strawberry`. Nothing is merged or relabelled. Screenshots `qa/screenshots/<project>-reports-mixed.png`.
- **CSV** (`H-13`): the thirteen-column export carries `Sweets Box Samosa / Shingara` and `Chocolate Strawberry & Marshmallow (V)` verbatim alongside the new names, one row per line.
- **A legacy line with no stored `name`** (`H-05`) falls back to the retired `MENU` row and still reads "Chocolate Strawberry & Marshmallow (V)" — this is why the two retired rows must stay in the seed.
- **Nothing is migrated** (`H-15`): the stored `items` array is byte-identical before and after `#/kitchen`, `#/reports` and `#/cash` have all been opened and left running; status is untouched.
- `stationOf` (`H-03`) resolves all four new ids **and** both retired ids to `sweets` — it neither throws nor falls through to a default — and `H-16` proves the station filter greys a retired-id line exactly like a new sweets line, never hiding it.

### Menu and icon coverage

- `H-01` asserts `MENU` field for field against the brief's ten-row table (id, name, short, price, colour, station, active, sort) with one `it()` per row, plus unique ids ("Never reuse a retired id").
- `H-02`: exactly eight active rows, sorts 1–8 with no gaps, in the order `fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain`; `samosa` 90 and `straw` 91 inactive; `ACTIVE_MENU` holds the eight and neither retired id.
- `H-04`: every one of the ten ids returns an inline SVG whose body differs from the `unknown` fallback — so the four new icons exist *and* `samosa`/`straw` are still there for old orders — all `aria-hidden`, stroke-only, no emoji code point.
- `H-07` (e2e): a fresh emulator seeds ten `menu/{id}` documents matching the same table, `active:false` on the two retired rows, and a second load does not duplicate them.
- `H-08`: the till renders exactly eight tiles in sort order; `tile-samosa` and `tile-straw` do not exist.
- `H-14`: an order built from the four new tiles is written with ids `sweet_box, samosa_only, choc_strawberry, marshmallow`, the new names and `price: 500`, and never a retired id.
- `H-17`: axe reports zero serious/critical violations on the eight-tile till; `send-order` ≥ 72 px and `line-inc-*`/`line-dec-*` ≥ 52 px are unchanged by the extra tiles.

### Contamination during the round (not bugs, not logged as such)

Three earlier full runs this round showed 5–11 failures each. Every one was environmental, not behavioural: Neo and Trinity were driving the **same** Firestore emulator on 8080 and the same `test-results/` directory at the same time. The signatures were unmistakable — `ENOENT … test-results/.playwright-artifacts-*` (another run clearing the output directory mid-test), a strict-mode violation on two `order-card-A-001` elements, an order document named `A-900 / "Legacy Lil"` that exists in no test in this repository, and seeded orders disappearing mid-test from another run's `DELETE …/documents`. Every one of those cases passed in isolation and in the clean run above. Per the Phase II lesson, none was written up as a bug. `npm run test:e2e` has no port guard, so two agents running it concurrently will always collide; that is noted for Trinity as a tooling gap, not an app defect.

### Test-side changes this round (not Neo's code, no app change required)

1. **Six-tile assertions updated to eight.** `C-01` now expects the eight active tiles in sort order and asserts `tile-samosa`/`tile-straw` are absent; `C-02` expects ten seeded `menu` documents (eight active, two retired with `active:false`, active sorts 1–8); `X-06`'s icon list is the eight active ids; `screenshots.spec.js` taps `tile-choc_strawberry` instead of the retired `tile-straw`. This is the hotfix landing, not a defect.
2. **`live-smoke.spec.js` S-08** now expects the ten live `menu` documents instead of six, and states why the two retired ids are never deleted.
3. **Phase I fixtures keep `samosa`** (`tests/unit/fixtures.js`, `reportFixture()` in `helpers.js`). They were left exactly as they were on purpose: they are now backwards-compatibility fixtures and exercise the retired-id path in `U-12`, `U-15`, `R-03` and `R-07` for free.
4. **H1 e2e fixtures use distinct order numbers** (`A-017`, `A-018`, `A-019`) and are looked up by `orderNo` rather than by collection index, so a legacy fixture can never be confused with an order the UI places (which always starts at `A-001`). This was hardened after the cross-run contamination above surfaced the fragility.
5. **`tests/e2e/live-h1.spec.js` (new, gated and read-only).** `H-20.1`…`H-20.5`: routes load clean, the live `menu` holds the ten H1 documents, the live till shows the eight tiles (and on phone the eighth is not covered), and the last trading day's takings and legacy item names are unchanged from the pre-deploy figures. It is skipped unless `LIVE_H1=1` and **has not been run** — H1 is not deployed. It performs GETs only: no order placed, no status changed, nothing cancelled, no menu document written. Apart from Trinity's single `scripts/menu-sync.mjs` run, nothing in this hotfix may write to live Firestore. Credentials are read at run time from the gitignored `.secrets/app-login.env`; the Show/Hide toggle is never pressed, so the password stays masked in every screenshot.

### Screenshots

All 28 emulator screenshots regenerated in the clean run, both viewports:
`<project>-{landing,cash,kitchen,reports}-{empty,orders}.png`, `<project>-login-{empty,error}.png`, `<project>-cash-{tender,confirm}.png`, plus the two new H1 captures `<project>-kitchen-legacy.png` (a card whose lines are `samosa` and `straw`) and `<project>-reports-mixed.png` (old and new item rows side by side). The 22 `live-*.png` are from the Phase II smoke and are deliberately **not** refreshed: H1 is not deployed yet.

### Final status of every bug after round 4

| id | severity | screen | status |
|---|---|---|---|
| BUG-1 | minor | `#/cash` | verified |
| BUG-2 | blocker | `#/cash` phone | verified — re-proved this round by `H-09` with eight tiles |
| BUG-3 | major | `#/cash` recent strip | verified |
| BUG-4 | major | `#/cash` cash received | verified |
| BUG-5 | major | `#/cash` stored order | withdrawn (requirement change) |

**No new bugs in round 4.**

Round 5 (live) added none either: see below.

---

## Round 5 — H1 live verification (read-only), 2026-10-19

Deploy under test: commit `21e45ff`, Pages run `39177899282`, `LIVE_URL` = https://nottinghambengaliassociation.github.io/nba-food-stall-app/ — after Trinity's single `menu-sync` run.

Command: `LIVE_H1=1 npx playwright test tests/e2e/live-h1.spec.js`. Evidence: `qa/screenshots/live-h1-*.png` (16 files) and `qa/live-smoke-record.txt`.

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| live phone 390×844 (`H-20.0`…`H-20.6`) | 7 | 0 | 0 |
| live tablet 1280×800 (`H-20.0`…`H-20.6`) | 7 | 0 | 0 |
| **live total** | **14** | **0** | **0** |

**Open bugs: none.** blocker 0 · major 0 · minor 0.

### Pass/fail per check requested

| Check | Phone | Tablet | Evidence |
|---|---|---|---|
| Exactly eight tiles, in sort order, neither retired item shown | **PASS** | **PASS** | `[fuchka, momo, chat, sweet_box, samosa_only, choc_strawberry, marshmallow, fountain]`; `tile-samosa`/`tile-straw` absent. `live-h1-<p>-cash-eight-tiles.png` |
| Eighth tile reachable and tappable with the order bar at its tallest | **PASS** | **PASS** | All eight answer `elementFromPoint` at their own centre; coordinate click on `tile-fountain` moved `qty-fountain` 0 → 1. `live-h1-<p>-cash-eighth-tile-tapped.png` |
| `#/reports` for 2026-10-18 shows the legacy items under their original names | **PASS** | **PASS** | `item-row-samosa` "Sweets Box Samosa / Shingara" ×2, `item-row-straw` "Chocolate Strawberry & Marshmallow (V)" ×3, `item-row-chat` "Papri Chat" ×1. KPIs £30.00 / 3 orders / 6 items match the live documents exactly. `live-h1-<p>-reports-2026-10-18.png` |
| CSV for that day carries the original names | **PASS** | **PASS** | 4 rows, 13 columns: `Papri Chat \| Sweets Box Samosa / Shingara \| Sweets Box Samosa / Shingara \| Chocolate Strawberry & Marshmallow (V)` |
| No console errors on any route, pill Online, login works | **PASS** | **PASS** | 0 console errors across `#/`, `#/cash`, `#/kitchen`, `#/reports`; pill "Online · synced" on all four; shared account signs in and lands on `#/`; no "Storage not configured" and no "Login not configured" banner |
| Live menu is the ten H1 documents, eight active | **PASS** | **PASS** | ids, names, shorts, stations and active flags all match the brief; active sorts exactly 1–8 |
| Nothing written to live Firestore | **PASS** | **PASS** | `orders` 3 → 3, byte-identical fingerprint (ids, names, quantities, status, totals); `menu` 10 → 10 |

### Difference from the brief found live (reported, not a failure)

Retired `menu/samosa` has `sort: 4` and `menu/straw` has `sort: 5`; the `CLAUDE.md` Menu table gives them 90 and 91. This is **correct behaviour**: `CLAUDE.md` → H1 4 tells `menu-sync` to "never overwrite a field that already has a different value … report differences instead", and both documents predate the hotfix. Both rows are `active: false`, so they are never tiles, and the reports group by id, not by sort — there is no functional effect. `H-20.2` therefore asserts name/short/station/active hard for all ten and the sort hard for the eight active rows only, and records the retired rows' sort as a difference. **For Trinity**, not for Neo.

### Differences from the emulator results

None of substance. The live run reproduced every emulator finding: eight tiles in the same order, the eighth tile tappable with the bar at full height, legacy ids reporting and exporting under their original names, and no migration of old documents. Two environmental notes:

1. The emulator seeds the retired rows with sorts 90/91 (matching the brief); live kept the pre-hotfix 4/5, as above. The emulator case `H-07` keeps asserting 90/91 because a fresh seed must follow the brief.
2. The live day under test (2026-10-18, 3 orders, £30.00) is real trading data rather than the synthetic mixed day used by `H-12`; both exercise the same path. Live has no order containing a *new* id yet, so the "old and new side by side" assertion only exists in the emulator case — placing a live order to create one would be a write, so it was **not** done.

### Test-side correction during this round (no app change)

`H-20.3`'s "nothing was sent" guard first asserted `order-toast` had **zero** nodes. That was wrong: the deployed `cash.js` builds the toast `<div>` once at screen construction and only shows/hides it (`public/js/cash.js`, `testid: 'order-toast'`), so its node count is always 1. The guard now asserts the toast is **not visible** and holds no order number, and then re-reads live Firestore to confirm the orders collection is unchanged — a direct check rather than a proxy. Live Firestore was independently queried the moment the guard tripped and held exactly the same 3 documents, all created 2026-10-18T16:55–16:59Z, so **no order was ever written**; the failure was in the assertion, not in the app or in the write discipline.

Tapping a tile is local state only — an order reaches Firestore solely through `send-order`, which this spec never clicks — and the panel is cleared again afterwards.

### Credential hygiene

Username and password were read at run time from the gitignored `.secrets/app-login.env`. The Show/Hide toggle is never pressed, so the password field is masked in every capture; the login screenshots are taken before the fields are filled. `qa/live-smoke-record.txt`, `qa/bugs.md`, `qa/test-plan.md` and all three new test files were re-scanned for the literal username, the literal password, `AIza[0-9A-Za-z_-]{35}` and `"private_key"`: **zero hits** (the three `AIza…` strings in `qa/test-plan.md` are the regex pattern quoted in prose, which `U-24`/`U-25` already tolerate).

---

## Round H2 — cart line alignment (19 Oct 2026)

Scope: `CLAUDE.md` → "Hotfix H2: cart line alignment (19 Oct 2026)" only. Phase III (Sales by day) remains deferred and untested.

**No `BUG-*` was raised this round.** The fix already in the working tree (`public/css/app.css`: `.line` as a grid of `minmax(0, 1fr) 52px 28px 52px 58px` with `column-gap: 6px`, `.line__name` 18 px wrapping, tabular numbers on `.line__qty` and `.line__amount`) passed every new assertion first time, on both viewports and at 360 px.

### New cases

`tests/e2e/cart-align-h2.spec.js` — `H-21`, `H-21.2`, `H-21.3`, both projects. Plan: `qa/test-plan.md` section 24.
`tests/e2e/live-h2.spec.js` — `H-22.0`…`H-22.3`, gated on `LIVE_H2=1`, **read-only with zero live writes**. Plan: section 25. Not run yet; run after the deploy.

The alignment assertions compare rows **against each other**, never against a hardcoded x, because the defect was a difference between rows.

### Measured geometry with all eight active items in the cart

Quantities 1…8. "Chocolate Strawberry" (longest active name) and "Momo" (shortest) are both present. All figures in CSS px.

**phone 390×844** — `.line` computed `display: grid`, `grid-template-columns: 144px 52px 28px 52px 58px`

| row | name | row.left | row.width | dec.left | inc.left | qty.left | amount.right | dec/inc size |
|---|---|---|---|---|---|---|---|---|
| fuchka | Fuchka / Gol Gappa | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| momo | Momo | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| chat | Papri Chat | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| sweet_box | Sweet Box | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| samosa_only | Samosa | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| choc_strawberry | Chocolate Strawberry | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| marshmallow | Marshmallow (V) | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |
| fountain | Chocolate Fountain | 16 | 358 | 166 | 258 | 224 | 374 | 52×52 |

Spread across the eight rows: `dec.left` **0.00 px**, `inc.left` **0.00 px** (allowed ±1).

**tablet 1280×800** — `.line` computed `display: grid`, `grid-template-columns: 118.266px 52px 28px 52px 58px`

| row | name | row.left | row.width | dec.left | inc.left | qty.left | amount.right | dec/inc size |
|---|---|---|---|---|---|---|---|---|
| fuchka | Fuchka / Gol Gappa | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| momo | Momo | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| chat | Papri Chat | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| sweet_box | Sweet Box | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| samosa_only | Samosa | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| choc_strawberry | Chocolate Strawberry | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| marshmallow | Marshmallow (V) | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |
| fountain | Chocolate Fountain | 899.73 | 332.27 | 1024 | 1116 | 1082 | 1232 | 52×52 |

Spread: `dec.left` **0.00 px**, `inc.left` **0.00 px**.

**360×740 (H-21.3)** — `dec.left` 136 and `inc.left` 228 on all eight rows, spread **0.00 px**; steppers 52×52; no horizontal scroll.

Overflow: every `.line__name` has `scrollWidth ≤ clientWidth` on all eight rows at all three widths; no name's right edge reaches its own `−` button; no row or line total passes the order panel's right edge. Steppers: 52×52 on every row, so the alignment was not bought by shrinking them.

`H-21.2`: stepping Momo out of the cart left `choc_strawberry`'s `dec.left` at 166 (phone) / 1024 (tablet) — unmoved — and a two-digit quantity on the longest line shifted neither column.

### Suite totals, one clean run (19 Oct 2026)

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| unit (`vitest run`, 8 files) | 166 | 0 | 0 |
| e2e phone 390×844 | 102 | 0 | 20 |
| e2e tablet 1280×800 | 103 | 0 | 19 |
| **e2e total** | **205** | **0** | **39** |

Skips are the gated live specs (`live-smoke` 8, `live-h1` 7, `live-h2` 4 = 19 per project) plus `T-08` (the Clear link is tablet-only in the mock-ups), which is phone-only.

**Open bugs: none.** blocker 0 · major 0 · minor 0.

### Screenshots

`qa/screenshots/phone-cash-cart-aligned.png` and `qa/screenshots/tablet-cash-cart-aligned.png` (eight-line cart). The standing `<project>-cash-empty.png` / `<project>-cash-orders.png` and every other screen were regenerated by the same run. `live-h2-cart-<project>.png` will be produced by the gated live check after the deploy.

### Test-side changes

None. No existing test needed updating for H2: the change is pure CSS and no assertion elsewhere depended on the flex layout. `H-17` already asserted `line-inc-*` / `line-dec-*` ≥ 52 px and still passes.
