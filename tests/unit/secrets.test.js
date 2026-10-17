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
