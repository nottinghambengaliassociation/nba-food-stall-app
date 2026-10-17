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
