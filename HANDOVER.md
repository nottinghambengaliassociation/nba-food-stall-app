# Charity Food Stall POS — handover

Phase I prototype built 17 October 2026; shared login, sign out and the Cash received calculator added 18 October 2026; hotfix H1 splitting the menu into eight items and hotfix H2 aligning the cart lines shipped 19 October 2026; the Sales by day report and the app version label shipped 19 October 2026 as **v1.2.0**; the Orders list and order detail shipped 19 October 2026 as **v1.3.0**. Live, tested and deployed.

**Live site: https://nottinghambengaliassociation.github.io/nba-food-stall-app/**

| Screen | URL | Who uses it |
|---|---|---|
| Sign in | [`#/login`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/login) | Everyone, once per device |
| Landing (pick a screen, set till letter) | [`/`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/) | Everyone |
| Cash counter | [`#/cash`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/cash) | Till volunteer |
| Food counter | [`#/kitchen`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/kitchen) | Food counter volunteers |
| Reports, one day | [`#/reports`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/reports) | Organisers |
| Reports, sales by day | [`#/reports/days`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/reports/days) | Organisers |
| Reports, orders | [`#/reports/orders`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/reports/orders) | Organisers |

Repo: https://github.com/nottinghambengaliassociation/nba-food-stall-app
Firebase project: `nba-food-stall-9fec6`, Firestore `(default)` in `europe-west2` (London).

---

## Setting up on the day

Everything is a web page. There is nothing to install, no login, and no app store.

**Before you leave the house.** Open the live site once on every device you plan to use, while you still have good wi-fi. That caches the app and lets Firestore set up its local store, so the stall works even if the venue signal is poor.

**Sign in, once per device.** Every screen is behind one shared login. Open the site, enter the username and password, and that device stays signed in until somebody taps Sign out. There is no timeout, so a refresh, a flat battery or a dropped signal will not throw a volunteer back to the login screen mid-service. Get the credentials from the stall lead; they are not written down in this repo.

Sign in on each device **before** you leave for the venue, so nobody is typing a password on a phone in a noisy hall.

**A till (tablet or phone).**

1. Open the live site and sign in.
2. On the landing page, set the **till letter**. First till is `A`, second is `B`, and so on. Every till must have a different letter, otherwise two orders can end up as the same number.
3. Tap **Cash counter**.
4. Add it to the home screen and run it full screen if you can, so nobody closes the tab by accident. On iPad, Share → Add to Home Screen. On Android, the browser menu → Add to Home screen.

The till letter is remembered on that device. If you reload, you stay on the same letter and the same number sequence.

**The order number counter lives on the device, not in the database.** Clearing the orders in Firestore does not reset it. A tablet that served yesterday and reached A-003 will carry on at A-004 today, even against an empty database. That is deliberate, since it is what lets the till keep numbering with no signal. If you want a device to start again at 001, clear its browser data for the site, which also signs it out.

**A food counter screen (tablet or phone).**

1. Open the live site, sign in, tap **Food counter**.
2. On a tablet you get three columns: New, Preparing, Ready. On a phone you get tabs with counts.
3. Use the station filter if one person is only on chaat, momo or sweets. Lines for other stations stay visible but greyed, so you can still see the whole order.
4. The beep on a new order is toggled in the header. Turn the volume up: it is the only thing that will get attention in a noisy hall.
5. Keep the device plugged in. The app asks to keep the screen awake, but a tablet on battery saver may ignore that.

**Organisers.** Open **Reports** on a phone whenever you want the running totals. Export CSV at the end of the day, before anyone closes their browser.

**Two things to tell the volunteers.**

Order numbers are generated on the device, so the till never waits for the network. A till can keep taking orders with no signal at all: the connection pill shows "Offline · N queued" and everything syncs when the signal returns. The food counter will not see those orders until the till reconnects, so if the signal is bad, keep the till and the food counter on the same hotspot.

Prices are read from Firestore, not hard-coded. To change one, edit it in the Firebase console under the `menu` collection. Prices are stored in **pence** (`500` is £5.00).

---

## What it does

Eight menu items at £5 each: Fuchka, Momo, Papri Chat, Sweet Box, Samosa, Choc Strawberry, Marshmallow and Choc Fountain. They are seeded automatically on first load if the `menu` collection is empty.

