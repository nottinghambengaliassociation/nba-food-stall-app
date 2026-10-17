# Charity Food Stall POS: Phase I build brief

You are the orchestrator. Build, test and deploy a working prototype end to end with three subagents:

| Agent | Role | Owns |
|---|---|---|
| `neo` | UI developer | `public/` (except the generated `public/js/firebase-config.js`), app scripts in `package.json` |
| `morpheus` | QA tester | `tests/`, `qa/`, `playwright.config.js`, `vitest.config.js` |
| `trinity` | Platform / DevOps | Firebase project and Firestore, GitHub repo, secrets, Pages, `firebase.json`, `.firebaserc`, `firestore.rules`, `.github/`, `.gitignore`, `scripts/`, every `git`, `gh` and `firebase` (non-emulator) command |

**Run without stopping.** Never ask the user a question. When something is unclear, pick the option closest to this brief, write one line in `DECISIONS.md`, and carry on. If a step is impossible (missing login, missing permission), skip it, record it in `HANDOVER.md` under "Needs you", and finish everything else.

App security is out of scope for Phase I: no login, open Firestore rules. **Secret hygiene is in scope** (next section).

## Settings

```
GITHUB_OWNER         = nottinghambengaliassociation      # a GitHub user account (gh is logged in as it), not an org
REPO_NAME            = nba-food-stall-app
LIVE_URL             = https://nottinghambengaliassociation.github.io/nba-food-stall-app/
FIREBASE_PROJECT_ID  = nba-food-stall-9fec6              # display name "nba-food-stall"; created by the user with Firestore (default) already set up. Use it, never create another project or database
FIRESTORE_LOCATION   = europe-west2                      # London
EMULATOR_PROJECT_ID  = demo-food-stall                   # demo- prefix: emulator runs with no login
```

## No keys or secrets in GitHub

- Nothing secret or environment-specific is ever committed: no Firebase config values, API keys, tokens, service-account JSON, `.env` files.
- `public/js/firebase-config.js` is **generated, never committed**. It is in `.gitignore`. Locally it is written by `scripts/write-firebase-config.mjs` from `firebase apps:sdkconfig`; in CI the Pages workflow writes it from GitHub Actions secrets just before upload.
- `public/js/firebase-config.example.js` (placeholders only) is committed so the shape is documented.
- GitHub Actions secrets, set by Trinity with `gh secret set` reading from a local gitignored file, never from a literal on the command line: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`.
- Guardrails: `.gitignore` covers `public/js/firebase-config.js`, `.env*`, `.secrets/`, `*service-account*.json`, `*-sdkconfig.json`; a git pre-commit hook (`scripts/check-secrets.sh`) blocks staged files matching `AIza[0-9A-Za-z_-]{35}` or `"private_key"`; GitHub secret scanning and push protection are enabled on the repo.
- Never print secret values in chat, logs, `DECISIONS.md` or `HANDOVER.md`.
- Plain fact for the handover: a Firebase web API key always ends up in the browser of a deployed web app. It identifies the project, it is not a password. Keeping it out of GitHub is still the rule here; restricting the key to the Pages domain is the extra step (Trinity does it if `gcloud` is available, otherwise "Needs you").

## What it does

One static single-page app, three screens, shared data in Cloud Firestore.

| Route | Screen | Used by |
|---|---|---|
| `#/cash` | Cash counter: build order, take name, cash or card, send | Till volunteer (tablet or phone) |
| `#/kitchen` | Food counter: New → Preparing → Ready → Collected | Food counter volunteers (tablet or phone) |
| `#/reports` | Daily totals, per item, peak demand, cash vs card, CSV export | Organisers |
| `#/` | Landing page with three big buttons to the above, plus till letter setting | Everyone |

### Menu (seed into Firestore on first load if `menu` is empty)

| id | name | short | price (pence) | tile colour | station |
|---|---|---|---|---|---|
| fuchka | Fuchka / Gol Gappa | Fuchka | 500 | #FDE68A | chaat |
| momo | Momo | Momo | 500 | #BFDBFE | momo |
| chat | Papri Chat | Papri Chat | 500 | #FECACA | chaat |
| samosa | Sweets Box Samosa / Shingara | Sweets Box | 500 | #FED7AA | sweets |
| straw | Chocolate Strawberry & Marshmallow (V) | Choc Strawberry | 500 | #E9D5FF | sweets |
| fountain | Chocolate Fountain | Choc Fountain | 500 | #E7D3BF | sweets |

Prices are edited in the Firebase console in Phase I; the app reads them from `menu`, never hard-codes them outside the seed.

### Data model

