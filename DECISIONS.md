# Decisions

One line per judgement call made during the Phase I build, so nobody has to guess later why
something is the way it is. The brief said never stop to ask; this is the record of what was
picked instead.

## Orchestration

- 2026-10-17 — Ran Trinity (platform), Neo (app) and Morpheus (tests) concurrently from the start rather than serially, because only the e2e run depends on all three.
- 2026-10-17 — `DECISIONS.md` is written by the orchestrator only. Subagents report their decision lines back rather than editing the file, so three parallel writers cannot clobber each other.
- 2026-10-17 — `firebase.json` was put at the top of Trinity's queue, ahead of the live-project work, because Neo and Morpheus both need the emulator config before they can run anything.

## Pre-flight

- 2026-10-17 — Firebase web SDK pinned to **13.0.0**, the version `npm view firebase version` reported at build time.
- 2026-10-17 — Java 21 (Temurin) confirmed present, so the Firestore emulator path is available and e2e tests run locally rather than against the live project.
- 2026-10-17 — `gcloud` is not installed on this machine, so restricting the Firebase web API key to the Pages domain cannot be automated. Recorded as a "Needs you" item in `HANDOVER.md` instead of blocking the build.

<!-- Agent decision lines are appended below as each agent reports. -->

## Platform (Trinity)

- 2026-10-17 — Git author set **locally only** to `Nottingham Bengali Association <...@users.noreply.github.com>` rather than the machine's personal identity, to keep a private work email out of a public repo's history. `git config --global` untouched.
- 2026-10-17 — Pre-commit hook installed via `core.hooksPath=scripts/hooks` so it is version-controlled and every clone gets it, with a duplicate shim in `.git/hooks/` in case `hooksPath` is ever reset.
- 2026-10-17 — `check-secrets.sh` matches `"private_key"` only when followed by a colon. `CLAUDE.md` quotes the bare pattern, so without that the brief itself would be a permanent false positive. All patterns are written so neither the brief nor the scanner self-matches.
- 2026-10-17 — Scanner widened past the brief's two patterns to also catch `private_key_id`, classic and fine-grained GitHub PATs, OAuth tokens and PEM private-key blocks. Cheap to add, and the cost of missing one is a public leak.
- 2026-10-17 — `--all` mode enumerates via `git ls-files --cached --others --exclude-standard`, so gitignored paths are skipped automatically and the generated `firebase-config.js` is never scanned or named in output.
- 2026-10-17 — Pages workflow pins **current** action majors (checkout@v7, setup-node@v7, configure-pages@v6, upload-pages-artifact@v5, deploy-pages@v5) rather than the v3/v4 the brief named, which are several majors stale. Verified against the GitHub releases API by Trinity and independently re-checked by the orchestrator before the first push.
- 2026-10-17 — `write-firebase-config.mjs` auto-discovers the web app id from `firebase apps:list WEB --json` rather than hard-coding it, so no identifier is baked into a committed file.
- 2026-10-17 — The CI config writer exits 0 even when secrets are missing, writing placeholders instead. A missing secret then shows the app's "Storage not configured" banner rather than failing the whole deploy.
- 2026-10-17 — A new Firebase Web app was created ("NBA Food Stall Web") because the existing project had none. The project and the `(default)` Firestore database in `europe-west2` were reused untouched, per the brief.

## App (Neo)

- 2026-10-17 — `formatPence` uses `toFixed(2)` with no thousands separator (`£1000.00`), matching the cash-counter mock-up rather than the reports mock-up's locale grouping. One rule everywhere beats two.
- 2026-10-17 — Cancelled orders are excluded from the CSV export as well as the KPIs, reading "cancelled orders excluded everywhere" as covering the whole Reports screen. The `status` column therefore never contains `cancelled`.
- 2026-10-17 — The connection pill shows only the brief's two states. Online always reads "Online · synced" with no transient syncing state; offline reads "Offline · N queued" from snapshot `hasPendingWrites`.
- 2026-10-17 — Order writes are fired without `await`, so the till never blocks on the network and offline orders appear instantly from the local cache. This is the point of generating order numbers on the device.
- 2026-10-17 — The kitchen renders tabs and all three columns into the DOM at both sizes, with CSS hiding tabs above 700px and non-selected columns below it. Both `col-*` and `tab-*` stay queryable at any viewport.
- 2026-10-17 — Each `data-testid` appears exactly once per route: the landing page owns the three nav buttons, the header owns them elsewhere, and `till-letter` appears on `#/` and in the `#/cash` header only. It changes nothing on kitchen or reports, and it was overflowing the phone header.
- 2026-10-17 — Phone cash keeps the bottom-pinned order panel rather than the mock-up's summary-only bar, so line items and change-due stay reachable on a 390px screen. Rows are `flex: 0 0 auto` and the panel scrolls internally; Send is a normal row, not sticky. The first attempt shipped with default `flex-shrink: 1` and a sticky Send, which squashed the rows into each other and made the line + button untappable (BUG-2, blocker, fixed in round 2).
- 2026-10-17 — Added `public/js/ui.js` (DOM helpers) and `public/js/landing.js` beyond the suggested file list. `logic.js` stays dependency-free so Vitest can import it directly.

