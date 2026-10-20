# Charity Food Stall POS — handover

Phase I prototype built 17 October 2026; shared login, sign out and the Cash received calculator added 18 October 2026; hotfix H1 splitting the menu into eight items and hotfix H2 aligning the cart lines shipped 19 October 2026; the Sales by day report and the app version label shipped 19 October 2026 as **v1.2.0**; the Orders list and order detail shipped 19 October 2026 as **v1.3.0**; hotfix H3, rebuilding the cash counter for small phones and cutting the menu to seven items, shipped 19 October 2026 as **v1.3.1**; hotfix H4, starting every order on Card, shipped 19 October 2026 as **v1.3.2**; editing and cancelling an order after it has been sent, plus the Samosa Chat menu item, shipped 20 October 2026 as **v1.4.0**. Live, tested and deployed.

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

Eight menu items at £5 each: Fuchka, Momo, Papri Chat, Sweet Box, Samosa, Choc Strawberry, Choc Marshmallow and Samosa Chat. They are seeded automatically on first load if the `menu` collection is empty.

Hotfix H1 split two previously combined items into four in October 2026, and hotfix H3 then dropped Chocolate Fountain and renamed Marshmallow to Chocolate Marshmallow (V), and v1.4.0 added Samosa Chat as the eighth. The retired ids from the split, `samosa`, `straw` and `fountain`, were deleted outright in the H3 reset, which was safe because the database held no orders at the time. **Never reuse a retired id.** If an order ever does carry an item the menu no longer knows, it still shows under the name stored on that order line, with the plain plate icon.

The till builds an order, takes a name to call out, takes cash or card, and sends it. With Cash selected there is an optional **Cash received** calculator: tap Exact, £5, £10, £20 or £50, or type any amount, and it shows the change to give, or how much the order is short by. It is a calculator for the volunteer and nothing more, so it never blocks sending and nothing about it is saved. The order gets a number like `A-043` (till letter plus a daily sequence) and appears on the food counter instantly. Volunteers move it New → Preparing → Ready → Collected with one big button, with an undo for mis-taps. Ready orders show the name in large capitals for calling out. Cards turn amber once an order is six minutes old.

An order that has already been sent can still be put right. **Open orders** on the cash counter lists every unfinished order from every till and offers Edit and Cancel on each, up to the point the customer has it: an order being prepared can still be edited, an order sitting Ready can only be cancelled, and a collected order is closed to both. The food counter never edits or cancels — it is shown the change, in amber for an edit and red for a cancellation, and has to acknowledge it before carrying on. Both need a connection, because the check that stops two volunteers changing the same order at once cannot be queued offline.

Reports give total sales, order count, items sold, average order, average wait, sales per item, orders per 30 minutes with the peak highlighted, the cash-versus-card split, and a CSV export with one row per order line. Cancelled orders are excluded from every figure.

There are three report screens now, with a toggle at the top of each. **One day** is the screen above. **Sales by day** covers a range of dates: pick From and To, or tap Today, Last 7 days or This event, and it shows the totals across the range, a bar chart of sales per day with the best day picked out, a day-by-day table with an Open day button that jumps straight to that day's one-day report, and a grid of every menu item against every day with each item's best day shaded. Only days that actually traded appear. The range is capped at 31 days. Its CSV export covers every order line in the range, the same columns as the one-day export, named `nba-food-stall_<from>_<to>.csv`.

**Orders** lists a single day's orders one by one, which is the screen to open when somebody is standing in front of you asking what was in order A-041. Pick a day, search by order number or by name, and narrow by status or by how it was paid. Tap an order and you get everything about it: till, payment, when it was placed, how long it waited, the full Placed → Started → Ready → Collected timeline with the actual times, and every item with its quantity and price. On a phone the order opens full screen and the usual Back button returns you to the list. It updates itself live, so an order taken at the till appears while the screen is open. It is read-only: nothing on it changes an order, which makes it safe to hand to anyone who needs to look something up. Cancelled orders are listed, so you can see that an order existed and was cancelled, but they are left out of the total. Its CSV export covers whatever the filters are currently showing, named `nba-food-stall_orders_<day>.csv`, and that one does include the cancelled rows, with `cancelled` in the status column.