Hotfix H1 split two previously combined items into four, so "Sweets Box Samosa / Shingara" became Sweet Box and Samosa, and "Chocolate Strawberry & Marshmallow (V)" became Choc Strawberry and Marshmallow. The two old items are retired rather than deleted: they stay in the menu as inactive, so they never appear as tiles but orders taken before the split still report under the names they were sold as. **Never reuse a retired id.**

The till builds an order, takes a name to call out, takes cash or card, and sends it. With Cash selected there is an optional **Cash received** calculator: tap Exact, £5, £10, £20 or £50, or type any amount, and it shows the change to give, or how much the order is short by. It is a calculator for the volunteer and nothing more, so it never blocks sending and nothing about it is saved. The order gets a number like `A-043` (till letter plus a daily sequence) and appears on the food counter instantly. Volunteers move it New → Preparing → Ready → Collected with one big button, with an undo for mis-taps. Ready orders show the name in large capitals for calling out. Cards turn amber once an order is six minutes old.

Reports give total sales, order count, items sold, average order, average wait, sales per item, orders per 30 minutes with the peak highlighted, the cash-versus-card split, and a CSV export with one row per order line. Cancelled orders are excluded from every figure.

There are three report screens now, with a toggle at the top of each. **One day** is the screen above. **Sales by day** covers a range of dates: pick From and To, or tap Today, Last 7 days or This event, and it shows the totals across the range, a bar chart of sales per day with the best day picked out, a day-by-day table with an Open day button that jumps straight to that day's one-day report, and a grid of every menu item against every day with each item's best day shaded. Only days that actually traded appear. The range is capped at 31 days. Its CSV export covers every order line in the range, the same columns as the one-day export, named `nba-food-stall_<from>_<to>.csv`.

**Orders** lists a single day's orders one by one, which is the screen to open when somebody is standing in front of you asking what was in order A-041. Pick a day, search by order number or by name, and narrow by status or by how it was paid. Tap an order and you get everything about it: till, payment, when it was placed, how long it waited, the full Placed → Started → Ready → Collected timeline with the actual times, and every item with its quantity and price. On a phone the order opens full screen and the usual Back button returns you to the list. It updates itself live, so an order taken at the till appears while the screen is open. It is read-only: nothing on it changes an order, which makes it safe to hand to anyone who needs to look something up. Cancelled orders are listed, so you can see that an order existed and was cancelled, but they are left out of the total. Its CSV export covers whatever the filters are currently showing, named `nba-food-stall_orders_<day>.csv`, and that one does include the cancelled rows, with `cancelled` in the status column.

Every screen now shows the app version. The login card carries a line reading `Version 1.3.0 · build <7 characters> · updated <date>`, and every dark header carries a `v1.3.0` pill. The version is the release, so it only moves when a phase or a hotfix ships; the build is the exact commit the site was published from, so it changes on every deploy, documentation included. If a volunteer reports something odd, ask them what their screen says: the version tells you whether they are on a stale tab.

---

## What changed

Newest first. The app updates itself when a device loads it, but a till left open on a screen keeps the version it started with.

**19 October 2026, v1.3.0 — the Orders screen.** Organisers get a third report screen, **Orders**, reached from the One day / Sales by day / Orders toggle at the top of any report. It lists a single day's orders one at a time rather than totalling them, so when a customer asks what was in order A-041 you can answer. Search by order number or name, narrow by status or payment, tap an order for its till, payment, timeline with real times, and every item with quantity and price. On a phone it opens full screen and the Back button returns to the list. It updates live, so an order taken at the till appears while the screen is open.

It is read-only. Nothing on that screen changes an order: cancelling still happens at the cash counter and status changes still happen at the food counter, which makes Orders safe to hand to anyone who needs to look something up mid-service. Cancelled orders are listed so you can see they existed, but they are left out of the total. Its CSV covers whatever the filters are showing and, unlike the other two exports, includes the cancelled rows with `cancelled` in the status column, so filtering to Cancelled and exporting gives you something rather than an empty file.

Nothing changed about how orders are stored, so there is nothing to do on any till beyond refreshing. Every screen now reads `v1.3.0`.

**19 October 2026, v1.2.0 — Sales by day report, and the version on every screen.** Organisers get a second report screen, **Sales by day**, reached from the One day / Sales by day toggle at the top of either report. It covers a range of dates rather than one: totals across the range, a chart of sales per day with the best day picked out, a day-by-day table that can open any single day's report, and a grid of every item against every day. Only trading days appear and the range is capped at 31 days. It reads existing orders and changes nothing about how they are stored, so there is nothing to do on any till. Every screen also shows the app version now, on the login card and as a pill in each dark header, so you can tell at a glance whether a device is on the current build.