## QA (Morpheus)

- 2026-10-17 — Six of Morpheus's own tests were wrong against the brief and were corrected rather than filed as app bugs: a `localStorage` clear running on every reload, an offline *document* reload the brief never promises, an over-strict DOM assertion at the phone kitchen breakpoint, and reports assertions sampling the empty state before the snapshot landed. Each is noted in a table in `qa/bugs.md`.
- 2026-10-17 — The live-smoke spec is written but gated behind `LIVE_SMOKE=1`, so `npm test` stays green on a machine with no deployed site and the smoke run is an explicit step after deploy.
- 2026-10-17 — Unit tests include a repo guard that fails if any `git ls-files` tracked file matches the Firebase API-key pattern. Secret hygiene is then enforced by the test suite as well as the pre-commit hook.
- 2026-10-17 — BUG-3 (Cancel pill measured at 40px, under the 48px minimum) reproduced once mid-build and never again. Logged as closed-not-reproducible and sent to Neo as a defensive fix rather than left open on a flaky observation.

## Deploy and live smoke

- 2026-10-17 — Push initially failed 403 because the machine's keychain resolved a different GitHub account. Fixed with a **repo-local** credential helper (`!gh auth git-credential`) rather than `gh auth setup-git`, which writes to global config and is forbidden by the brief. Documented in `HANDOVER.md` since a fresh clone on an affected machine will hit the same thing.
- 2026-10-17 — `.claude/` (the three agent definitions and `settings.json`) was committed. It was inspected first and contains permission rules only, no secrets or machine paths, and it documents the guardrails the build ran under.
- 2026-10-17 — The live smoke's full order round trip was gated to one viewport rather than running per project, so it left two documents in the real database instead of four.
- 2026-10-17 — The live Firebase project was completely empty, so the smoke test's first page load fired the menu seed and wrote the six menu documents. Those are kept: they are the real menu, the seed only runs when `menu` is empty, and keeping them means organisers can edit prices in the console and will not see a seed on the day. Only the two `QA-SMOKE` orders were treated as test data to remove.
- 2026-10-17 — Deleting live data is Trinity's alone. Morpheus identified the two test orders by id and reported them rather than removing them itself.

---

# Phase II — login, sign out and Cash received (2026-10-18)

## Orchestration

- 2026-10-18 — Followed the brief's "already built" path: no rebuild, no refactor of working Phase I code. Only the two new features, their tests, a redeploy and a handover update.
- 2026-10-18 — Trinity's `write-login-config.mjs` was put first in its queue because both Neo and Morpheus are blocked on `public/js/login-config.js` existing locally.
- 2026-10-18 — Test credentials are read from the gitignored `.secrets/app-login.env` at runtime. They are never written into a test file, fixture, screenshot, `qa/test-plan.md` or `qa/bugs.md`, all of which are committed to a public repo. Failed-login cases use an obviously fake wrong password.
- 2026-10-18 — Existing Phase I e2e tests needing a sign-in step is expected, not a regression. Morpheus updates them rather than filing bugs against Neo.
- 2026-10-18 — `claude-setup/` reappeared untracked, a re-dropped copy of a kit already installed in `.claude/`. Left out of the repo.

## Platform (Trinity)

- 2026-10-18 — `scripts/write-login-config.mjs` hashes the password in-process. The plaintext is read only from `.secrets/app-login.env` and is never written to a file, a GitHub secret or a log; only the SHA-256 leaves the machine.
- 2026-10-18 — `--from-env` writes `PASTE_` placeholders and exits 0 when a login secret is absent, matching the Firebase precedent. A missing secret degrades to "Login not configured" rather than breaking the Pages deploy.
- 2026-10-18 — The `--actions-env` helper writes username plus hash only and refuses any path outside `.secrets/`. The file was deleted immediately after `gh secret set -f`.
- 2026-10-18 — The secret scanner now blocks `(APP_)?LOGIN_PASSWORD` followed by an assignment and a plain value. `APP_LOGIN_PASSWORD_SHA256=` is deliberately **not** matched: the hash is designed to ship in the browser bundle, so blocking it would be a permanent false positive.
- 2026-10-18 — `claude-setup/` added to `.gitignore`. It is a re-dropped copy of a kit already installed in `.claude/`, so it cannot now be committed by accident.

