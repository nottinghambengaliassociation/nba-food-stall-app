/**
 * Run-time credential reader for the e2e suite.
 *
 * The shared login lives in the gitignored `.secrets/app-login.env`
 * (APP_LOGIN_USER / APP_LOGIN_PASSWORD) and is read here at run time.
 * The username and password are NEVER written into a test file, a fixture,
 * a screenshot, a log line or an assertion message — this repository is public.
 *
 * Everything in this module returns values; nothing in it prints them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = resolve(ROOT, '.secrets/app-login.env');
const LOGIN_CONFIG = resolve(ROOT, 'public/js/login-config.js');

function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (value.length > 1 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

let cached = null;

/**
 * { user, password, available } — `available` is false when the secrets file
 * is missing or incomplete, in which case the credential-dependent tests skip.
 */
export function creds() {
  if (cached) return cached;
  const env = readEnvFile(ENV_FILE);
  const user = env.APP_LOGIN_USER ?? process.env.APP_LOGIN_USER ?? '';
  const password = env.APP_LOGIN_PASSWORD ?? process.env.APP_LOGIN_PASSWORD ?? '';
  const ok = !!user && !!password && !user.startsWith('PASTE_') && !password.startsWith('PASTE_');
  cached = { user, password, available: ok };
  return cached;
}

/** The username only — also recoverable from the generated login-config.js. */
export function loginUser() {
  const c = creds();
  if (c.user) return c.user;
  return loginConfig().loginUser || '';
}

/** Parse the generated public/js/login-config.js without importing it. */
export function loginConfig() {
  if (!existsSync(LOGIN_CONFIG)) return { present: false, loginUser: '', loginPasswordSha256: '' };
  const src = readFileSync(LOGIN_CONFIG, 'utf8');
  const u = src.match(/loginUser\s*=\s*["'`]([^"'`]*)["'`]/);
  const h = src.match(/loginPasswordSha256\s*=\s*["'`]([^"'`]*)["'`]/);
  const loginUser = u ? u[1] : '';
  const loginPasswordSha256 = h ? h[1] : '';
  return {
    present: true,
    loginUser,
    loginPasswordSha256,
    placeholder: loginUser.startsWith('PASTE_') || loginPasswordSha256.startsWith('PASTE_')
  };
}

/** True when the app is configured well enough for a real sign-in to succeed. */
export function loginConfigured() {
  const cfg = loginConfig();
  return cfg.present && !cfg.placeholder && !!cfg.loginPasswordSha256;
}

/** An obviously fake password, safe to put in a log or a screenshot. */
export const WRONG_PASSWORD = 'not-the-password-xxx';

/** The committed placeholder body, used to exercise "Login not configured". */
export const PLACEHOLDER_CONFIG_BODY =
  'export const loginUser = "PASTE_USER";\n' +
  'export const loginPasswordSha256 = "PASTE_SHA256";\n';