**19 October 2026, hotfix H2 — cart lines line up.** On the cash counter the `−` and `+` buttons used to sit at a different spot on every row, because each row was sized by the length of its item name. They now sit in fixed columns, so the whole column lines up and the long names wrap instead of shoving the buttons sideways. Cosmetic only, nothing about how orders work has changed.

**19 October 2026, hotfix H1 — menu split into eight.** "Sweets Box Samosa / Shingara" became Sweet Box and Samosa; "Chocolate Strawberry & Marshmallow (V)" became Choc Strawberry and Marshmallow. Orders taken before the split still report under the names they were sold as.

**18 October 2026 — login, sign out and the Cash received calculator.** One shared login in front of every screen, and an optional change calculator on the cash counter.

**Tell volunteers to refresh any till that is already open.** A device sitting on the cash counter screen keeps the stylesheet it loaded with, and the site caches it for ten minutes, so a till that loaded recently can still show the old layout even though the server is serving the new one. Pull down to refresh, or close and reopen the tab. Worth doing on every device before service rather than discovering it mid-queue.

## Test results

Phase I took two rounds of the fix loop, Phase II one, hotfixes H1 and H2 none, and Phase III one, for a pair of accessibility defects on the new Sales by day screen, both fixed and re-verified. Phase IV took none against the app: the only thing the loop caught was the version bump, and four first-round failures that turned out to be defects in the new tests rather than in the screen. Final numbers come from a clean run with nothing else driving the emulator, which matters: two earlier rounds were muddied by two agents sharing one Firestore emulator and clearing each other's data mid-test.

| Suite | Tests | Passed | Failed |
|---|---|---|---|
| Unit (Vitest) | 307 | 307 | 0 |
| E2E, phone 390×844 and tablet 1280×800 (Playwright) | 286 | 286 | 0 |
| Live checks, Phase IV (against the deployed site) | 23 | 23 | 0 |
| **Total** | **616** | **616** | **0** |

A further 62 e2e cases are skipped by design rather than failing: the viewport-gated ones that only make sense at one width, and the live-gated ones that only run against the deployed site when their environment flag is set.

Also clean: zero axe accessibility violations on all seven routes at both sizes, zero console errors, no horizontal scroll at 360px, and every interactive control at or above the 48px minimum (re-measured independently at 390, 360 and 1280 wide).

- Test plan: [`qa/test-plan.md`](qa/test-plan.md)
- Bug log with the final status of every bug: [`qa/bugs.md`](qa/bugs.md)
- Screenshots: every screen at both sizes including the login screen and its error state, plus the live-site captures: [`qa/screenshots/`](qa/screenshots/)
- Playwright HTML report: `playwright-report/index.html` (local only, not committed — regenerate with `npm test`)

To run the tests yourself: `npm install`, then `npm test`. Needs Java 21 for the Firestore emulator.

### Live smoke test

Run against the deployed site, not the emulator, after each phase.

**Phase IV (19 October 2026), 23 checks passed, 0 failed, read-only.** On the deployed build `064f0a8` at both viewports, with zero console errors: all seven routes load signed in and all six guarded ones bounce to the login screen signed out; the three report tabs read `One day | Sales by day | Orders` on a tablet and `One day | By day | Orders` on a phone; the Orders screen renders the live order with every field correct, filters by status, by payment and by search in either case, opens the detail with its full timeline and all eight item lines, and on a phone returns from the full-screen detail by both the "All orders" button and the browser Back button.

Two of these were checked the hard way rather than the convenient way. The CSV was downloaded and parsed, not inferred from a 200: thirteen columns, eight data rows, every `lineTotal` equal to `qty × price`, the rows summing to the stored total. And the version labels were read through the rendered UI with the HTTP cache disabled, never by fetching `version.js` — fetching the file proves the deploy happened and says nothing about the labels, which are the thing being checked.

**Nothing was written.** The run is bracketed by a before-and-after fingerprint: `orders` still holds its single document, byte-identical, and `menu` still holds the same ten ids. Every Firestore call in the spec is a REST GET, no tile was tapped and Send was never clicked.