## App (Neo)

- 2026-10-18 — **Cash received is not persisted at all.** User instruction on the day, overriding CLAUDE.md: it is a quick calculator for the cashier and nothing more. Neither `tendered` nor `changeGiven` is written to the order (the fields are omitted, not set to `null`), and the CSV reverts to the Phase I header. The on-screen behaviour is unchanged. **CLAUDE.md's data model and CSV spec are now out of step with the app** — the brief was not edited, so anyone reading it later should treat this line as the authority.
- 2026-10-18 — ~~A short cash amount is stored, not nulled.~~ **Superseded** by the line above; retained because it records a real ambiguity in the brief. The original reading was: The brief's "no amount, a short amount, or an unparseable amount (saved as `tendered: null`)" reads as if all three null out, but the data model settles it: `changeGiven` is defined as "`tendered − total` when `tendered ≥ total`, else `null`", which only has meaning if a below-total `tendered` is stored, and `tendered` is documented as "null if **not entered**". A short amount is entered. So empty and unparseable store `null`; a short amount stores the pence with `changeGiven: null`. Orchestrator-endorsed reading.
- 2026-10-18 — Sign out is exactly 44×44 below 700px, per the brief's explicit requirement 7. It is the only interactive control under the global 48px minimum on phone, so the cross-cutting touch-target test carries a sign-out exemption below 700px rather than the brief being violated in one direction or the other.
- 2026-10-18 — No dark header on `#/login`. Both login mock-ups show a plain centred card, so the "dark header on every screen" design rule is taken to mean every *working* screen, not the gate in front of them.
- 2026-10-18 — Quick cash buttons are 48px on phone rather than the brief's minimum of 44, so they satisfy the global 48px touch target as well, and 54px on tablet.
- 2026-10-18 — `"0"`, negative numbers and junk all count as unparseable and show "Enter an amount like 17.50", matching the mock-up's `!(pence > 0)` rule.
- 2026-10-18 — CSV `tendered` and `changeGiven` are written as plain pounds (`20.00`, no £ glyph), blank when null, and always blank on card rows.
- 2026-10-18 — The Cash received block is hidden while the order panel is empty, and emptying the panel resets it, following the mock-up's `showTender: isCash && !empty`.
- 2026-10-18 — The landing page eyebrow "PHASE I · NO LOGIN" was removed, since it became false.

## QA (Morpheus)

- 2026-10-18 — Test credentials are read at runtime from the gitignored `.secrets/app-login.env` via `tests/e2e/creds.js`. A unit test (`U-25`) fails the build if either value appears anywhere in the tracked tree, so the rule is enforced on every run rather than relying on discipline.
- 2026-10-18 — An early login screenshot captured the real username and was deleted. The committed error screenshots use a made-up username with the password field cleared and masked. Verified visually by the orchestrator before the push, since no text scanner can read a PNG.
- 2026-10-18 — BUG-4 (major): cash received survived emptying the order panel, so a fresh order opened showing a stale "Change to give". Fixed and re-verified at both viewports.
- 2026-10-18 — BUG-5 was withdrawn rather than fixed. It reported a short tender storing as `tendered: null`; the requirement change that stopped persisting cash received entirely made it moot.
- 2026-10-18 — Phase I e2e tests were updated to sign in first, since login now gates every route. Expected consequence of the new requirement, not a regression, so not filed against Neo.
- 2026-10-18 — Neo's and Morpheus's concurrent runs against the same emulator cross-contaminated each other (seeded report orders leaking into tender tests, duplicate order numbers). Final counts come from one clean run with nothing else on the machine.

## Live smoke and cleanup (Phase II)

- 2026-10-18 — The host Mac slept three times, killing Morpheus on its first tool call each time. The fix was to bank the read-only live-state check at the orchestrator level, then have Morpheus write `qa/live-smoke-record.txt` and each screenshot incrementally rather than composing them at the end, and prefer fewer, larger steps. No work was lost and no live data was orphaned.
- 2026-10-18 — The decisive Phase II assertion was made against production, not the emulator: a live order sent with £20 keyed into Cash received has no `tendered` and no `changeGiven` keys at all, while the pre-existing orders in the same collection carry `tendered`. That contrast is what proves the requirement change shipped.
- 2026-10-18 — Five orders from 2026-10-17 (`Bodhi`, `Ravi`, `Guest`, `Subu Test`, `Arnab`) were the user's own hand-testing of the live site, not agent output. Left in place until the user asked for them, then deleted by exact document id.
- 2026-10-18 — Three of those five were numbered `A-001`, because each device keeps its own `localStorage` sequence and all were set to till A. The order-number collision the handover warns about, observed in real data rather than in theory. It reinforces the day-of instruction to give every till a different letter.
- 2026-10-18 — Deletion of live data stayed with Trinity throughout, even while Morpheus was concurrently writing to the same collection. Trinity was given exact document ids and told to expect the collection to change underneath it, rather than deleting by query.

