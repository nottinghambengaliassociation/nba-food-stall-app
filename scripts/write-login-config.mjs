#!/usr/bin/env node
// write-login-config.mjs — generate public/js/login-config.js.
//
// This file is gitignored and must never be committed. The script prints only
// "written" or "missing: <NAMES>"; it never echoes the user, the password or
// the hash. The plain password is only ever read from .secrets/app-login.env —
// it is never written to any file and never leaves this process.
//
//   node scripts/write-login-config.mjs
//       Read APP_LOGIN_USER and APP_LOGIN_PASSWORD from .secrets/app-login.env
//       (falling back to the environment), hash the password with SHA-256 and
//       write public/js/login-config.js (local dev).
//
//   node scripts/write-login-config.mjs --actions-env <file>
//       As above, and additionally write <file> with APP_LOGIN_USER and
//       APP_LOGIN_PASSWORD_SHA256 lines, for `gh secret set -f <file>`.
//       Must be a path inside .secrets/ (gitignored). Never the password.
//
//   node scripts/write-login-config.mjs --from-env
//       Write from the APP_LOGIN_USER and APP_LOGIN_PASSWORD_SHA256
//       environment variables (used by CI). If either is missing, write the
//       PASTE_ placeholder version and exit 0, so the app shows its
//       "Login not configured" state rather than failing the deploy.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/js/login-config.js");
const SECRETS_DIR = resolve(ROOT, ".secrets");
const ENV_IN = resolve(SECRETS_DIR, "app-login.env");

const USER_VAR = "APP_LOGIN_USER";
const PASSWORD_VAR = "APP_LOGIN_PASSWORD";
const SHA_VAR = "APP_LOGIN_PASSWORD_SHA256";

const PLACEHOLDER = { loginUser: "PASTE_USER", loginPasswordSha256: "PASTE_SHA256" };

const HEADER = `// GENERATED FILE — DO NOT COMMIT, DO NOT EDIT BY HAND.
// Written by scripts/write-login-config.mjs (locally) or by
// .github/workflows/pages.yml from GitHub Actions secrets (in CI).
// Shape is documented in public/js/login-config.example.js.
`;

function render(cfg) {
  return (
    HEADER +
    `export const loginUser = ${JSON.stringify(String(cfg.loginUser))};\n` +
    `export const loginPasswordSha256 = ${JSON.stringify(String(cfg.loginPasswordSha256))};\n`
  );
}

function writeConfig(cfg) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(cfg), "utf8");
}

// Minimal KEY=VALUE reader: last assignment wins, # comments and blanks skipped,
// surrounding single/double quotes stripped. Values are never logged.
function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (value.length > 1 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function blank(v) {
  return v === undefined || v === null || String(v).trim() === "" || String(v).startsWith("PASTE_");
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const argv = process.argv.slice(2);
const fromEnv = argv.includes("--from-env");
const actionsEnvOut = argv.includes("--actions-env") ? argv[argv.indexOf("--actions-env") + 1] : null;

try {
  if (fromEnv) {
    const user = process.env[USER_VAR] ?? "";
    const sha = process.env[SHA_VAR] ?? "";
    const missing = [];
    if (blank(user)) missing.push(USER_VAR);
    if (blank(sha) || !/^[0-9a-f]{64}$/i.test(String(sha).trim())) missing.push(SHA_VAR);
    if (missing.length) {
      writeConfig(PLACEHOLDER);
      console.log("missing: " + missing.join(" "));
      process.exit(0); // placeholders deploy fine; the app shows "Login not configured"
    }
    writeConfig({ loginUser: user, loginPasswordSha256: String(sha).trim().toLowerCase() });
    console.log("written");
    process.exit(0);
  }

  const file = readEnvFile(ENV_IN);
  const user = file[USER_VAR] ?? process.env[USER_VAR] ?? "";
  const password = file[PASSWORD_VAR] ?? process.env[PASSWORD_VAR] ?? "";

  const missing = [];
  if (blank(user)) missing.push(USER_VAR);
  if (blank(password)) missing.push(PASSWORD_VAR);
  if (missing.length) {
    writeConfig(PLACEHOLDER);
    console.log("missing: " + missing.join(" "));
    process.exit(1);
  }

  const sha = sha256Hex(password);
  writeConfig({ loginUser: user, loginPasswordSha256: sha });

  if (actionsEnvOut) {
    const target = resolve(ROOT, actionsEnvOut);
    if (resolve(target, "..") !== SECRETS_DIR) {
      console.log("missing: --actions-env must point inside .secrets/");
      process.exit(1);
    }
    mkdirSync(SECRETS_DIR, { recursive: true });
    // Hash only. The plain password is never written anywhere.
    writeFileSync(target, `${USER_VAR}=${user}\n${SHA_VAR}=${sha}\n`, { encoding: "utf8", mode: 0o600 });
  }

  console.log("written");
} catch (err) {
  // Never surface the payload; only the failure reason.
  console.log("missing: " + (err && err.message ? err.message.split("\n")[0] : "unknown error"));
  process.exit(1);
}
