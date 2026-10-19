// P3-U-16..18 — the pure helpers login.js was refactored onto in Phase III.
// Spec: CLAUDE.md "Login and sign out" 2 ("username trimmed and case-insensitive;
// password exact. Compare crypto.subtle.digest('SHA-256', password) (hex) with
// loginPasswordSha256") and "Technical constraints" (all pure logic lives in
// logic.js so it is unit-testable).
//
// Nothing here contains a real credential: every value is an obvious fixture.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseUser, sha256Hex } from '../../public/js/logic.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('P3-U-16 normaliseUser', () => {
  it('trims and lower-cases, so the username is case-insensitive', () => {
    expect(normaliseUser('  Volunteer  ')).toBe('volunteer');
    expect(normaliseUser('VOLUNTEER')).toBe('volunteer');
    expect(normaliseUser('\tstall.lead\n')).toBe('stall.lead');
    expect(normaliseUser('volunteer')).toBe('volunteer');
  });

  it('never throws and never returns undefined', () => {
    expect(normaliseUser('')).toBe('');
    expect(normaliseUser(null)).toBe('');
    expect(normaliseUser(undefined)).toBe('');
    expect(() => normaliseUser(42)).not.toThrow();
  });

  it('does not touch the middle of a name', () => {
    expect(normaliseUser('a b')).toBe('a b');
  });
});

describe('P3-U-17 sha256Hex', () => {
  it('is the lower-case hex SHA-256 of the input', async () => {
    // Known vectors, so this pins the algorithm and the encoding, not the code.
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('password')).toBe('5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8');
  });

  it('is 64 lower-case hex characters and case-sensitive on its input', async () => {
    const a = await sha256Hex('Secret-Value-1');
    const b = await sha256Hex('secret-value-1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a, 'the password comparison must be exact, including case').not.toBe(b);
    // and whitespace matters: the password is never trimmed
    expect(await sha256Hex(' abc')).not.toBe(await sha256Hex('abc'));
  });
});

describe('P3-U-18 generated config files are never tracked', () => {
  it('version.js, login-config.js and firebase-config.js are not in git', () => {
    let files;
    try {
      files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch {
      return; // not a git repo; the pre-commit hook still guards commits
    }
    for (const generated of [
      'public/js/version.js',
      'public/js/login-config.js',
      'public/js/firebase-config.js'
    ]) {
      expect(files, `${generated} is generated and gitignored (CLAUDE.md Phase III part 2, 2)`).not.toContain(generated);
    }
    // and an example with placeholders exists beside each, so the shape stays
    // documented (it is Trinity's to commit, so only its presence is asserted)
    for (const example of [
      'public/js/version.example.js',
      'public/js/login-config.example.js',
      'public/js/firebase-config.example.js'
    ]) {
      expect(existsSync(resolve(ROOT, example)), `${example} must exist`).toBe(true);
    }
  });
});
