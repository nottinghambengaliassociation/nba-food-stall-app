#!/usr/bin/env bash
# check-secrets.sh — block credentials from ever entering git history.
#
#   scripts/check-secrets.sh          scan STAGED content (used by the pre-commit hook)
#   scripts/check-secrets.sh --all    scan every tracked + untracked-but-not-ignored file
#   scripts/check-secrets.sh F1 F2    scan the named files
#
# Exits 1 and names the offending FILE. It never prints the matched value.
set -uo pipefail

RED=''; BOLD=''; RESET=''
if [ -t 1 ]; then RED=$'\033[31m'; BOLD=$'\033[1m'; RESET=$'\033[0m'; fi

# Patterns are written so that this script and CLAUDE.md, which both quote them,
# do not match themselves: each literal prefix here is followed by '[', which is
# not a member of the character class that must follow it in a real credential.
PATTERNS=(
  'AIza[0-9A-Za-z_-]{35}'              # Google / Firebase API key
  '"private_key"[[:space:]]*:'         # service-account JSON
  '"private_key_id"[[:space:]]*:'      # service-account JSON
  'ghp_[0-9A-Za-z]{36}'                # GitHub personal access token (classic)
  'github_pat_[0-9A-Za-z_]{22,}'       # GitHub fine-grained PAT
  'gho_[0-9A-Za-z]{36}'                # GitHub OAuth token
  '-----BEGIN [A-Z ]*PRIVATE KEY-----' # PEM private key
  '(APP_)?LOGIN_PASSWORD[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9._@!#$%^&*+-]{3,}' # plaintext app login password
)
DESCRIPTIONS=(
  "Google/Firebase API key"
  "service-account private key"
  "service-account private key id"
  "GitHub personal access token"
  "GitHub fine-grained token"
  "GitHub OAuth token"
  "PEM private key"
  "plaintext app login password"
)

MODE="staged"
FILES=()
if [ "$#" -gt 0 ]; then
  if [ "$1" = "--all" ]; then
    MODE="all"
  elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    sed -n '2,9p' "$0"; exit 0
  else
    MODE="list"; FILES=("$@")
  fi
fi

in_git_repo() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }

# The literal app login password, read from the gitignored .secrets/app-login.env
# when it exists, so that a file containing it is blocked even though it matches
# none of the patterns above. The value is held in this variable only: it is
# never printed, never passed as a command argument and never written anywhere.
LOGIN_PW=""
LOGIN_ENV="$(cd "$(dirname "$0")/.." && pwd)/.secrets/app-login.env"
if [ -r "$LOGIN_ENV" ]; then
  # grep + cut, not `sed -n 's/\(x\)\?y//p'`: BSD sed has no \? in a basic
  # regex, so that form matched nothing on macOS and the check silently passed.
  LOGIN_PW="$(grep -E '^[[:space:]]*(export[[:space:]]+)?APP_LOGIN_PASSWORD[[:space:]]*=' "$LOGIN_ENV" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
  # Trim surrounding whitespace.
  LOGIN_PW="${LOGIN_PW#"${LOGIN_PW%%[![:space:]]*}"}"
  LOGIN_PW="${LOGIN_PW%"${LOGIN_PW##*[![:space:]]}"}"
  # Strip one layer of surrounding quotes.
  case "$LOGIN_PW" in
    \"*\") LOGIN_PW="${LOGIN_PW#\"}"; LOGIN_PW="${LOGIN_PW%\"}" ;;
    "'"*"'") LOGIN_PW="${LOGIN_PW#\'}"; LOGIN_PW="${LOGIN_PW%\'}" ;;
  esac
  # Too short to search for without flagging ordinary prose.
  [ "${#LOGIN_PW}" -lt 4 ] && LOGIN_PW=""
fi

case "$MODE" in
  staged)
    if ! in_git_repo; then echo "check-secrets: not a git repository"; exit 1; fi
    while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done \
      < <(git diff --cached --name-only --diff-filter=ACMR)
    ;;
  all)
    if in_git_repo; then
      # --exclude-standard honours .gitignore, so node_modules/, .secrets/,
      # public/js/firebase-config.js, playwright-report/ and test-results/
      # are skipped automatically.
      while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done \
        < <(git ls-files --cached --others --exclude-standard)
    else
      while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done \
        < <(find . -type f \
              -not -path './.git/*' \
              -not -path './node_modules/*' \
              -not -path './playwright-report/*' \
              -not -path './test-results/*' \
              -not -path './.secrets/*')
    fi
    ;;