```
orders/{autoId}
  orderNo      "A-043"          till letter + 3-digit daily sequence
  name         "Priya"          name to call out; "Guest" if blank
  items        [{id, name, qty, price}]   price in pence
  total        1500             pence, integers only
  payment      "cash" | "card"
  tendered     2000 | null      cash only
  status       "new" | "preparing" | "ready" | "collected" | "cancelled"
  day          "2026-10-17"     Europe/London date
  till         "A"
  createdAtMs, startedAtMs, readyAtMs, collectedAtMs, cancelledAtMs   Date.now() numbers
  createdAt    serverTimestamp()

menu/{id}
  name, short, price, colour, station, active, sort
```

Order numbers are generated on the device: `localStorage["seq:<till>:<day>"]`, so the till never waits for the network. Till letter is set on the landing page (default A) and stored in `localStorage`.

Queries: only `where("day", "==", day)`; filter and sort on the client. No composite indexes.

## Functional requirements

### Cash counter
1. Six big item tiles with icon, name and £5. Tap adds one. Quantity badge on the tile.
2. Order panel: name input, line items with − and + (each at least 52×52 px), line totals, big total.
3. Cash or Card toggle. Cash shows quick tender buttons £5, £10, £20, £50 and "Change to give".
4. "Send to food counter" button (at least 72 px tall), disabled when empty. On send: write the order, show a confirmation with the order number for 4 s, clear the panel.
5. Recent orders strip (last 5 from this till) with live status. Cancel is available while status is `new`.
6. Connection pill: "Online · synced" or "Offline · N queued" (use `navigator.onLine` plus snapshot `hasPendingWrites`).

### Food counter
1. Live `onSnapshot` on today's orders. Three columns on tablet (New, Preparing, Ready); tabs with counts on phone.
2. Card shows order number, name, items with quantities and icons, and age ("3 min"). Age turns amber at 6 min or more.
3. One big action button per card: Start → Ready → Collected (at least 64 px tall). Ready cards show the name in large capitals for calling out.
4. Station filter: All, Chaat, Momo, Sweets. Lines not for the station are greyed but still shown.
5. "Undo last tap" restores the previous status.
6. Short beep on a new order (Web Audio, toggle in header). Request a screen wake lock where supported.

### Reports
1. Date input, default today (Europe/London).
2. KPI tiles: total sales, orders, items sold, average order, average wait (createdAt to readyAt). Cancelled orders excluded everywhere.
3. Sales by item: units, revenue, bar.
4. Orders per 30 minutes as a bar chart, peak bar highlighted, "Peak 30 min" and "Busiest 2 hours" callouts, "Show as table" toggle.
5. Cash vs card split with amounts and percentages.
6. "Export CSV" downloads one row per order line: day, orderNo, till, name, item, qty, price, lineTotal, payment, status, createdAt, readyAt, waitSeconds.

## Design

Reference mock-ups are in `design/*.dc.html` (read the markup for layout, sizes and colours; they are not runnable as-is). Match them.

- Fonts: Bricolage Grotesque 600/800 for headings and numbers, Atkinson Hyperlegible 400/700 for everything else (Google Fonts).
- Colours: ink #1C1917, muted #57534E, line #E7E5E4, page #F5F5F4, card #FFFFFF, marigold #FDE68A (selected), action blue #1D4ED8 (Start), teal #0F766E (Ready, Send), amber warning #B45309.
- Dark header bar on every screen.
- Touch targets at least 48 px; primary actions 64 to 84 px. Body text at least 17 px.
- Breakpoint 700 px: below it, phone layout (2-column tiles, sticky bottom order bar on cash, tabs on kitchen). Above it, tablet/desktop layout.
- Icons: inline stroke SVG per item (see `design/ItemIcon.dc.html`). No emoji.
- No horizontal scroll at 360 px width.

## Technical constraints

- No build step. Plain HTML, CSS and ES modules in `public/`, served as-is by GitHub Pages.
- Firebase modular JS SDK imported from `https://www.gstatic.com/firebasejs/<version>/...`. Pin the version: run `npm view firebase version` and use that.
- Firestore with `persistentLocalCache` and `persistentMultipleTabManager` for offline writes.
- On `localhost` or `127.0.0.1`: initialise with `{ projectId: "demo-food-stall", apiKey: "demo" }` and `connectFirestoreEmulator(db, "127.0.0.1", 8080)`. Add `?live=1` to use the real project locally. Elsewhere: load `public/js/firebase-config.js` with a dynamic `import()`. If it is missing or still has `PASTE_` placeholders, show a clear banner "Storage not configured" instead of crashing.
- Put all pure logic (money, order numbers, day string, report aggregation, CSV) in `public/js/logic.js` with no Firebase imports, so it is unit-testable.
- `firebase.json` (Trinity) configures the Firestore emulator on port 8080, UI off, and points at `firestore.rules`: `allow read, write: if true;` (prototype only).
- Dev tooling via npm (devDependencies only): `firebase-tools`, `@playwright/test`, `@axe-core/playwright`, `vitest`, `http-server`.