Every screen now shows the app version. The login card carries a line reading `Version 1.3.2 · build <7 characters> · updated <date>`, and every dark header carries a `v1.3.2` pill. On the small-phone cash counter the version is inside the ☰ menu rather than the header. The version is the release, so it only moves when a phase or a hotfix ships; the build is the exact commit the site was published from, so it changes on every deploy, documentation included. If a volunteer reports something odd, ask them what their screen says: the version tells you whether they are on a stale tab.

---

## What changed

Newest first. The app updates itself when a device loads it, but a till left open on a screen keeps the version it started with.

**20 October 2026, v1.4.0 — an order can be changed or cancelled after it has been sent, and Samosa Chat joins the menu.**

Until now a mistake could only be caught in the first few seconds. The Recent strip showed the last five orders from that one till, and Cancel disappeared the moment the food counter tapped Start. After that the only fix was to shout across the stall, and the reports kept the wrong sale either way.

The cash counter now has an **Open orders** button in its header with a count of how many orders are still live. It opens a list of every unfinished order from **every till**, not just the one you are standing at, newest first, with a search box that matches an order number or a name. Each row has **Edit** and **Cancel…**.

**Edit** loads the order back into the order panel, which turns amber and tells you which order you are changing and what it was before. Change the name, add or take away items, switch between cash and card. The panel says what to do about the money in plain words: "Take £5.00 more", "Give back £5.00", "Refund £5.00 on the card machine", or "No payment change". The app never moves any money itself; it tells the volunteer what to hand over or put through the card machine. **Save changes** writes the order; **Discard changes** leaves it exactly as it was. If you take every item off, it stops you saving an empty order and offers to cancel it instead.

**Cancel…** asks for a reason in one tap — placed by mistake, customer changed mind, out of stock, not collected, other — and shows the refund line before you commit. Neither button will let you change an order somebody has already collected.

**What the food counter sees.** It has no Edit and no Cancel, deliberately: a change only ever comes from the till. What it gets instead is a warning it cannot miss. An order changed before anyone started it simply updates, with a small "Changed" tag. An order changed *while it is being made* turns amber, headed **ORDER CHANGED · CHECK ITEMS**, with each line marked NEW, "+1 (was 2)" or struck through, and the Ready button is replaced by **Got it** — which has to be tapped before that order can be marked ready, so nobody plates up the old order by muscle memory. An order cancelled after somebody has started it turns red, headed **CANCELLED · STOP MAKING**, and stays on screen until somebody taps **Remove**, rather than vanishing from under the person cooking it. On a phone, a tab with an unseen change shows a dot.

What can be done, by status:

| Order status | Edit at the till | Cancel at the till |
|---|---|---|
| New | Yes | Yes |
| Preparing | Yes | Yes |
| Ready | No — cancel only | Yes |
| Collected or already cancelled | No | No |

**Editing and cancelling need a connection.** Both buttons are switched off when the till is offline, with the note "Needs a connection", because the safety check that stops two people changing the same order at once cannot be queued. Taking *new* orders offline still works exactly as before: they queue on the device and sync when the signal comes back.

**Reports.** An edited order carries a small "Edited" tag next to its status, its timeline shows when it was edited and, if cancelled, why, and a Changes list shows what each edit did. Totals need no explaining: an edited order has always been counted at whatever it currently says, and cancelled orders are still left out. All three CSV exports gain two new last columns, `edited` and `cancelReason`.

**Samosa Chat** is the eighth item on the till, £5, last in the row, filed under Chaat on the food counter. It was added to the live menu after this release went out; nothing else on the menu changed.

Every screen now reads `v1.4.0`.


**19 October 2026, hotfix H4 — the till starts on Card.**

Most people at the stall pay by card, so the cash counter now opens on **Card** instead of Cash. Every new order starts there: on first load, after an order is sent, after Clear order, and whenever the last item comes out of the cart. The choice is not remembered between orders, so a card order followed by a cash one still needs one tap, and a long run of card orders needs none at all.