## Final state (Phase II)

- 2026-10-18 — Seven live documents deleted by exact id: the five 2026-10-17 hand-test orders and Morpheus's two `QA-SMOKE` orders. `orders` is now empty, `menu` retains its six seeded documents. Correct starting state for the event.
- 2026-10-18 — The Firebase CLI login on this Mac expired mid-run, and `firebase login --reauth` is interactive, so the deletions went through the Firestore REST API as seven individual document-path calls. The helper was hard-wired to the `orders` collection with no recursive, query-based or collection-wide mode, so `menu` was not addressable through it. Recorded as a "Needs you" since nothing else depends on that login.
- 2026-10-18 — Phase II shipped as `8b3fc3d` (features) and `39d14a3` (handover and live artefacts), both deployed green first time. Live site 200 with both generated configs real, secret scanning reporting zero alerts.

---

# Hotfix H1 — split menu items (2026-10-18)

- 2026-10-18 — H1 ships on its own, before Phase III. The Sales by day report is in the brief and in `design/ReportsByDay.dc.html` but is explicitly deferred; all three agents were told not to start it.
- 2026-10-18 — **The brief's assumption that the console change was already made by hand is wrong.** Checked the live database before starting: `menu` still held the original six documents with `samosa` and `straw` active and `fountain` at sort 6. `scripts/menu-sync.mjs` therefore does the real work rather than reconciling someone else's edit. The script is written to be correct either way, since it must be idempotent.
- 2026-10-18 — Three real orders from the evening's service (17:55–17:59, `Ritvik`, `Deeksha`, `Rimpa`) are in the live database, and two of them contain `samosa` and `straw`, the exact ids being retired. Backwards compatibility is therefore tested against a real trading record, not a hypothetical, which is why the retired ids stay in the seed with `active: false` and are never reused.
- 2026-10-18 — Checked the clock before touching anything: service ran 17:55–17:59 and it was 22:35, so the stall was closed. Deploying a menu change and running `menu-sync` mid-service would have changed the till under the volunteers.
- 2026-10-18 — `menu-sync` is the single permitted write to live Firestore in this hotfix. Everything else in the live check is read-only, and the script may never delete a document or overwrite a field that already differs.

## Platform (Trinity)

- 2026-10-18 — Added `firebase@13.0.0` to **devDependencies**, pinned exactly to the gstatic version `store.js` imports, so `scripts/menu-sync.mjs` can use the web SDK from Node. The deployed site still loads Firebase from gstatic, so the no-build-step constraint holds.
- 2026-10-18 — `menu-sync.mjs` writes to existing documents only through a three-entry whitelist (`samosa.active`, `straw.active`, `fountain.sort`), and only when the stored value is the known pre-hotfix or target value. Every other mismatch is reported and left alone, so a deliberate console edit such as a price change survives the sync.
- 2026-10-18 — Each create and update runs inside a Firestore transaction that re-reads and re-checks the stored value, so a document edited between read and write is skipped rather than clobbered. There is no delete path in the script at all.
- 2026-10-18 — The retired `samosa`/`straw` `sort` values stay at their live 4 and 5 rather than being written to the brief's 90 and 91. Changing them is not among H1's three permitted field writes, and sort only affects tile ordering among *active* items, so it is cosmetic. Reported, not written, which keeps the live first run at exactly four creates and three field changes.
- 2026-10-18 — Verified against the emulator on port **8099** rather than the default 8080, so the test could not collide with Morpheus's concurrent suite. Phase II taught us what shared-emulator contention costs.
- 2026-10-18 — Tested the conflict path explicitly, not just the happy path: seeded a changed price, colour and sort, and confirmed all three were reported and left unchanged while the valid creates and flips still applied.

## App (Neo)