**Phase II (18 October 2026), 15 checks passed, 0 failed.** On both a phone and a tablet viewport, with **zero console errors** anywhere: the login screen renders the form rather than "Login not configured", so the CI secret step worked; `#/cash`, `#/kitchen` and `#/reports` all redirect to `#/login` with no session; a wrong password shows the error and creates no session; the real credentials sign in and land on `#/`; all four working routes load signed in with the pill reading `Online · synced`; and Sign out clears the session while preserving the till letter.

The assertion worth having is this one. A `QA-SMOKE` order was sent on the live site with £20 keyed into Cash received against a £5.00 cash order, and the document written to the real Firestore contains **neither `tendered` nor `changeGiven`** — the fields are absent, not null. The older orders in the same collection all carry `tendered`, so the contrast proves the change actually shipped rather than merely passing in the emulator.

A second `QA-SMOKE` order was cancelled, and live Reports then read one order and £5.00, confirming cancellations are still excluded.

**Hotfix H2 (19 October 2026), read-only.** The cart alignment was re-checked on the deployed site at both viewports with all eight items in the cart, including reading the deployed stylesheet's computed layout rather than trusting a 200 response, since a stale cache would look healthy and still serve the old layout. No order was placed and nothing was written.

**Hotfix H1 (19 October 2026), 14 checks passed, 0 failed, read-only.** On the deployed site at both viewports: the till shows exactly eight tiles in sort order with neither retired item appearing; the eighth tile is reachable and tappable with the order bar at its tallest, verified by a coordinate click that moved the quantity badge; and Reports for 2026-10-18 renders the pre-split orders under their original names, "Sweets Box Samosa / Shingara" and "Chocolate Strawberry & Marshmallow (V)", with the CSV carrying the same. KPIs read £30.00, 3 orders, 6 items, matching the stored documents exactly. Nothing was written: `orders` and `menu` were byte-identical before and after.

**Phase I (17 October 2026).** All four routes loaded on both viewports with zero console errors and no "Storage not configured" banner. An order was taken through to Collected and a second cancelled, with Reports excluding the cancellation.

All test orders from both phases have been deleted, along with earlier hand-testing data: seven documents in total, removed by exact document id. The `orders` collection is empty and ready for the event, and the six `menu` documents are intact. Evidence: the `live-*` screenshots in [`qa/screenshots/`](qa/screenshots/) and the run log at [`qa/live-smoke-record.txt`](qa/live-smoke-record.txt).

**The live menu is seeded and must be left alone.** The project was empty before the first smoke test, so the first load wrote the six menu documents. That is the real menu: prices are editable in the Firebase console, the seed only ever runs when `menu` is empty, and volunteers will not see a seed happen on the day.

### Bugs found and fixed

Six across all phases, all closed.

Phase IV found one, and it was the version bump rather than anything on the new screen: the app was built and tested at `1.2.0`, so every header pill and the login card would have gone live reading the previous version. The existing version suite could not catch it, because it reads the expected value from `package.json` itself and so agreed with the mistake. A case that asserts the Phase IV version as a literal was added, which is what failed, and it passed once the bump landed.

Phase II found one real bug: the Cash received figure survived emptying the order panel, so a fresh order opened showing a stale "Change to give" from the previous customer. Fixed and re-verified at both sizes. A second was withdrawn rather than fixed, because the requirement changed underneath it.

From Phase I, three, all verified closed.

The serious one was the cash counter on a phone. The order panel collapsed in on itself: the total painted over the line items and the `+` button on a line could not be tapped at all. A volunteer on a phone could not have corrected a quantity. The cause was a flex layout where rows defaulted to shrinking, plus a sticky Send button overlaying the tender row from inside the scroller. Fixed in CSS, then re-verified by checking that a tap at the centre of the `+` button actually reaches the button rather than by trusting the test to go green.

The other two: selecting Card still showed the cash tender buttons, and the Cancel pill in the recent-orders strip measured under the 48px touch minimum.

---

## Known issues and Phase I limits

**The login is a gate, not security.** It keeps passing volunteers out of the app; it does not protect the data. The password is checked in the browser against an unsalted SHA-256 that ships with the page, so anyone determined can work backwards from it if the password is weak or reused elsewhere. Pick something used nowhere else, and treat the login as a "staff only" sign on a door rather than a lock.

**Everyone shares one account.** There is no per-volunteer identity, so the order log cannot tell you who took which order, and when somebody leaves the team the only way to cut their access is to change the shared password on every device. Rotating it is a five-minute job, described at the end of this file.

