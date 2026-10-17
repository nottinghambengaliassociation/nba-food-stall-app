#!/usr/bin/env node
// write-firebase-config.mjs — generate public/js/firebase-config.js.
//
// This file is gitignored and must never be committed. The script prints only
// "written" or "missing: <NAMES>"; it never echoes a config value.
//
//   node scripts/write-firebase-config.mjs
//       Ask the Firebase CLI for the web app's SDK config and write both
//       public/js/firebase-config.js and .secrets/firebase.env (local dev).
//
//   node scripts/write-firebase-config.mjs --from-sdkconfig <file.json>
//       Same, but read a saved `firebase apps:sdkconfig --json` payload.
//
//   node scripts/write-firebase-config.mjs --from-env
//       Write from the six FIREBASE_* environment variables (used by CI).
//       If any are missing, write the PASTE_ placeholder version instead so
//       the app shows its "Storage not configured" banner rather than crashing.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/js/firebase-config.js");
const ENV_OUT = resolve(ROOT, ".secrets/firebase.env");
const PROJECT_ID = "nba-food-stall-9fec6";

const KEYS = [
  ["apiKey", "FIREBASE_API_KEY"],
  ["authDomain", "FIREBASE_AUTH_DOMAIN"],
  ["projectId", "FIREBASE_PROJECT_ID"],
  ["storageBucket", "FIREBASE_STORAGE_BUCKET"],
  ["messagingSenderId", "FIREBASE_MESSAGING_SENDER_ID"],
  ["appId", "FIREBASE_APP_ID"],
];

const PLACEHOLDER = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

const HEADER = `// GENERATED FILE — DO NOT COMMIT, DO NOT EDIT BY HAND.
// Written by scripts/write-firebase-config.mjs (locally) or by
// .github/workflows/pages.yml from GitHub Actions secrets (in CI).
// Shape is documented in public/js/firebase-config.example.js.
`;

function render(cfg) {
  const body = KEYS.map(([k]) => `  ${k}: ${JSON.stringify(String(cfg[k]))}`).join(",\n");
  return `${HEADER}export const firebaseConfig = {\n${body}\n};\n`;
}

function writeConfig(cfg) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(cfg), "utf8");
}

// Pull the config object out of whatever `firebase apps:sdkconfig --json` gave us.
function extract(payload) {
  let node = payload;
  if (node && node.status && node.result !== undefined) node = node.result;
  if (node && typeof node.sdkConfig === "object" && node.sdkConfig) node = node.sdkConfig;
  if (node && typeof node.fileContents === "string") {
    const m = node.fileContents.match(/\{[\s\S]*\}/);
    if (m) node = JSON.parse(m[0]);
  }
  return node || {};
}

function missingOf(cfg) {
  return KEYS.filter(([k]) => {
    const v = cfg[k];
    return v === undefined || v === null || String(v).trim() === "" || String(v).startsWith("PASTE_");
  }).map(([, envName]) => envName);
}

function fb(args) {
  return execFileSync("firebase", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function resolveWebAppId() {
  const parsed = JSON.parse(fb(["apps:list", "WEB", "--project", PROJECT_ID, "--json"]));
  const apps = parsed.result || parsed || [];
  const web = apps.find((a) => String(a.platform || "").toUpperCase() === "WEB") || apps[0];
  if (!web) throw new Error("no WEB app found in project " + PROJECT_ID);
  return web.appId;
}

const argv = process.argv.slice(2);
const mode = argv[0] || "--from-cli";

try {
  if (mode === "--from-env") {
    const cfg = {};
    for (const [k, envName] of KEYS) cfg[k] = process.env[envName] ?? "";
    const missing = missingOf(cfg);
    if (missing.length) {
      writeConfig(PLACEHOLDER);
      console.log("missing: " + missing.join(" "));
      process.exit(0);
    }
    writeConfig(cfg);
    console.log("written");
    process.exit(0);
  }

  let payload;
  if (mode === "--from-sdkconfig") {
    const file = argv[1];
    if (!file) { console.log("missing: --from-sdkconfig <file>"); process.exit(1); }
    payload = JSON.parse(readFileSync(file, "utf8"));
  } else {
    const appId = argv.includes("--app-id") ? argv[argv.indexOf("--app-id") + 1] : resolveWebAppId();
    payload = JSON.parse(fb(["apps:sdkconfig", "WEB", appId, "--project", PROJECT_ID, "--json"]));
  }

  const cfg = extract(payload);
  const missing = missingOf(cfg);
  if (missing.length) {
    writeConfig(PLACEHOLDER);
    console.log("missing: " + missing.join(" "));
    process.exit(1);
  }

  writeConfig(cfg);
  // Local-only env file for `gh secret set -f`. Gitignored via .secrets/.
  mkdirSync(dirname(ENV_OUT), { recursive: true });
  writeFileSync(ENV_OUT, KEYS.map(([k, e]) => `${e}=${cfg[k]}`).join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  console.log("written");
} catch (err) {
  // Never surface the payload; only the failure reason.
  console.log("missing: " + (err && err.message ? err.message.split("\n")[0] : "unknown error"));
  process.exit(1);
}