- 2026-10-19 — `logic.js` gained `ACTIVE_MENU` (the seed filtered to `active !== false`) next to `MENU`. `MENU` stays the full ten rows so `stationOf` and the report name lookup resolve `samosa` and `straw`; the till, and the store's offline fallback, render `ACTIVE_MENU` so a retired item can never be sold again.
- 2026-10-19 — The two retired rows keep sort 90 and 91 in the seed exactly as the brief's table says. Sort only orders active tiles, so the values are inert, but a fresh emulator then matches the documented menu row for row.
- 2026-10-19 — `samosa_only` reuses the existing samosa triangle and `choc_strawberry` the existing strawberry, as instructed; `sweet_box` is a new box-with-ribbon and `marshmallow` two stacked rounded cylinders. The old `samosa` and `straw` icons stay in `icons.js` so the three orders already in the live database keep their pictures.
- 2026-10-19 — Phone layout for eight tiles: the tile area scrolls and is guaranteed `min(190px, 26dvh)`, enough for a full tile row with the next peeking, and the order sheet is now shrinkable (`flex: 0 1 auto`, cap 62dvh) instead of a fixed 68dvh block. Before the change the sheet always took 573px of an 844px phone and left the tiles 123px; now the tiles get 190px or more and no tile can end up under the bar.
- 2026-10-19 — Send and Clear moved into a `.panel__foot` that is sticky to the bottom of the order sheet on phones. Shrinking the sheet to free tile space would otherwise have pushed "Send to food counter" below the fold for every order of one item or more, which is the Phase I "control you can see but cannot tap" failure in a new costume. Verified with `document.elementFromPoint` at the centre of all eight tiles and of the Send button.
- 2026-10-19 — The line list, not the whole sheet, is what scrolls on a phone (`.lines` is `flex: 1 1 auto` with `overflow-y: auto`), so the total, the Cash/Card toggle and Send stay put while a long order scrolls behind them.
- 2026-10-19 — `watchMenu` coalesces Firestore snapshots over 120 ms and `buildTiles` skips rebuilds when the item signature has not changed. Seeding ten documents makes the listener fire a burst of part-finished snapshots, which rebuilt the eight tiles roughly thirty times in two seconds and detached buttons mid-tap. Measured with a MutationObserver: thirty-odd childList bursts before, zero after.

## Orchestration note

- 2026-10-19 — Neo and Morpheus ran `npm run test:e2e` concurrently at 00:32 and shared one Firestore emulator, clearing each other's data mid-test. All five of Neo's tablet `menu-h1` failures fell in that window and passed in isolation. **This is the second time shared-emulator contention has produced phantom failures** (Phase II was the first). `npm run test:e2e` has no port guard, so the only mitigation currently is scheduling: one agent on the suite at a time. Worth a real fix before any future phase.

## QA (Morpheus) — H1

- 2026-10-19 — H1 added 50 unit cases and 22 e2e cases on top of the Phase II baseline of 116 unit / 177 e2e. Every H1 case passed against Neo's code first time; no bugs were raised this round.
- 2026-10-19 — The eighth-tile check clicks **by coordinate** with `page.mouse.click` and then asserts the quantity badge moved, rather than using a Playwright locator click. A locator click auto-scrolls and would pass even if the order bar covered the tile in normal use, which is exactly how the Phase I blocker slipped through.
- 2026-10-19 — A legacy line with no stored `name` still resolves to "Chocolate Strawberry & Marshmallow (V)" from the retired seed row. That is why the retired rows have to stay in the seed rather than only in Firestore.
- 2026-10-19 — Three earlier full runs showed 5–11 failures, all environmental: missing Playwright artifact directories, a strict-mode violation from duplicate order cards, and an order `A-900 "Legacy Lil"` that exists in no test in this repo. All passed in isolation and in the clean run, so none was written up as a bug. H1 fixtures were hardened to use distinct order numbers and to look orders up by `orderNo` rather than by collection index.
- 2026-10-19 — `tests/e2e/live-h1.spec.js` is gated on `LIVE_H1=1` and issues GETs only. Apart from Trinity's single `menu-sync` run, nothing in this hotfix writes to live Firestore.

## H1 close-out

- 2026-10-19 — The three orders from Saturday's service were held until the live check had used them as evidence, then deleted by exact document id on the user's explicit authorisation and after they confirmed a CSV backup. `orders` is empty, `menu` retains all ten documents including the retired pair.
- 2026-10-19 — A security warning was raised against that deletion by the subagent framework because the subagent could not see the user's authorising messages. False positive. The authorisation and the backup confirmation are both in the conversation, and the deletion was done by verified document id with no collection-level or query-based delete.
- 2026-10-19 — Recorded in `HANDOVER.md` that the order-number counter lives in the device's `localStorage`, so clearing Firestore does not reset it: a till that reached A-003 continues at A-004 against an empty database. Deliberate, since device-side numbering is what lets the till work offline, but surprising enough to be worth stating.
- 2026-10-19 — H1 shipped across three commits: `21e45ff` (code and `menu-sync.mjs`), `f8db2ed` (QA artefacts and handover) and `69e2f98` (the per-device counter note). Live `menu` 10 documents with 8 active, `orders` empty. Phase III remains deferred and no Phase III code exists in the tree.

---

# Hotfix H2 — cart line alignment (2026-10-19)

