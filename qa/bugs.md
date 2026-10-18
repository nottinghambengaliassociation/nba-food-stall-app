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

## Final status of every bug

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