Tapping **Cash** works exactly as before and brings up the Cash received calculator with its Exact, £5, £10, £20 and £50 buttons. Tapping **Card** again puts the calculator away and clears whatever was keyed into it, so the next volunteer never sees a stale amount from the order before.

This is the same on a tablet and on a phone: the Review & send sheet opens on Card with no calculator showing until you ask for it.

Nothing about the order itself changed. The payment is still saved as cash or card, and reports, the cash-versus-card split and both CSV exports read exactly as they did. The only thing to tell volunteers is that the buttons start the other way round, so anyone taking a cash payment now taps Cash first. Every screen reads `v1.3.2`.


**19 October 2026, hotfix H3 — the cash counter fits a phone, and the menu is seven items.**

On an iPhone the cash counter used to be close to unusable. The order panel sat open all the time and took over half the screen, so only two menu tiles showed, the dark header wrapped onto three rows and the Cash and Card buttons were squeezed to nothing. It has been rebuilt for any screen narrower than 700px. The tablet and desktop cash counter is unchanged, and so is everything else on every size.

What a till volunteer sees now. The header is one row: the till letter, whether you are online, the next order number, and a ☰ button. Food counter, Reports, Recent orders and Sign out moved into that ☰ menu, which is also where the version now shows. All seven menu tiles fit on the screen at once, three to a row, with no scrolling. Nothing covers the tiles until you add something, and then a single teal bar appears along the bottom reading, for example, "3 items · £15.00 Review & send". Tap it and the order slides up over the menu: the name to call out, the lines with − and +, the total, Cash or Card, the Cash received calculator, and a Send button pinned at the bottom where it is always reachable. **Add more** takes you back to the tiles without losing the order. Escape and the phone's own Back button close it too, and taking the last item out closes it for you.

Nothing about sending an order changed. It writes the same order, clears the cart and shows the same confirmation with the order number for four seconds.

**The menu is now seven items.** Chocolate Fountain has gone, and "Chocolate Marshmallow" is now **Chocolate Marshmallow (V)**, shown on the tiles as "Choc Marshmallow". The three retired items from the H1 split, `samosa`, `straw` and `fountain`, have been deleted rather than left switched off, so the menu in the Firebase console is exactly the seven things you sell.

**Live data was reset as part of this release**, which was safe because the stall has not traded yet and the database held no real orders. Everything in `orders`, `menu` and `settings` was backed up first to `.secrets/backups/live-20261019-094925439Z.json` on the build machine, which is outside the repo and is the only copy of the old menu — keep it until you are happy with the new one. Then `orders` was emptied (it was already empty), the seven menu documents were written in full, and `fountain`, `samosa` and `straw` were deleted. `settings` was not touched, so "This event" stays hidden until somebody creates that document. Reports now read zero, as they should before trading starts, and order numbers will start from 001 on the first trading day. Devices keep their till letter.

Prices and names are still edited in the Firebase console, the same as before. If you add an item the app does not recognise, it still appears on an order under whatever name was stored with it, with the plain plate icon.

**19 October 2026 — the leftover QA order was deleted from the live database.** The one document left in live `orders` by the smoke test, order `A-001` on 19 October 2026, £40.00, cash, collected, eight lines of one of each item, was deleted at the organiser's request. It was checked against its record in this handover before it went: it was the only document in the collection and the only one numbered `A-001`, so no real sale was at risk. Live `orders` is now empty and `menu` is untouched, with all ten items present and `samosa` and `straw` still retired. Reports for 19 October now read zero, as they should before trading starts.

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

Phase V took one round. Fifteen e2e cases failed on the first full run and all fifteen came from two accessibility defects rather than from the feature: the Open orders button's spoken name did not start with the words printed on it, and the cancelled food-counter card used a grey too faint against its pink background. Both were fixed and re-verified. The second of them is worth recording, because the fix that was proposed was not the fix that shipped: the suggested grey measured 4.39:1 against that card, just under the 4.5:1 the text size requires, and would have re-opened the bug on the exact card it was raised against. A darker grey at 6.97:1 went in instead, and the measurement was redone independently before it was accepted. No defect was found in the Phase V build itself.

