#!/usr/bin/env node
// reset-live.mjs — Hotfix H3 (v1.3.1) live data reset, CLAUDE.md "Hotfix H3" item 7.
//
// The system is not in use and holds no real orders, so H3 clears the live
// database and puts the menu back to exactly the 7-item table in CLAUDE.md.
//
// Order of work (never changes):
//   1. back up every document in orders, menu and settings to
//      .secrets/backups/live-<timestamp>.json  (gitignored).
//      If the backup fails for ANY reason, stop and change nothing.
//   2. delete every document in `orders`
//   3. make `menu` exactly the 7-item table: write all 7 documents in full,
//      delete every other menu document (samosa, straw, fountain, anything else)
//   4. leave `settings` completely alone
//
// Safety
//   * --yes is required. Without it this prints the plan and writes nothing at
//     all (not even a backup file).
//   * It refuses to run if the backup directory is not git-ignored.
//   * It prints counts and document ids only — never document contents, never a
//     config value, never a secret.
//   * Safe to re-run: a second run deletes nothing new and rewrites the same 7
//     menu documents.
//
// Usage
//   node scripts/reset-live.mjs                    plan only, read-only
//   node scripts/reset-live.mjs --yes              do it, against LIVE
//   node scripts/reset-live.mjs --emulator         plan against the emulator
//   node scripts/reset-live.mjs --emulator --yes   do it against the emulator
//   node scripts/reset-live.mjs --emulator 127.0.0.1:8081 --yes

import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDocs,
  writeBatch,
  terminate
} from 'firebase/firestore';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'public/js/firebase-config.js');
const BACKUP_DIR = resolve(ROOT, '.secrets/backups');
const EMULATOR_PROJECT = 'demo-food-stall';
const EMULATOR_DEFAULT = '127.0.0.1:8080';
const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch; leave headroom.

const FIELDS = ['name', 'short', 'price', 'colour', 'station', 'active', 'sort'];

// The whole menu from v1.3.1 — the table in CLAUDE.md. 7 items, nothing else.
const MENU = [
  { id: 'fuchka',          name: 'Fuchka / Gol Gappa',         short: 'Fuchka',           price: 500, colour: '#FDE68A', station: 'chaat',  active: true, sort: 1 },
  { id: 'momo',            name: 'Momo',                       short: 'Momo',             price: 500, colour: '#BFDBFE', station: 'momo',   active: true, sort: 2 },
  { id: 'chat',            name: 'Papri Chat',                 short: 'Papri Chat',       price: 500, colour: '#FECACA', station: 'chaat',  active: true, sort: 3 },
  { id: 'sweet_box',       name: 'Sweet Box',                  short: 'Sweet Box',        price: 500, colour: '#FED7AA', station: 'sweets', active: true, sort: 4 },
  { id: 'samosa_only',     name: 'Samosa',                     short: 'Samosa',           price: 500, colour: '#D9F99D', station: 'sweets', active: true, sort: 5 },
  { id: 'choc_strawberry', name: 'Chocolate Strawberry',       short: 'Choc Strawberry',  price: 500, colour: '#E9D5FF', station: 'sweets', active: true, sort: 6 },
  { id: 'marshmallow',     name: 'Chocolate Marshmallow (V)',  short: 'Choc Marshmallow', price: 500, colour: '#FBCFE8', station: 'sweets', active: true, sort: 7 }
];

const argv = process.argv.slice(2);
const APPLY = argv.includes('--yes');
const useEmulator = argv.includes('--emulator');
let emulatorHostPort = EMULATOR_DEFAULT;
if (useEmulator) {
  const next = argv[argv.indexOf('--emulator') + 1];
  if (next && !next.startsWith('--')) emulatorHostPort = next;
}
const unknown = argv.filter((a) => a.startsWith('--') && a !== '--yes' && a !== '--emulator');
if (unknown.length) {
  console.error(`Unknown flag: ${unknown.join(' ')}. Use --yes and/or --emulator [host:port].`);
  process.exit(2);
}

function fail(message) {
  const err = new Error(message);
  err.handled = true;
  throw err;
}

// ---------------------------------------------------------------- connection