esac

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "check-secrets: nothing to scan — OK"
  exit 0
fi

# Every grep below reads a FILE, never `printf "$content" | grep -q` and never a
# here-string built from a shell variable. Two reasons, both found the hard way:
#
#   1. `printf '%s' "$content" | grep -q PAT` is wrong under `set -o pipefail`.
#      grep -q exits at its first match, printf dies of SIGPIPE (141) before it
#      has finished writing, and the pipeline reports 141 — indistinguishable
#      from "no match". Any content bigger than the 64 KiB pipe buffer was
#      therefore skipped outright: package-lock.json, qa/test-plan.md,
#      qa/bugs.md and qa/live-smoke-record.txt were never scanned, and a real
#      key inside one of them would not have been reported.
#   2. Command substitution strips NUL bytes, so a $content copy of a PNG looks
#      like text. The binary skip below has to see the real bytes, or every
#      screenshot gets run through eight regexes for nothing (30 s per run).
#
# Staged mode writes the blob to a temp file so that what is scanned is exactly
# what is going into the commit; other modes scan the working file in place.
TMP_BLOB=""
cleanup() { [ -n "$TMP_BLOB" ] && rm -f "$TMP_BLOB"; }
trap cleanup EXIT
if [ "$MODE" = "staged" ]; then
  TMP_BLOB="$(mktemp -t check-secrets)" || { echo "check-secrets: cannot create temp file"; exit 1; }
fi

found=0
scanned=0
for f in "${FILES[@]}"; do
  # Never scan the scanner's own pattern table, and skip paths that should
  # never be committed anyway (they are gitignored; this is belt and braces).
  case "$f" in
    .secrets/*|node_modules/*|playwright-report/*|test-results/*) continue ;;
    public/js/firebase-config.js|public/js/login-config.js) continue ;;
  esac
  if [ "$MODE" = "staged" ]; then
    git show ":$f" > "$TMP_BLOB" 2>/dev/null || continue
    target="$TMP_BLOB"
  else
    [ -f "$f" ] && [ -r "$f" ] || continue
    target="$f"
  fi
  [ -s "$target" ] || continue
  # Skip binaries (screenshots and other assets): grep -I reads the real bytes.
  grep -Iq . "$target" 2>/dev/null || continue
  scanned=$((scanned + 1))
  i=0
  for pat in "${PATTERNS[@]}"; do
    if grep -Eq -- "$pat" "$target"; then
      echo "${RED}${BOLD}check-secrets: possible ${DESCRIPTIONS[$i]} in:${RESET} $f"
      found=1
    fi
    i=$((i + 1))
  done
  # Literal match on the real password, if we have it. -f with a process
  # substitution keeps the value out of the argument list.
  if [ -n "$LOGIN_PW" ]; then
    if grep -Fq -f <(printf '%s\n' "$LOGIN_PW") "$target"; then
      echo "${RED}${BOLD}check-secrets: app login password in:${RESET} $f"
      found=1
    fi
  fi
done

if [ "$found" -ne 0 ]; then
  cat <<'EOF'

COMMIT BLOCKED. A credential-shaped string was found in the file(s) above.
The matched text is deliberately not printed.

  - Firebase web config belongs in public/js/firebase-config.js, which is
    gitignored and generated by scripts/write-firebase-config.mjs.
  - Service-account JSON and .env files must stay in .secrets/.
  - The app login password lives only in .secrets/app-login.env. Only its
    SHA-256 hash ever reaches public/js/login-config.js (gitignored) or a
    GitHub Actions secret.
  - If this is a genuine false positive, change the file so it no longer looks
    like a key. Do not use `git add -f` and do not bypass this hook.
EOF
  exit 1
fi

echo "check-secrets: scanned ${scanned} file(s) — no secrets found"
exit 0