Hotfix H3 took none either. Nine tests failed on the first full run and every one of them was a test asserting the phone layout H3 deliberately replaces, or the menu entries it deliberately removes; each was checked against the brief before being updated, not simply made to agree with the new code. No defect was found in the H3 build. Hotfix H4 took none against the app either: Neo's change was green on its first full run, and the only red test was the version bump itself, which is Trinity's step rather than a defect. The numbers below come from a clean run on the bumped tree, plus a separate read-only live check against the deployed v1.4.0.

| Suite | Tests | Passed | Failed |
|---|---|---|---|
| Unit (Vitest) | 370 | 370 | 0 |
| E2E (Playwright), five viewports | 534 | 534 | 0 |
| Live check on v1.4.0 (against the deployed site) | 26 | 26 | 0 |
| **Total** | **930** | **930** | **0** |

The e2e suite now runs five viewports rather than two. The original phone 390×844 and tablet 1280×800 projects still run everything; three new projects model the phones H3 was built for — **iPhone 13 at 390×664, iPhone 17 at 402×694 and a Pro Max at 430×752**, each being the device width less the 180px of Safari chrome that gives the brief's figures. Those three run the H3 cash counter spec only, because the rest of the suite already covers the new layout through the 390×844 phone project and tripling a 286-case suite would make the fix loop unusable.

A further 208 e2e cases are skipped by design rather than failing: the viewport-gated ones that only make sense at one width, and the live-gated ones that only run against the deployed site when their environment flag is set.

The v1.3.2 live check was read-only, as every live check since Phase I has been. It signed in, loaded all six screens on a tablet and an iPhone 13, exercised the cart and the Review & send sheet by adding items and taking them out again, and read the live database before and after to prove nothing was written: `orders` empty both times, `menu` the same seven documents, `settings` untouched. One thing cannot be checked that way — that the panel returns to Card **after an order is sent**, which needs a real order. That case is covered on the emulator and is recorded as untestable live rather than quietly skipped.

Also clean: zero axe accessibility violations on all seven routes at both sizes, zero console errors, no horizontal scroll at 360px, and every interactive control at or above the 48px minimum (re-measured independently at 390, 360 and 1280 wide).

- Test plan: [`qa/test-plan.md`](qa/test-plan.md)
- Bug log with the final status of every bug: [`qa/bugs.md`](qa/bugs.md)
- Screenshots: every screen at both sizes including the login screen and its error state, plus the live-site captures: [`qa/screenshots/`](qa/screenshots/)
- Playwright HTML report: `playwright-report/index.html` (local only, not committed — regenerate with `npm test`)

To run the tests yourself: `npm install`, then `npm test`. Needs Java 21 for the Firestore emulator.

### Live smoke test

Run against the deployed site, not the emulator, after each phase.

**Phase V (20 October 2026), 26 checks passed, 0 failed, read-only.** On the deployed build `6394978` at 1280×800 and 390×664, with zero console errors on any route at either size and the pill reading Online. Eight tiles with Samosa Chat last in its own colour and its own icon, all eight inside an iPhone 13 screen without scrolling. Open orders in both headers with its count, the drawer 480px on a tablet and a full-width sheet on a phone, closing on Close, a backdrop tap and Escape. The Recent strip is gone, and "Next A-001" now sits inside the ☰ menu above the version line, checked by measuring where it is rather than where it appears in the markup. Every screen reads `v1.4.0` and the login card reads `Version 1.4.0 · build 6394978 · updated 20 Oct 2026`. All three CSV exports end `…,waitSeconds,edited,cancelReason`, proved against 168 real order lines from 19 October rather than against an empty day. Zero serious or critical accessibility violations on the live cash counter and food counter.

Nothing was written: `orders` held 127 documents before and after with the same fingerprint, and `menu` the same eight ids. Save changes, Cancel order, Got it and Remove were never tapped.

Three things could not be checked live and are recorded rather than quietly skipped, because the live database held no *unfinished* orders on the day of the check: what an Open orders row looks like with a real order in it, edit mode and its payment prompt, and a Samosa Chat line greying under a station filter. Creating an order to test them would have broken the read-only rule. All three are covered on the emulator.