**The database is still wide open.** `firestore.rules` is `allow read, write: if true;`, and the login does not change that: anyone with the site URL can read every order, write to the database, and delete the lot, including the menu, without ever signing in. That was the explicit Phase I decision and it is a reasonable trade for a one-day charity stall, but do not post the URL publicly, and it must change before this is reused.

**Order numbers collide if two devices share a till letter.** This is not theoretical: three of the orders cleared from the live database were all numbered `A-001`, created on three devices that had each been left on till A, each counting from 001 independently. In service that means calling "A-001" and two customers stepping forward. The sequence lives in the device's `localStorage`, which is what makes the till work offline. Give each device its own letter on the landing page and check it before service starts.

**Clearing browser data on a till resets its sequence.** The next order starts again at `001`. Orders already sent are safe in Firestore; only the numbering restarts.

**The food counter only sees orders that have synced.** An offline till holds its orders locally until it reconnects. Expected behaviour, but worth knowing if you are debugging a "missing" order.

**Cash received is not recorded.** It is a calculator for the volunteer at the till, so the amount handed over and the change given are not saved to the order and are not in the CSV. If you want to reconcile the cash tin at the end of the day, the CSV tells you what each cash order *should* have taken, not what was actually handed over.

**Prices are edited in the Firebase console, not in the app.** There is no price-editing screen in Phase I.

**Multi-day reporting is capped at 31 days** on the Sales by day screen. For longer periods, export each range's CSV and combine them in Google Sheets.

**The Orders screen covers one day at a time.** There is no way to list orders across a date range; use Sales by day for that and open a single day from it.

**The Orders CSV button appears on a phone, although the phone mock-up does not show one.** It works, and it is the export an organiser checking Reports on a phone would want, so it was kept rather than removed to match the drawing. It is the one Phase IV control the automated checks skip on a phone.

**A fresh clone may fail to push** if the machine's keychain holds a different GitHub account. The fix is one repo-local command, in the note at the end of this file.

---

## Needs you

**1. Delete the leftover QA order before the next service.** Live `orders` holds one document, `A-001` on 19 October 2026, £40.00, collected, eight lines of one each. It is the smoke-test order from an earlier check, not a real sale, and the stall has not traded since. Left in place it adds £40.00 and eight items to that day in both reports. Delete that one document in the Firebase console, or subtract it when you read the figures. The live check is read-only by design, so QA did not remove it.

**2. Create `settings/event` if you want the "This event" button.** It does not exist, so the quick button is hidden, which is the specified behaviour rather than a fault. To switch it on, add a document `settings/event` in the Firebase console with `name`, `from` and `to`, the dates as `YYYY-MM-DD` strings. The button appears the next time the screen loads. No deploy needed.

**3. Restrict the Firebase browser API key to the site. Not blocking, worth doing.**

`gcloud` is not installed on the build machine, so this could not be automated.

Go to console.cloud.google.com → APIs & Services → Credentials → project `nba-food-stall-9fec6` → "Browser key (auto created by Firebase)" → Application restrictions → HTTP referrers, and add:

```
https://nottinghambengaliassociation.github.io/*
http://localhost:5173/*
http://127.0.0.1:5173/*
```

For context, a Firebase web API key always ends up in the browser of a deployed web app. That is how every Firebase web app works: the key identifies the project, it is not a password. Keeping it out of the GitHub repo was still the rule here and that rule held. Restricting it by referrer is the extra step.

**4. Tighten the Firestore rules before this is reused.** The rules are `allow read, write: if true`, so the public API key plus the project id is enough for anyone to read or wipe the whole database. Fine for one day with an unadvertised URL, not fine for anything ongoing. If the stall runs again, this is the first thing to fix.

**5. Choose a shared password that is used nowhere else, and tell the volunteers it verbally.** The hash ships in the browser, so a weak or reused password is the weak point. Do not put it in a WhatsApp group that outlives the event.

**6. Sign the Firebase CLI back in on this Mac, if you want console-free access.** The credentials expired during the build, so `firebase` commands against the real project fail. Nothing currently depends on it: the site is deployed, the database is in its correct starting state, and the Pages workflow uses Actions secrets rather than this login. To restore it: `firebase login --reauth`, then `firebase projects:list` to confirm.

**7. Close the screenshot gap in the secret scanner, before the next phase rather than after it.**

`scripts/check-secrets.sh` skips binary files by design, so the QA screenshots have never been scanned by it — not in this release and not in any earlier one. The scanner reporting clean over 93 text files says nothing at all about the 20 PNGs committed alongside them.

