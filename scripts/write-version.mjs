#!/usr/bin/env node
// write-version.mjs — generate public/js/version.js.
//
// This file is generated and gitignored, like the other config files. Nothing
// secret is involved: it holds the app version, the short commit SHA and the
// build date only. The script prints only "written".
//
//   node scripts/write-version.mjs
//       APP_VERSION from package.json, APP_BUILD from
//       `git rev-parse --short=7 HEAD` (with "-dirty" appended when the working
//       tree has uncommitted changes), APP_DATE today's Europe/London date.
//
//   In CI, GITHUB_SHA is set: APP_BUILD is its first 7 characters and "-dirty"
//   is never appended.
//
// If git is unavailable (no repository, no git binary), APP_BUILD falls back to
// "unknown" and the file is still written. The app imports version.js
// dynamically and shows "dev" everywhere if it is missing, so this never breaks
// a build.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/js/version.js");
const PKG = resolve(ROOT, "package.json");

const HEADER = `// GENERATED FILE — DO NOT COMMIT, DO NOT EDIT BY HAND.
// Written by scripts/write-version.mjs (locally) or by
// .github/workflows/pages.yml before the Pages upload (in CI).
// package.json "version" is the single source of truth for APP_VERSION.
`;

function render({ version, build, date }) {
  return (
    HEADER +
    `export const APP_VERSION = ${JSON.stringify(version)};\n` +
    `export const APP_BUILD = ${JSON.stringify(build)};\n` +
    `export const APP_DATE = ${JSON.stringify(date)};\n`
  );
}

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// CI: GITHUB_SHA, never "-dirty" (the runner's checkout is clean by definition).
// Local: short SHA plus "-dirty" when anything is uncommitted. "unknown" if git
// can't answer at all.
function buildId() {
  const ciSha = (process.env.GITHUB_SHA || "").trim();
  if (ciSha) return ciSha.slice(0, 7);
  try {
    const sha = git(["rev-parse", "--short=7", "HEAD"]).trim();
    if (!sha) return "unknown";
    const dirty = git(["status", "--porcelain"]).trim() !== "";
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

function londonDate() {
  // en-CA gives YYYY-MM-DD; the timeZone keeps the build date on London days.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

try {
  const version = String(JSON.parse(readFileSync(PKG, "utf8")).version || "0.0.0");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render({ version, build: buildId(), date: londonDate() }), "utf8");
  console.log("written");
} catch (err) {
  console.log("missing: " + (err && err.message ? err.message.split("\n")[0] : "unknown error"));
  process.exit(1);
}
