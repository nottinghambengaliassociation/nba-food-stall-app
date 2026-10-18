# Start here

About 10 minutes from you, then Claude Code builds, tests and deploys on its own with three agents:

| Agent | Role |
|---|---|
| Neo | UI developer: builds the app |
| Morpheus | QA tester: writes and runs the tests, logs bugs |
| Trinity | Platform / DevOps: Firebase, GitHub repo, secrets, Pages deploy, every commit and push |

GitHub org: https://github.com/nottinghambengaliassociation · repo `nba-food-stall-app` · live at https://nottinghambengaliassociation.github.io/nba-food-stall-app/

## 0. Move the agent and permission files into place

Cowork can't write into `.claude/`, so they are in `claude-setup/`. From this folder, before starting Claude Code:
```
mkdir -p .claude/agents && mv claude-setup/settings.json .claude/ && mv claude-setup/agents/*.md .claude/agents/ && rmdir claude-setup/agents claude-setup
```

## 1. Tools (once)

| Need | Check | Install |
|---|---|---|
| Node 20+ | `node -v` | nodejs.org |
| Java JDK 21 (Firestore emulator) | `java -version` | adoptium.net |
| Git | `git --version` | git-scm.com |
| GitHub CLI | `gh --version` | cli.github.com |
| Firebase CLI | `firebase --version` | `npm i -g firebase-tools` |
| Google Cloud CLI (optional, lets Trinity create Firestore and lock the API key to the site) | `gcloud --version` | cloud.google.com/sdk |
| Claude Code | `claude --version` | docs.claude.com |

## 2. Sign-ins (once, they open a browser, so Claude Code can't do them)

If `GITHUB_TOKEN` is set in your shell (gh says "The value of the GITHUB_TOKEN environment variable is being used"), clear it in this terminal first and start Claude Code from the same terminal:
```
unset GITHUB_TOKEN
```

```
gh auth login                  # an account that can create repos in nottinghambengaliassociation
gh auth refresh -s workflow    # lets Trinity push the Pages workflow
firebase login                 # the charity's Google account, not your work account
gcloud auth login              # optional, same Google account
```

If you have never used Firebase with that Google account, open console.firebase.google.com once and accept the terms; otherwise project creation fails.

Trinity does the rest: creates the Firebase project, Firestore in London, open prototype rules, the web app, the GitHub repo, the Actions secrets and Pages. Anything it can't do lands in `HANDOVER.md` under "Needs you", and the build still finishes against the local emulator.

## 3. Kick off

From this folder:

**Option A (recommended): allow-list, no bypass.**
```
claude "Read CLAUDE.md and run the whole build end to end. Use the trinity subagent for Firebase, GitHub, secrets, commits and deploys; the neo subagent to build and fix; the morpheus subagent to test. Run trinity's setup in parallel with neo and morpheus. Loop until npm test is green, deploy to GitHub Pages, smoke-test the live URL, write HANDOVER.md and open the live site. Do not ask me anything; log decisions in DECISIONS.md."
```

**Option B: no prompts at all.** Only inside a dev container or throwaway VM, never as root.
```
claude --dangerously-skip-permissions "<same prompt as above>"
```

## Login account

The app has one shared login. The username and password are kept only in `.secrets/app-login.env` in this folder (gitignored, already created). They are never committed: GitHub gets the username and a SHA-256 of the password as Actions secrets, and the deploy writes them into the site.

To change the password later: edit `.secrets/app-login.env`, then ask Claude Code: "Use the trinity subagent to rotate the login: rerun write-login-config, update the APP_LOGIN secrets and redeploy."

**Already ran the build before login and the cash received change were added?** Start Claude Code with:
```
claude --permission-mode auto "Read CLAUDE.md. The app is already built; add Login and sign out, and the optional Cash received with Exact and Other amount, as described. Trinity: login config script, secrets, workflow step. Neo: build both. Morpheus: add tests for both and rerun everything. Then Trinity deploys, Morpheus smoke-tests login on the live URL, and you update HANDOVER.md. Do not ask me anything."
```

## Keys and secrets

| Where | What |
|---|---|
| GitHub repo | Nothing secret. `firebase-config.js` is gitignored; only `firebase-config.example.js` (placeholders) is committed |
| GitHub Actions secrets | `FIREBASE_*` (six) plus `APP_LOGIN_USER`, `APP_LOGIN_PASSWORD_SHA256`, set by Trinity from local gitignored files |
| Deploy | The workflow writes `firebase-config.js` from those secrets just before publishing |
| Guardrails | `.gitignore`, a pre-commit hook that blocks keys, GitHub secret scanning with push protection, deny rules on `git add -f` and `gh secret set --body` |

A Firebase web key still reaches the browser on the live site; that's how every Firebase web app works. It identifies the project rather than unlocking it. Trinity restricts it to the Pages domain if `gcloud` is signed in.

## Permissions granted (Option A)

| Area | Allowed | Why |
|---|---|---|
| Files | Read, Edit, Write, Glob, Grep in this folder; mode `acceptEdits` | Code, tests, docs without prompts |
| Packages | `npm *`, `npx *`, `node *` | Install deps, Vitest, Playwright, http-server |
| Platform | `firebase *`, `gcloud *`, `gh *`, `git *` | Trinity's Firebase, GitHub and deploy work |
| Scripts | `chmod *`, `scripts/*`, `bash scripts/*`, `sh scripts/*` | Pre-commit hook, config writer, secret check |
| Shell helpers | `ls cat head tail wc find grep mkdir cp mv rm touch echo which pwd sleep lsof kill pkill curl java -version` | Housekeeping, free ports, emulator reset |
| Open results | `open *`, `xdg-open *` | Show you the live site and test report |
| Web | WebSearch; WebFetch on Firebase, Google Cloud, Playwright, GitHub, MDN, npm, Google Fonts docs | Look up current docs |
| **Denied** | `sudo`, `git push --force/-f`, `git add -f/--force`, `git config --global`, `gh repo delete`, `gh secret set --body/-b`, `firebase projects:delete`, `gcloud projects delete`, `rm -rf /`, `rm -rf ~`, `rm -rf ..` | Can't damage your machine, leak a secret on the command line, or delete the project |

Windows: run inside WSL, or swap `open`/`xdg-open` for `start` in `.claude/settings.json`.

## What you get back

- Live app with `#/cash`, `#/kitchen`, `#/reports`
- `HANDOVER.md`: links, tablet set-up for the day, test results, known issues, "Needs you"
- `qa/screenshots/` (phone and tablet), `playwright-report/index.html`
- `DECISIONS.md`, `qa/test-plan.md`, `qa/bugs.md`

## Kit contents

```
CLAUDE.md                              build brief, read automatically by Claude Code
claude-setup/agents/neo.md             UI developer      → .claude/agents/
claude-setup/agents/morpheus.md        QA tester         → .claude/agents/
claude-setup/agents/trinity.md         Platform / DevOps → .claude/agents/
claude-setup/settings.json             permissions       → .claude/
public/js/firebase-config.example.js   config shape, placeholders only
public/js/login-config.example.js      login config shape, placeholders only
public/img/nba-logo.png                NBA logo
.gitignore                             keeps .secrets/ and generated config out of git
.secrets/app-login.env                 shared login (on your Mac only, never in git or the zip)
design/*.dc.html                       mock-ups from the design canvas
```
