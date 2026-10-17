# Charity Food Stall POS — handover

Phase I prototype, built 17 October 2026. Live, tested and deployed.

**Live site: https://nottinghambengaliassociation.github.io/nba-food-stall-app/**

| Screen | URL | Who uses it |
|---|---|---|
| Landing (pick a screen, set till letter) | [`/`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/) | Everyone |
| Cash counter | [`#/cash`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/cash) | Till volunteer |
| Food counter | [`#/kitchen`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/kitchen) | Food counter volunteers |
| Reports | [`#/reports`](https://nottinghambengaliassociation.github.io/nba-food-stall-app/#/reports) | Organisers |

Repo: https://github.com/nottinghambengaliassociation/nba-food-stall-app
Firebase project: `nba-food-stall-9fec6`, Firestore `(default)` in `europe-west2` (London).

---

## Setting up on the day

Everything is a web page. There is nothing to install, no login, and no app store.

**Before you leave the house.** Open the live site once on every device you plan to use, while you still have good wi-fi. That caches the app and lets Firestore set up its local store, so the stall works even if the venue signal is poor.

**A till (tablet or phone).**

1. Open the live site.
2. On the landing page, set the **till letter**. First till is `A`, second is `B`, and so on. Every till must have a different letter, otherwise two orders can end up as the same number.
3. Tap **Cash counter**.
4. Add it to the home screen and run it full screen if you can, so nobody closes the tab by accident. On iPad, Share → Add to Home Screen. On Android, the browser menu → Add to Home screen.

The till letter is remembered on that device. If you reload, you stay on the same letter and the same number sequence.

**A food counter screen (tablet or phone).**

1. Open the live site, tap **Food counter**.
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

Six menu items at £5 each, seeded automatically on first load if the `menu` collection is empty.

The till builds an order, takes a name to call out, takes cash or card, and sends it. Cash shows quick tender buttons and works out the change. The order gets a number like `A-043` (till letter plus a daily sequence) and appears on the food counter instantly. Volunteers move it New → Preparing → Ready → Collected with one big button, with an undo for mis-taps. Ready orders show the name in large capitals for calling out. Cards turn amber once an order is six minutes old.

Reports give total sales, order count, items sold, average order, average wait, sales per item, orders per 30 minutes with the peak highlighted, the cash-versus-card split, and a CSV export with one row per order line. Cancelled orders are excluded from every figure.

---

## Test results

Two rounds of the fix loop, out of a maximum of five. Final run green.

| Suite | Tests | Passed | Failed |
|---|---|---|---|
| Unit (Vitest) | 85 | 85 | 0 |
| E2E phone 390×844 (Playwright) | 58 | 58 | 0 |
| E2E tablet 1280×800 (Playwright) | 58 | 58 | 0 |
| **Total** | **201** | **201** | **0** |

Also clean: zero axe accessibility violations on all four routes at both sizes, zero console errors, no horizontal scroll at 360px, and every interactive control at or above the 48px minimum (re-measured independently at 390, 360 and 1280 wide).

- Test plan: [`qa/test-plan.md`](qa/test-plan.md)
- Bug log with the final status of every bug: [`qa/bugs.md`](qa/bugs.md)
- Screenshots, 30 of them: every screen at both sizes, empty and with orders, plus 14 from the live site: [`qa/screenshots/`](qa/screenshots/)
- Playwright HTML report: `playwright-report/index.html` (local only, not committed — regenerate with `npm test`)

To run the tests yourself: `npm install`, then `npm test`. Needs Java 21 for the Firestore emulator.

### Live smoke test

Run against the deployed site, not the emulator. All four routes loaded on both a phone and a tablet viewport with **zero console errors**, no "Storage not configured" banner, and the connection pill reading `Online · synced`.

A real order named `QA-SMOKE` was taken through Start → Ready → Collected, and a second `QA-SMOKE` order was cancelled from the recent strip. Reports then read one order and £5.00 with the subtitle "excludes 1 cancelled", confirming the cancellation is excluded from the figures. Both test orders have since been deleted from the live project.

Evidence: 14 `live-*` screenshots in [`qa/screenshots/`](qa/screenshots/) and a run log at [`qa/live-smoke-record.txt`](qa/live-smoke-record.txt).

**The live menu is now seeded.** The Firebase project was completely empty before the smoke test, so the first load wrote the six menu documents. That is the real menu and it should be left alone: prices are editable in the Firebase console from here, the seed only ever runs when `menu` is empty, and volunteers will not see a seed happen on the day.

### Bugs found and fixed

Three, all verified closed.

The serious one was the cash counter on a phone. The order panel collapsed in on itself: the total painted over the line items and the `+` button on a line could not be tapped at all. A volunteer on a phone could not have corrected a quantity. The cause was a flex layout where rows defaulted to shrinking, plus a sticky Send button overlaying the tender row from inside the scroller. Fixed in CSS, then re-verified by checking that a tap at the centre of the `+` button actually reaches the button rather than by trusting the test to go green.

The other two: selecting Card still showed the cash tender buttons, and the Cancel pill in the recent-orders strip measured under the 48px touch minimum.

---

## Known issues and Phase I limits

**No login, and the database is wide open.** `firestore.rules` is `allow read, write: if true;`. Anyone with the site URL can read every order, write to the database, and delete the lot, including the menu. That was the explicit Phase I decision and it is a reasonable trade for a one-day charity stall, but do not post the URL publicly, and it must change before this is reused.

**Order numbers can collide if two tills share a letter.** The sequence lives in the device's `localStorage`, which is what makes the till work offline. Give each till a different letter and check it before service starts.

**Clearing browser data on a till resets its sequence.** The next order starts again at `001`. Orders already sent are safe in Firestore; only the numbering restarts.

**The food counter only sees orders that have synced.** An offline till holds its orders locally until it reconnects. Expected behaviour, but worth knowing if you are debugging a "missing" order.

**Prices are edited in the Firebase console, not in the app.** There is no price-editing screen in Phase I.

**Reports cover one day at a time.** There is no date range, and no multi-day totals.

**A fresh clone may fail to push** if the machine's keychain holds a different GitHub account. The fix is one repo-local command, in the note at the end of this file.

---

## Needs you

**1. Restrict the Firebase browser API key to the site. Not blocking, worth doing.**

`gcloud` is not installed on the build machine, so this could not be automated.

Go to console.cloud.google.com → APIs & Services → Credentials → project `nba-food-stall-9fec6` → "Browser key (auto created by Firebase)" → Application restrictions → HTTP referrers, and add:

```
https://nottinghambengaliassociation.github.io/*
http://localhost:5173/*
http://127.0.0.1:5173/*
```

For context, a Firebase web API key always ends up in the browser of a deployed web app. That is how every Firebase web app works: the key identifies the project, it is not a password. Keeping it out of the GitHub repo was still the rule here and that rule held. Restricting it by referrer is the extra step.

**2. Tighten the Firestore rules before this is reused.** The rules are `allow read, write: if true`, so the public API key plus the project id is enough for anyone to read or wipe the whole database. Fine for one day with an unadvertised URL, not fine for anything ongoing. If the stall runs again, this is the first thing to fix.

**3. Decide what happens to the data after the event.** Export the CSV from the Reports screen, then decide whether the orders stay in Firestore or get cleared.

---

## How it is put together

No build step. Plain HTML, CSS and ES modules in `public/`, served as-is by GitHub Pages. Firebase modular SDK 13.0.0 loaded from gstatic.

All pure logic — money, order numbers, the day string, report aggregation, CSV — lives in `public/js/logic.js` with no Firebase imports, which is why it unit-tests directly. `public/js/store.js` is the only module that touches Firebase.

Running locally: `npm run serve` serves on `127.0.0.1:5173` and automatically uses the Firestore emulator (`demo-food-stall`, port 8080), so local work never touches live data. Add `?live=1` to use the real project from localhost.

### Secrets

No keys are in the repo. `public/js/firebase-config.js` is generated and gitignored; only `firebase-config.example.js` with placeholders is committed. The GitHub Actions workflow writes the real config from six `FIREBASE_*` repository secrets just before publishing.

Guardrails in place: `.gitignore`, a version-controlled pre-commit hook (`scripts/check-secrets.sh`, installed via `core.hooksPath`) that blocks API keys, service-account keys, GitHub tokens and PEM blocks, a unit test that fails if any tracked file contains an API key, and GitHub secret scanning with push protection enabled. Post-push audit of `git log -p --all` found zero credential matches and secret scanning reports zero alerts.

### Deploying a change

Push to `main`. The Pages workflow rebuilds and redeploys automatically. Watch it with `gh run watch`.

If `git push` returns 403 because your keychain holds a different GitHub account, set a repo-local credential helper rather than a global one:

```
git config --local credential.https://github.com.helper ""
git config --local --add credential.https://github.com.helper "!gh auth git-credential"
```
