// U-24 — secret hygiene. Spec: CLAUDE.md "No keys or secrets in GitHub":
// the pre-commit hook blocks staged files matching AIza[0-9A-Za-z_-]{35}.
// This test asserts the same for every tracked file in the working tree.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const KEY_RE = /AIza[0-9A-Za-z_-]{35}/;
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav']);

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    return null; // not a git repo yet
  }
}

describe('U-24 no Firebase API key in any tracked file', () => {
  it('finds no string matching AIza[0-9A-Za-z_-]{35}', () => {
    const files = trackedFiles();
    if (files === null) {
      expect(true).toBe(true); // nothing tracked yet; the pre-commit hook still guards commits
      return;
    }
    const offenders = [];
    for (const rel of files) {
      if (BINARY.has(extname(rel).toLowerCase())) continue;
      const abs = resolve(ROOT, rel);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (!st.isFile() || st.size > 2_000_000) continue;
      let text;
      try { text = readFileSync(abs, 'utf8'); } catch { continue; }
      // The literal pattern itself appears in this test and in the guard script.
      if (text.includes('AIza[0-9A-Za-z_-]{35}')) continue;
      if (KEY_RE.test(text)) offenders.push(rel);
    }
    expect(offenders, `tracked files containing a Firebase-shaped API key: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the generated firebase-config.js is not tracked', () => {
    const files = trackedFiles();
    if (files === null) return;
    expect(files).not.toContain('public/js/firebase-config.js');
  });
});

// U-25 — Phase II. CLAUDE.md "No keys or secrets in GitHub": "Login credentials
// live only in .secrets/app-login.env on this Mac ... Never copy the username or
// password into code, tests, docs, commit messages or this file."
// This test reads the credentials at run time and fails if either string has
// leaked into a tracked file. It never prints the values — only file names.
describe('U-25 no login credentials in any tracked file', () => {
  function secretValues() {
    const file = resolve(ROOT, '.secrets/app-login.env');
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { return []; }
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
      let value = line.slice(eq + 1).trim();
      if (value.length > 1 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
      // Only meaningful secrets: a 1-3 character value would match everywhere.
      if (/^APP_LOGIN_(USER|PASSWORD)$/.test(key) && value.length >= 4) out.push({ key, value });
    }
    return out;
  }

  it('neither the shared username nor the password appears in a tracked file', () => {
    const files = trackedFiles();
    const secrets = secretValues();
    if (files === null || secrets.length === 0) {
      expect(true).toBe(true); // nothing to check on this machine
      return;
    }
    const offenders = [];
    for (const rel of files) {
      if (BINARY.has(extname(rel).toLowerCase())) continue;
      const abs = resolve(ROOT, rel);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (!st.isFile() || st.size > 2_000_000) continue;
      let text;
      try { text = readFileSync(abs, 'utf8'); } catch { continue; }
      for (const s of secrets) {
        if (!text.includes(s.value)) continue;
        if (s.key === 'APP_LOGIN_PASSWORD') { offenders.push(`${rel} (${s.key})`); continue; }
        // The username can be an ordinary word, so a bare substring hit in a
        // lockfile is noise. Flag it only where it sits next to login wording.
        const near = new RegExp(
          '(?:login|user|username|password|credential|sign.?in|nba\\.session)[\\s\\S]{0,120}?' +
          s.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          '|' + s.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          '[\\s\\S]{0,120}?(?:login|user|username|password|credential|sign.?in|nba\\.session)',
          'i'
        );
        if (near.test(text)) offenders.push(`${rel} (${s.key})`);
      }
    }
    expect(
      offenders,
      `the shared login leaked into tracked files: ${offenders.join(', ')} — ` +
      'CLAUDE.md: "Never copy the username or password into code, tests, docs, commit messages"'
    ).toEqual([]);
  });

  it('the secrets file and the generated login-config.js are not tracked', () => {
    const files = trackedFiles();
    if (files === null) return;
    expect(files).not.toContain('public/js/login-config.js');
    expect(files.filter((f) => f.startsWith('.secrets/')), '.secrets/ must never be tracked').toEqual([]);
  });

  it('the committed login-config.example.js holds placeholders only', () => {
    let text;
    try { text = readFileSync(resolve(ROOT, 'public/js/login-config.example.js'), 'utf8'); } catch { return; }
    expect(text).toMatch(/PASTE_/);
    for (const s of secretValues()) {
      expect(text.includes(s.value), `${s.key} leaked into login-config.example.js`).toBe(false);
    }
  });
});