Nothing has leaked. Every capture that renders the login form was opened and checked by hand for this release: the Username and Password fields are empty in all of them, the signed-out shots are taken after the session is cleared, and no screen in the app renders the signed-in username anywhere, so no signed-in capture can carry it either. The PNG metadata chunks are clean.

The problem is that this currently rests on QA's capture discipline plus somebody remembering to look. If a future run ever photographs a filled login form, or a new screen starts showing who is signed in, no automated check would catch it. Either write the rule down so the next run inherits it, or add a cheap check that fails when a `*login*` screenshot's field region is not blank.

**8. Decide what happens to the data after the event.** Export the CSV from the Reports screen, then decide whether the orders stay in Firestore or get cleared.

---

## How it is put together

No build step. Plain HTML, CSS and ES modules in `public/`, served as-is by GitHub Pages. Firebase modular SDK 13.0.0 loaded from gstatic.

All pure logic — money, order numbers, the day string, report aggregation, CSV — lives in `public/js/logic.js` with no Firebase imports, which is why it unit-tests directly. `public/js/store.js` is the only module that touches Firebase.

Running locally: `npm run serve` serves on `127.0.0.1:5173` and automatically uses the Firestore emulator (`demo-food-stall`, port 8080), so local work never touches live data. Add `?live=1` to use the real project from localhost.

### Secrets

No keys are in the repo. `public/js/firebase-config.js` and `public/js/login-config.js` are both generated and gitignored; only the two `*-config.example.js` files with placeholders are committed. The GitHub Actions workflow writes the real files from eight repository secrets just before publishing: six `FIREBASE_*`, plus `APP_LOGIN_USER` and `APP_LOGIN_PASSWORD_SHA256`.

The plain login password never leaves this Mac. It lives in `.secrets/app-login.env`, which is gitignored; `scripts/write-login-config.mjs` hashes it in process, and only the SHA-256 is stored as a GitHub secret or shipped to the browser. Tests read the credentials from that same file at run time, so no username or password appears in any test, fixture, screenshot or document in this repo. A unit test fails the build if either value ever does.

Guardrails in place: `.gitignore`, a version-controlled pre-commit hook (`scripts/check-secrets.sh`, installed via `core.hooksPath`) that blocks API keys, service-account keys, GitHub tokens and PEM blocks, a unit test that fails if any tracked file contains an API key, and GitHub secret scanning with push protection enabled. Post-push audit of `git log -p --all` found zero credential matches and secret scanning reports zero alerts.

### Changing the menu

Prices and names are edited in the Firebase console, under the `menu` collection. Prices are in pence, so `500` is £5.00.

To retire an item, set `active: false` rather than deleting it. Deleting it would break how past orders report, because orders store the item id and fall back to the menu for the name. **Never reuse a retired id** for a new item, or old orders will silently start reporting as the new thing.

`scripts/menu-sync.mjs` reconciles the live menu with the table in `CLAUDE.md`. It only ever creates missing documents and applies a short whitelist of known changes; it never deletes, and it refuses to overwrite any field that already holds a different value, reporting the difference instead. Run `node scripts/menu-sync.mjs --dry-run` to see the plan, then without the flag to apply it. It is idempotent, so a second run does nothing.

It will keep reporting two differences on every run: the retired `samosa` and `straw` documents have `sort` 4 and 5 while the brief's table says 90 and 91. That is the script correctly refusing to overwrite, not a fault. Sort only affects the ordering of tiles and both are inactive, so it has no visible effect. If you want the message to stop, set those two sort values in the console.

### Changing the shared password

1. Edit `APP_LOGIN_PASSWORD` in `.secrets/app-login.env`.
2. `node scripts/write-login-config.mjs` to regenerate the local config.
3. Write the username and the new hash to a gitignored file and `gh secret set -f` it, then delete the file. Never pass a password or hash on the command line.
4. Push any commit to `main` to redeploy.
5. Every device stays signed in on the old session until it signs out, so tell volunteers to sign out and back in if you are rotating because somebody left.

### Deploying a change

Push to `main`. The Pages workflow rebuilds and redeploys automatically. Watch it with `gh run watch`.

If `git push` returns 403 because your keychain holds a different GitHub account, set a repo-local credential helper rather than a global one:

```
git config --local credential.https://github.com.helper ""
git config --local --add credential.https://github.com.helper "!gh auth git-credential"
```
