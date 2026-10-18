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