- 2026-10-19 — H2 ships alone, before Phase III, which stays deferred.
- 2026-10-19 — Morpheus runs **alone** this time. Shared-emulator contention between two agents produced phantom failures in both Phase II and H1, so the emulator and dev server were stopped before starting and Neo was not launched. Neo is held in reserve and only acts if the alignment test fails, per the brief.
- 2026-10-19 — The alignment assertion compares rows **against each other** within ±1px rather than against hardcoded pixel positions. The bug was rows disagreeing with one another, so a fixed expected value would test the wrong thing and would need rewriting whenever the layout moved.
- 2026-10-19 — The test also asserts the steppers are still at least 52×52. The brief is explicit that the 52px steppers are kept, and aligning the columns by shrinking them would satisfy a naive alignment check while breaking the touch target.
- 2026-10-19 — H2 permits **no writes to live Firestore at all**, not even the single `menu-sync` exception H1 had. The live check is strictly read-only and places no orders.

## H2 results and close-out

- 2026-10-19 — The alignment test passed first time; Neo was never needed and the CSS already in the working tree shipped unchanged. Measured spread of the stepper left positions across all eight cart rows: **0.00px**, on phone, tablet and at 360px, and identical to the pixel on production.
- 2026-10-19 — Because H2 is a pure CSS change, the deploy was verified by **comparing the SHA-256 of the served stylesheet with the committed file**, not by a 200 response, and by confirming the old `display: flex` rule has zero occurrences in the served bytes. A stale cache would have returned 200 and shipped the old layout.
- 2026-10-19 — The stylesheet is served with `cache-control: max-age=600`, so a till that loaded within ten minutes keeps the old layout even though the origin is correct. Written into `HANDOVER.md` as the reason to refresh open tills before service.
- 2026-10-19 — Morpheus's first live attempt set `Cache-Control: no-cache` via `extraHTTPHeaders`, which is not CORS-safelisted, so it was attached to the Firebase SDK's cross-origin module imports on gstatic and preflighted them into failure. The app hung on "Loading…". Harness fault, not a deploy fault, and the spec now documents why that header must not come back. The guard against the cache trap was itself the trap.
- 2026-10-19 — The phone live screenshot legitimately shows only one cart row, because the lines sit in an internal scroller inside the sticky bottom sheet. A third capture was added at the same 390px width on a taller viewport so all eight rows are visible, with the grid tracks and stepper positions re-measured before the shutter rather than left as illustration.
- 2026-10-19 — Live `orders` was found to hold one document (`A-001`, collected, `2026-10-19`) at the time of the H2 live check, new since the H1 wipe. Left untouched: from this point a document may be a real order, and H2 authorises no writes to live Firestore at all.

---

# Phase III — Sales by day report and app version (2026-10-19)