### Suggested layout
```
public/index.html  public/css/app.css  public/manifest.webmanifest
public/js/{app,router,store,logic,cash,kitchen,reports,icons}.js
public/js/firebase-config.example.js     committed, placeholders
public/js/firebase-config.js             generated, gitignored
tests/unit/*.test.js   tests/e2e/*.spec.js
qa/test-plan.md  qa/bugs.md  qa/screenshots/
scripts/write-firebase-config.mjs  scripts/check-secrets.sh
firebase.json  .firebaserc  firestore.rules  .gitignore
playwright.config.js  vitest.config.js  package.json
.github/workflows/pages.yml
```

### npm scripts
```
"serve":    "http-server public -p 5173 -c-1 --silent"
"test:unit":"vitest run"
"test:e2e": "firebase emulators:exec --only firestore --project demo-food-stall \"playwright test\""
"test":     "npm run test:unit && npm run test:e2e"
```

## Workflow

1. **Platform first (Trinity), in parallel with step 2.** Pre-flight checks, then: git repo and guardrails (`.gitignore`, pre-commit hook, example config) before any commit; Firebase project, web app, Firestore `(default)` in London, rules; local `firebase-config.js`; GitHub repo, secrets, Pages, secret scanning. Every failure goes to "Needs you" and the build carries on against the emulator.
2. **Build and test plan in parallel.**
   - Neo: scaffold, `npm install`, implement all three screens and the landing page against the emulator.
   - Morpheus: write `qa/test-plan.md` from this brief, then unit and e2e tests. Morpheus tests the brief, not Neo's code.
3. **Test loop.** Morpheus runs `npm test`, writes failures to `qa/bugs.md` (id, severity, steps, expected, actual, screenshot). Hand the bug list to Neo. Neo fixes, never edits tests. Repeat until green, maximum 5 rounds. If a test is wrong against the brief, Morpheus fixes the test and notes it.
4. **Deploy (Trinity).**
   - Run `scripts/check-secrets.sh` on the whole tree and `git status --ignored` to confirm `firebase-config.js` is ignored. Then commit and push to `main`.
   - `.github/workflows/pages.yml`: on push to `main`, write `public/js/firebase-config.js` from the six `FIREBASE_*` secrets, then `actions/upload-pages-artifact` (path `public`) and `actions/deploy-pages`.
   - `gh run watch` until green. Live URL is `LIVE_URL`.
   - If Firebase secrets are missing, still deploy; the banner shows and it goes under "Needs you".
5. **Live smoke (Morpheus).** Against the live URL: all routes load, no console errors, connection pill shows Online. If real Firebase is configured, place one order named `QA-SMOKE`, take it to Collected, then cancel a second `QA-SMOKE` order.
6. **Handover (you).** Write `HANDOVER.md`: live URLs for each screen, how to set up a till and a kitchen tablet on the day, test results (counts, pass/fail), links to `qa/screenshots/`, Playwright report path, known issues, "Needs you" list. Open the Playwright HTML report and the live URL in the browser if the platform allows (`open` on macOS, `xdg-open` on Linux, `start` on Windows).

## Definition of done

- `npm test` green: unit and e2e, phone (390×844) and tablet (1280×800) projects.
- Screenshots of every screen at both sizes in `qa/screenshots/`.
- Live on GitHub Pages and smoke-tested.
- `git log -p` contains no Firebase config values, keys or tokens; secret scanning shows no alerts.
- `HANDOVER.md`, `DECISIONS.md`, `qa/test-plan.md`, `qa/bugs.md` (with final status of each bug) committed and pushed.

## Rules

- Never `git push --force`, never `git add -f`, never delete a repo, never use `sudo`.
- Only Trinity runs `git commit`, `git push`, `gh` and real-project `firebase` commands. Neo and Morpheus may run the emulator through `npm` scripts.
- Neo does not touch `tests/`, `qa/` or platform files. Morpheus does not touch `public/` or platform files. Trinity does not touch app code or tests.
- Money is integer pence everywhere; format as £ only for display.
- Keep it simple. If a feature in this brief threatens the deadline, ship without it and list it in `HANDOVER.md`.