**Hotfix H4 (19 October 2026), 81 checks passed, 0 failed, read-only.** On the deployed build `b03fecd` at 1280×800 and 390×664, with zero console errors on any route at either size and the pill reading Online. The cash counter opens with Card selected and `pay-cash` unpressed, and the words "Cash received" appear nowhere on the screen until Cash is tapped. Tapping Cash brings the calculator up with its live change and short wording; tapping Card puts it away and clears both the quick button and the Other amount box. Clear order on the tablet, and taking the last item out with the − stepper on either size, both return the panel to Card. On the phone, the Review & send sheet opens on Card with no calculator.

One case could not be checked live and is recorded rather than skipped: that the panel returns to Card **after an order is sent** needs a real order, so it is covered on the emulator instead. Every screen reads `v1.3.2` and the login card reads `Version 1.3.2 · build b03fecd · updated 19 Oct 2026`, with a clean seven-character build id and no `-dirty`.

The run also re-ran the H2, H3, Phase III and Phase IV live suites against v1.3.2, which turned up seven stale assertions in those older specs — a version number frozen at 1.3.1, geometry that assumed the pre-H3 phone layout, "the menu holds ten documents" after H3 cut it to seven, and a Phase IV precondition requiring at least one live order, which the H3 reset made impossible. All seven were test rot rather than app defects; each was fixed against the brief.

**Nothing was written.** Items were added to the cart to open the sheet and then stepped back out again; Send was never clicked on either viewport. `orders` held 0 documents before and after, `menu` the same 7, `settings` the same 0.


**Hotfix H3 (19 October 2026), 22 checks passed, 0 failed, read-only.** On the deployed build `9be6abd` at 390×664 and 402×694, with zero console errors on any route at either size. Seven tiles in three rows, all on screen at once with nothing to scroll, the seventh reading "Choc Marshmallow" and announcing itself to a screen reader as "Add Chocolate Marshmallow (V)". No trace of Chocolate Fountain, Sweets Box or the old combined Strawberry & Marshmallow anywhere in the page. The header holds one row at 52px, the ☰ opens and closes, the order bar appears only once something is in the cart, and the review sheet opens with its lines aligned, its 48px steppers, its Cash received buttons showing "Change £5.00", and closes on Add more, on Escape and on the browser Back button.

All three reports read zero, which is what the reset was for: no sales, no orders, "No sales in this range" and "No orders match these filters." The CSV downloaded with its thirteen columns and no data rows. Every screen reads `v1.3.1` and the login card reads `Version 1.3.1 · build 9be6abd · updated 19 Oct 2026`, with a clean seven-character build id and no `-dirty`, which is how you can tell it came through CI rather than off the build machine.

**Nothing was written.** Items were added to the cart to open the sheet and then stepped back out again; Send was never clicked. `orders` held 0 documents before and after, `menu` the same 7, `settings` the same 0.

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

**The browser Back button while editing an order drops the edit without asking.** Sign out, the header and ☰ navigation links, and starting Edit on a second order all show a confirm first. Back does not, because intercepting it needs a history entry that collides with the one the phone's Review & send sheet already uses. Nothing is written either way, so the worst case is retyping a change, not a wrong order. Use Discard changes rather than Back.

**Greyed-out lines under a station filter are too faint.** On the food counter, lines belonging to another station are shown in a grey that measures 2.52:1 against white, below the accessibility minimum. It has been there since v1.0.0 and Phase V did not touch it; it is logged as BUG-12 with the fix and the missing test case written up. It was left out of this release rather than changing untested v1.0.0 code on the way out of the door.

**The three CSV exports do not share a naming scheme.** Sales by day gives you `nba-food-stall_<from>_<to>.csv` and Orders gives you `nba-food-stall_orders_<day>.csv`, but the One day export is still `orders-<day>.csv` from Phase I. All three open correctly; they just look like they came from different apps when they are sitting in a downloads folder. The brief only ever specified a name for the two newer ones, so it was left alone.