- 2026-10-19 — Phase III ships both parts in one release, `v1.2.0`: the Sales by day report and the app version labels. The brief pairs them under one version number, so splitting them would leave a version label advertising a release that had not fully landed.
- 2026-10-19 — The `version` field in `package.json` is owned by Trinity, not Neo, even though Neo owns the npm scripts in the same file. It is release metadata set as part of cutting a build, and Trinity is the only agent permitted to commit. Neo was told not to touch it, so the two never write the same line.
- 2026-10-19 — Trinity, Neo and Morpheus do not all run in parallel this time. Trinity's version plumbing and Neo's build are independent and ran together; Morpheus starts only once the build is in the tree, because the shared-emulator contention that produced phantom failures in Phase II and H1 came from two agents driving the emulator at once.
- 2026-10-19 — A `data-testid` contract was fixed up front and handed to Neo and Morpheus in identical wording (`report-toggle-day`, `range-from`, `day-bar-<day>`, `open-day-<day>`, `export-days-csv` and the rest, plus the two the brief names, `login-version` and `app-version`). The existing screens carry almost no test ids and Morpheus writes tests from the brief rather than from Neo's markup, so without a shared contract the two would have converged on different selectors.
- 2026-10-19 — The Sales by day screen is a new module, `public/js/reports-days.js`, rather than a second mode inside `reports.js`. The two screens share aggregation through `logic.js` but almost no DOM, and Phases I–II of `reports.js` are live code this run must not disturb.
- 2026-10-19 — When `public/js/version.js` is missing the labels read `dev` in place of the version (`vdev` in the header pill, `Version dev` on the login card) rather than hiding the element. The brief says every label shows `dev` and nothing errors; a hidden element would make a missing build file invisible instead of obvious.
- 2026-10-19 — `public/js/version.example.js` is committed alongside the other two `*.example.js` files even though the app degrades to `dev` without the real file. The shape of every gitignored generated module is documented by a committed example here, and a missing example would be the odd one out when the next phase bumps the version. It holds the illustrative values from the brief (`a1b2c3d`), nothing environment-specific.
- 2026-10-19 — `APP_BUILD` gets a `-dirty` suffix locally when `git status --porcelain` is non-empty, and never in CI. Locally a label without it would claim a build matched a commit when the tree had uncommitted changes; on a runner the checkout is clean by definition and `GITHUB_SHA` is the commit actually deployed, so the check is pointless there and would only ever misfire.
- 2026-10-19 — If git cannot answer at all, `write-version.mjs` writes the file with `APP_BUILD = "unknown"` rather than failing. The version stamp is a label, not a gate; failing the step would block a Pages deploy over a cosmetic field.
- 2026-10-19 (Neo) — Every Phase III control carries **both** id sets: the orchestrator's contract (`report-toggle-day`, `quick-today`, `tile-total-sales`, `days-empty`, `export-days-csv`) and the list in `.claude/agents/neo.md`, which `.claude/agents/morpheus.md` names as the selector source (`report-view-day`, `range-today`, `range-kpi-sales`, `range-empty`, `range-export-csv`). The two lists disagree, the aliases cost one wrapper element each, and a wrong guess would have failed a whole suite.
- 2026-10-19 (Neo) — Money on the Sales by day screen is formatted with thousands separators (`£2,005.00`, `formatPenceGrouped`), matching the readout wording in the brief and `design/ReportsByDay.dc.html`. `formatPence` is unchanged and still used everywhere else; the two agree exactly below £1,000.
- 2026-10-19 (Neo) — Bar value labels use the exact amount and only round to whole pounds at £1,000 and above (`formatPenceCompact`). The mock-up always rounds, which would print "£15" over a £15.00 bar on a quiet day and hide the pence.
- 2026-10-19 (Neo) — The version pill and the login version line carry `role="note"`. `aria-label` on a bare `<span>`/`<p>` is a prohibited ARIA attribute (axe `aria-prohibited-attr`, serious), and the brief requires both `title` and `aria-label` on them.
- 2026-10-19 (Neo) — The "Open day" column header is the visible word "Open" rather than visually hidden text. A `.visually-hidden` span inside the 860px-wide table is absolutely positioned, escapes the card's horizontal scroller and put 409px of horizontal scroll on the whole page at 360px.
- 2026-10-19 (Neo) — A too-long range hides the totals tiles, chart and tables and shows only "Pick 31 days or fewer"; an empty range keeps the tiles and shows "No sales in this range". Stale figures next to an error read as if they answered the range that was asked for.
- 2026-10-19 (Neo) — `sha256Hex` and `normaliseUser` moved into `logic.js` (login.js re-exports `sha256Hex` unchanged) and `parseAmount` was added as an alias of `parseAmountToPence`, so every pure function the brief names by name lives in the unit-testable module.

## Phase III close-out

- 2026-10-19 — Phase III took one round of the fix loop, for two accessibility defects on the new screen rather than anything functional. BUG-6: every "Open day" button's `aria-label` started "Open the one day report for…", so the accessible name did not begin with the visible text (WCAG 2.5.3). BUG-7: the sideways-scrolling table cards took no keyboard focus. Both fixed in `reports-days.js` and re-verified.
- 2026-10-19 — BUG-7 was in Morpheus's round-P3 axe output all along, underneath BUG-6, and only BUG-6 was written up. It is recorded in `qa/bugs.md` as found by the suite and written up retrospectively rather than credited to the fix, so the bug log does not overstate what the first pass caught.
- 2026-10-19 — `P3-17` was added so neither defect can come back silently: it asserts accessible names contain their visible text and that anything which actually scrolls sideways is focusable and named, independently of the axe ruleset. An axe-only assertion would pass the day the rule changed.
- 2026-10-19 — The version tests assert the **shape** of the build string, `^[0-9a-f]{7}(-dirty)?|dev$`, never a literal SHA. `version.js` is regenerated at commit time and stamped again in CI, so a hardcoded value would fail on every build but the one it was written against.
- 2026-10-19 — Neo renamed the day section's `aria-label` from "Day by day table" to "Day by day" so it stayed distinct from the new scroll region's name. Checked against the brief rather than worked around: `CLAUDE.md` Phase III 7 fixes the visible heading, not the section's accessible name, and the mock-up gives the wrapper no name at all.
- 2026-10-19 — Trinity found `check-secrets.sh` had never implemented the literal `APP_LOGIN_PASSWORD` check the brief specifies, only credential-shaped patterns, and added it before committing. The first attempt used `\?` in a BSD `sed` basic regex, which matches nothing on macOS, so the extracted value was empty and the check silently passed everything. Rewritten with `grep -E` and tested in both directions against a dummy value. A guardrail that always passes is indistinguishable from one that works, which is why it was tested for failure as well as success.
- 2026-10-19 — The live check confirmed the rendered build string through the app's UI rather than by fetching `version.js`, with the HTTP cache disabled over CDP. Fetching the file would prove the deploy and not the labels, which are the thing Phase III actually ships.
- 2026-10-19 — Live `orders` still holds the single `A-001` smoke order from the H2 check, byte-identical, so the stall has not traded on v1.2.0. Left in place: this run authorises no writes to live Firestore, deletion included. Recorded as the first "Needs you" item instead.
- 2026-10-19 — `settings/event` does not exist live, so "This event" is hidden. That is the specified behaviour, not a defect, and the handover says how to switch it on without a deploy.