async function connect() {
  if (useEmulator) {
    const [host, portText] = emulatorHostPort.split(':');
    const port = Number(portText || 8080);
    const app = initializeApp({ projectId: EMULATOR_PROJECT, apiKey: 'demo' }, `reset-live-${Date.now()}`);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, host, port);
    return { db, target: `emulator ${host}:${port} (project ${EMULATOR_PROJECT})`, live: false };
  }
  if (!existsSync(CONFIG_PATH)) {
    fail('public/js/firebase-config.js is missing. Run: node scripts/write-firebase-config.mjs');
  }
  const mod = await import(pathToFileURL(CONFIG_PATH).href);
  const config = mod.firebaseConfig;
  if (!config || typeof config !== 'object') {
    fail('public/js/firebase-config.js does not export firebaseConfig');
  }
  if (Object.values(config).some((v) => String(v).startsWith('PASTE_'))) {
    fail('public/js/firebase-config.js still holds PASTE_ placeholders. Run: node scripts/write-firebase-config.mjs');
  }
  const app = initializeApp(config, `reset-live-${Date.now()}`);
  // No config value is ever printed.
  return { db: getFirestore(app), target: 'LIVE project (config from public/js/firebase-config.js)', live: true };
}

// -------------------------------------------------------------------- backup

// Firestore Timestamps and other SDK objects are turned into plain JSON so the
// backup can be read back by a human or a restore script.
function plain(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function' && typeof value.seconds === 'number') {
      return {
        __type: 'timestamp',
        seconds: value.seconds,
        nanoseconds: value.nanoseconds ?? 0,
        iso: value.toDate().toISOString()
      };
    }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
    }
    if (typeof value.path === 'string' && typeof value.id === 'string') {
      return { __type: 'reference', path: value.path };
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

async function readCollection(db, name) {
  const snap = await getDocs(collection(db, name));
  const docs = [];
  snap.forEach((d) => docs.push({ id: d.id, data: plain(d.data() || {}) }));
  return docs;
}

function assertBackupDirIgnored() {
  // Belt and braces: the backup holds live order data, so refuse to write it
  // anywhere git would pick it up.
  const rel = relative(ROOT, BACKUP_DIR);
  try {
    execFileSync('git', ['check-ignore', '-q', `${rel}/`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    fail(
      `${rel}/ is not covered by .gitignore. Add ".secrets/" to .gitignore before running the reset. Nothing was changed.`
    );
  }
}

function timestampSlug() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` +
    `${p(d.getUTCMilliseconds(), 3)}Z`
  );
}

// Never overwrite an existing backup. Two runs in the same millisecond get a
// -2, -3 … suffix rather than an error.
function freeBackupPath(prefix) {
  const base = `${prefix}-${timestampSlug()}`;
  for (let n = 1; n <= 50; n += 1) {
    const path = resolve(BACKUP_DIR, n === 1 ? `${base}.json` : `${base}-${n}.json`);
    if (!existsSync(path)) return path;
  }
  fail('could not find a free backup file name. Nothing was changed.');
  return '';
}

// Writes the backup and reads it straight back to prove it is on disk and
// parses. Any failure throws, and the caller changes nothing.
function writeBackup(snapshot, live) {
  assertBackupDirIgnored();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const path = freeBackupPath(live ? 'live' : 'emulator');

  const payload = {
    tool: 'reset-live.mjs',
    hotfix: 'H3 v1.3.1',
    takenAt: new Date().toISOString(),
    target: live ? 'live' : 'emulator',
    counts: {
      orders: snapshot.orders.length,
      menu: snapshot.menu.length,
      settings: snapshot.settings.length
    },
    collections: {
      orders: snapshot.orders,
      menu: snapshot.menu,
      settings: snapshot.settings
    }
  };

  writeFileSync(path, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });

  // Verify: re-read and compare counts. Never print contents.
  const back = JSON.parse(readFileSync(path, 'utf8'));
  for (const name of ['orders', 'menu', 'settings']) {
    const got = Array.isArray(back.collections?.[name]) ? back.collections[name].length : -1;
    if (got !== snapshot[name].length) {
      fail(`backup verification failed for "${name}" (${got} of ${snapshot[name].length} documents). Nothing was changed.`);
    }
  }
  return path;
}

// --------------------------------------------------------------------- plan

function buildPlan(snapshot) {
  const wanted = new Set(MENU.map((m) => m.id));
  const menuIds = snapshot.menu.map((d) => d.id).sort();
  const menuToDelete = menuIds.filter((id) => !wanted.has(id));
  return {
    ordersToDelete: snapshot.orders.map((d) => d.id),
    menuToWrite: MENU.map((m) => m.id),
    menuToDelete,
    menuExisting: menuIds,
    settingsIds: snapshot.settings.map((d) => d.id).sort()
  };
}

function printPlan(snapshot, plan) {
  console.log('Read');
  console.log(`  orders    ${snapshot.orders.length} document(s)`);
  console.log(`  menu      ${snapshot.menu.length} document(s): ${plan.menuExisting.join(', ') || '(none)'}`);
  console.log(`  settings  ${snapshot.settings.length} document(s): ${plan.settingsIds.join(', ') || '(none)'}`);
  console.log('');
  console.log('Plan');
  console.log(`  backup    .secrets/backups/<target>-<timestamp>.json  (all three collections)`);
  console.log(`  delete    orders: all ${plan.ordersToDelete.length} document(s)`);
  if (plan.ordersToDelete.length && plan.ordersToDelete.length <= 20) {
    console.log(`            ids: ${plan.ordersToDelete.join(', ')}`);
  } else if (plan.ordersToDelete.length) {
    console.log(`            ids: ${plan.ordersToDelete.length} ids — listed in full in the backup file`);
  }
  console.log(`  write     menu: ${plan.menuToWrite.length} document(s) in full: ${plan.menuToWrite.join(', ')}`);
  console.log(`  delete    menu: ${plan.menuToDelete.length} document(s)${plan.menuToDelete.length ? ': ' + plan.menuToDelete.join(', ') : ''}`);
  console.log(`  untouched settings: ${snapshot.settings.length} document(s) left exactly as they are`);
  console.log('');
}

// -------------------------------------------------------------------- apply

async function deleteIds(db, collectionName, ids) {
  let done = 0;
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const id of chunk) batch.delete(doc(db, collectionName, id));
    await batch.commit();
    done += chunk.length;
  }
  return done;
}

async function writeMenu(db) {
  const batch = writeBatch(db);
  for (const item of MENU) {
    const data = {};
    for (const f of FIELDS) data[f] = item[f];
    batch.set(doc(db, 'menu', item.id), data); // full overwrite: H3 defines the menu
  }
  await batch.commit();
  return MENU.length;
}

// --------------------------------------------------------------------- main

async function main() {
  const { db, target, live } = await connect();
  console.log(`reset-live — target: ${target}`);
  console.log(APPLY ? 'Mode: APPLY (--yes given)' : 'Mode: plan only (no --yes, nothing is written)');
  console.log('');

  const snapshot = {
    orders: await readCollection(db, 'orders'),
    menu: await readCollection(db, 'menu'),
    settings: await readCollection(db, 'settings')
  };
  const plan = buildPlan(snapshot);
  printPlan(snapshot, plan);

  if (!APPLY) {
    console.log('Plan only: nothing was backed up, deleted or written.');
    console.log('Re-run with --yes to apply it.');
    await terminate(db);
    return;
  }

  // 1. Backup first. Any failure here throws and nothing below runs.
  const backupPath = writeBackup(snapshot, live);
  console.log(`  backed up ${snapshot.orders.length + snapshot.menu.length + snapshot.settings.length} document(s)`);
  console.log(`  backup    ${relative(ROOT, backupPath)}`);

  // 2. Orders.
  const ordersDeleted = await deleteIds(db, 'orders', plan.ordersToDelete);
  console.log(`  deleted   orders: ${ordersDeleted}`);

  // 3. Menu: write the 7, delete the rest.
  const menuWritten = await writeMenu(db);
  console.log(`  wrote     menu: ${menuWritten}`);
  const menuDeleted = await deleteIds(db, 'menu', plan.menuToDelete);
  console.log(`  deleted   menu: ${menuDeleted}`);

  // 4. settings: untouched by design.

  // Read back so the summary reports what Firestore actually holds now.
  const afterOrders = await getDocs(collection(db, 'orders'));
  const afterMenu = await getDocs(collection(db, 'menu'));
  const afterMenuIds = [];
  afterMenu.forEach((d) => afterMenuIds.push(d.id));
  afterMenuIds.sort();

  console.log('');
  console.log('Summary');
  console.log(`  backup file        ${relative(ROOT, backupPath)}`);
  console.log(`  orders deleted     ${ordersDeleted}`);
  console.log(`  menu written       ${menuWritten}`);
  console.log(`  menu deleted       ${menuDeleted}${plan.menuToDelete.length ? ' (' + plan.menuToDelete.join(', ') + ')' : ''}`);
  console.log(`  settings           ${snapshot.settings.length} document(s), untouched`);
  console.log('');
  console.log('Now in Firestore');
  console.log(`  orders    ${afterOrders.size} document(s)`);
  console.log(`  menu      ${afterMenuIds.length} document(s): ${afterMenuIds.join(', ')}`);
  if (afterOrders.size !== 0) {
    console.log('  NOTE: orders is not empty — an order was placed during the run. Re-run to clear it.');
  }
  if (afterMenuIds.length !== MENU.length) {
    console.log('  NOTE: menu does not hold exactly 7 documents. Re-run the script.');
  }

  await terminate(db);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`reset-live failed: ${err && err.message ? err.message : err}`);
    console.error('Nothing further was changed.');
    process.exit(1);
  });