**`qa/live-smoke-record.txt` double-counts retried runs.** The live specs append their pass lines from inside each test, and Playwright is configured to retry a failed file from the start in serial mode, so a run that fails part-way leaves a truncated block behind and the whole file restarts. The H3 block was cleaned up during the v1.3.2 release, with a note recording what was removed and why, but the `H4L`, `P3L`, `P4L` and `H-22` blocks still carry duplicates from the same mechanism. The file is an evidence log, not a test fixture, so nothing depends on it; read the pass counts in the handover rather than counting lines in it. The Playwright HTML report is not a safe cross-check either: it is regenerated by the next invocation, so a later listing-only run can overwrite the report for the run you wanted to read.


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

**1. Create `settings/event` if you want the "This event" button.** It does not exist, so the quick button is hidden, which is the specified behaviour rather than a fault. To switch it on, add a document `settings/event` in the Firebase console with `name`, `from` and `to`, the dates as `YYYY-MM-DD` strings. The button appears the next time the screen loads. No deploy needed.

**2. Restrict the Firebase browser API key to the site. Not blocking, worth doing.**

`gcloud` is not installed on the build machine, so this could not be automated.

Go to console.cloud.google.com → APIs & Services → Credentials → project `nba-food-stall-9fec6` → "Browser key (auto created by Firebase)" → Application restrictions → HTTP referrers, and add:

```
https://nottinghambengaliassociation.github.io/*
http://localhost:5173/*
http://127.0.0.1:5173/*
```

For context, a Firebase web API key always ends up in the browser of a deployed web app. That is how every Firebase web app works: the key identifies the project, it is not a password. Keeping it out of the GitHub repo was still the rule here and that rule held. Restricting it by referrer is the extra step.

**3. Tighten the Firestore rules before this is reused.** The rules are `allow read, write: if true`, so the public API key plus the project id is enough for anyone to read or wipe the whole database. Fine for one day with an unadvertised URL, not fine for anything ongoing. If the stall runs again, this is the first thing to fix.

**4. Choose a shared password that is used nowhere else, and tell the volunteers it verbally.** The hash ships in the browser, so a weak or reused password is the weak point. Do not put it in a WhatsApp group that outlives the event.

**5. Sign the Firebase CLI back in on this Mac, if you want console-free access.** The credentials expired during the build, so `firebase` commands against the real project fail. Nothing currently depends on it: the site is deployed, the database is in its correct starting state, and the Pages workflow uses Actions secrets rather than this login. To restore it: `firebase login --reauth`, then `firebase projects:list` to confirm.

**6. Close the screenshot gap in the secret scanner, before the next phase rather than after it.**

`scripts/check-secrets.sh` skips binary files by design, so the QA screenshots have never been scanned by it — not in this release and not in any earlier one. The scanner reporting clean over the tracked text files says nothing at all about the PNGs committed alongside them.

Nothing has leaked. For the H3 release the check went further than a visual one: every tracked and untracked file in the repo, PNGs included, was scanned byte by byte for the real username and the real password, and neither appears anywhere. No capture carries a `tEXt`, `iTXt` or `zTXt` metadata chunk. The login captures show a test fixture username, confirmed not to be the configured one, with the password field empty; the new cash-counter captures show no username at all, because the small header has nowhere to put one.

The problem is that this currently rests on QA's capture discipline plus somebody remembering to look. If a future run ever photographs a filled login form, or a new screen starts showing who is signed in, no automated check would catch it. Either write the rule down so the next run inherits it, or add a cheap check that fails when a `*login*` screenshot's field region is not blank.

**7. Decide what happens to the data after the event.** Export the CSV from the Reports screen, then decide whether the orders stay in Firestore or get cleared.

**8. Keep or delete the pre-reset backup.** The H3 reset wrote `.secrets/backups/live-20261019-094925439Z.json` on the build machine before it touched anything. It is outside the repo, gitignored, and holds the ten menu documents as they were, which is the only remaining copy of the three retired items. It contains no orders, because there were none. Keep it until you are satisfied the seven-item menu is right, then delete it — there is no reason for a database dump to sit on a laptop indefinitely.

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

Since the H3 reset it reports no differences at all: live `menu` is exactly the seven documents the script expects. It never overwrites a value you have edited in the console and never deletes anything, so if you change a price there it will report the difference rather than undo it. The one script that does delete is `scripts/reset-live.mjs`, which backs everything up first, refuses to run without `--yes`, and is not something to run against a database that has traded.

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