## Phase IV (Neo)

- 2026-10-19 (Neo) — The orders report keeps the day and the selected order in the hash (`#/reports/orders?day=…&order=…`), so selecting an order is a real history entry and the phone's Back button walks from the detail to the list without a DOM toggle. `app.js` gained one hook for it: a screen may register `onQueryChange`, and the router then hands it a query-only hash change instead of tearing the screen down and resubscribing. Nothing else changes for the other screens.
- 2026-10-19 (Neo) — The table (tablet) and the cards (phone) are never both in the page: `render()` builds one or the other from `matchMedia('(max-width: 699px)')` and rebuilds on a width change. Rendering both and hiding one with CSS leaves `orders-row-*` in the DOM on a phone, where it can be found but never clicked.
- 2026-10-19 (Neo) — `exportOrdersCsv` is its own function over the filtered rows, in the order they are listed (newest first), **including cancelled orders**, with the same thirteen columns as the One day export built from the shared row builder. CLAUDE.md Phase IV 8 exports "the orders currently shown (after filters)" and cancelled orders are shown, so filtering Status to Cancelled and exporting must not hand back a header row and nothing else; the `status` column is what says a row was cancelled. `ordersToCsv`, and with it the One day and Sales by day exports, still leave cancelled orders out. (First built as an alias of `ordersToCsv`; corrected by the orchestrator during the Phase IV build.)
- 2026-10-19 (Neo) — The phone detail drops the Price column, matching `design/ReportsOrdersMobile.dc.html`: icon, quantity, name and line total only. The tablet detail keeps Price. (Shipped the other way first; corrected by the orchestrator.)
- 2026-10-19 (Neo) — The summary line always reads "<n> orders", singular included ("1 orders"), as the contract and `design/ReportsOrders.dc.html` both write it. Grammatical agreement here would mean the line no longer matches the brief's literal wording.
- 2026-10-19 (Neo) — Retired ids show under the menu's `short` name ("Sweets Box", "Choc Strawberry") in the Items column and under the name stored on the order line in the detail and the CSV, so an old order reads under its original wording in every place it appears.
- 2026-10-19 (Neo) — The middle nav pill reads "Sales by day" at 700px and wider and "By day" below, swapped in script on a media-query change rather than with two spans. Two spans would leave both labels in the pill's `textContent` and make any text assertion on it read "Sales by dayBy day".
- 2026-10-19 (Neo) — The phone order card carries no `aria-label`, against the DOM contract's `"View order <no>, <name>"`. An aria-label on a button whose own text runs to four lines fails WCAG 2.5.3 and axe flags it `label-content-name-mismatch` (serious), the same defect class as BUG-6. A visually-hidden "View order" inside the button gives the accessible name "View order A-041 Priya Collected …", which keeps the wording and the visible text. The tablet Order button keeps its `aria-label="View order <no>"`: there the visible text is the order number, so it passes.
- 2026-10-19 (orchestrator) — The Phase IV test ids follow `.claude/agents/neo.md` where it and the build-time DOM contract disagree (`order-row-`, `order-open-`, `order-back`, `orders-export-csv`), because the agent brief is the user's own spec and predates the contract. Neo emits both spellings everywhere a node can carry two, and Morpheus's helpers resolve either, so the disagreement costs nothing and needs no rework. The one exception is `order-row-<no>`: a `<tr>` carries a single test id and it ships as `orders-row-<no>`.
- 2026-10-19 (orchestrator) — Morpheus's Phase IV CSV cases were asserting against `ordersToCsv`, which the Orders screen never calls, so the export path the Export button actually uses had no coverage at all and Neo's change to it was invisible to the whole suite. The cases now run through `exportOrdersCsv`, one case stays on `ordersToCsv` pinning the One day and Sales by day exports to excluding cancelled, and `P4-14` asserts the real download with Status filtered to Cancelled contains a data row rather than a bare header. A test green against a function nobody calls is worse than no test, because it reads as coverage.
