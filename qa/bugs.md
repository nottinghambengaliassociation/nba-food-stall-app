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

## Live smoke — not yet run

`https://nottinghambengaliassociation.github.io/nba-food-stall-app/` returned **404** as of round 2: Pages has not published yet (Trinity, workflow step 4). Not run on instruction from the coordinator. The live smoke spec is written and gated behind an environment flag:

```
LIVE_SMOKE=1 npx playwright test tests/e2e/live-smoke.spec.js
```

It covers S-01 (all four routes load on both viewports, no console errors, screenshots to `qa/screenshots/live-*.png`), S-02 (connection pill, or the "Storage not configured" banner if the Firebase secrets are missing), and S-03 (the `QA-SMOKE` order taken to Collected plus a second one cancelled — auto-skipped when the banner is showing). It is excluded from `npm run test:e2e` so the emulator suite stays deterministic.
