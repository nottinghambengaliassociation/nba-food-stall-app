#!/usr/bin/env node
// menu-sync.mjs — bring the Firestore `menu` collection in line with the menu
// table. General-purpose and idempotent: run it after any menu edit to create
// documents that are missing.
//
// The table is read from the MENU seed in public/js/logic.js (via menu-table.mjs)
// — the single source of truth for the menu. This script keeps no copy of its own.
//
// Uses the Firebase web SDK and the generated public/js/firebase-config.js, the
// same config the deployed app uses. It never prints a config value.
//
// What it does
//   * creates any menu document from the table that is missing
//   * fills in a field that is absent from an existing document
//   * NEVER overwrites a field that already holds a different value — a price or a
//     colour may have been edited in the Firebase console on purpose. It reports
//     the difference and leaves the stored value alone.
//   * NEVER deletes or renames a document. A document that is not in the table is
//     reported as "extra" and left exactly as it is. (The one-off H3 clean-out of
//     retired ids is scripts/reset-live.mjs, not this script.)
//   * is idempotent: a second run writes nothing.
//
// Usage
//   node scripts/menu-sync.mjs --dry-run      print the plan, write nothing
//   node scripts/menu-sync.mjs                apply the plan to the live project
//   node scripts/menu-sync.mjs --emulator     run against the local Firestore
//                                             emulator (127.0.0.1:8080,
//                                             project demo-food-stall) for testing
//   node scripts/menu-sync.mjs --emulator 127.0.0.1:8081 --dry-run
//
// Every write happens inside a transaction that re-checks the stored value first,
// so a document that changed between the read and the write is skipped, not
// clobbered.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

import { FIELDS, MENU_SOURCE, loadMenuTable } from './menu-table.mjs';

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDocs,
  runTransaction,
  terminate
} from 'firebase/firestore';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'public/js/firebase-config.js');
const COLLECTION = 'menu';
const EMULATOR_PROJECT = 'demo-food-stall';
const EMULATOR_DEFAULT = '127.0.0.1:8080';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const useEmulator = argv.includes('--emulator');
let emulatorHostPort = EMULATOR_DEFAULT;
if (useEmulator) {
  const next = argv[argv.indexOf('--emulator') + 1];
  if (next && !next.startsWith('--')) emulatorHostPort = next;
}
const unknown = argv.filter((a) => a.startsWith('--') && a !== '--dry-run' && a !== '--emulator');
if (unknown.length) {
  console.error(`Unknown flag: ${unknown.join(' ')}. Use --dry-run and/or --emulator [host:port].`);
  process.exit(2);
}

function same(field, stored, wanted) {
  if (field === 'colour' && typeof stored === 'string' && typeof wanted === 'string') {
    return stored.trim().toUpperCase() === wanted.trim().toUpperCase();
  }
  return stored === wanted;
}

function show(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

async function connect() {
  if (useEmulator) {
    const [host, portText] = emulatorHostPort.split(':');
    const port = Number(portText || 8080);
    const app = initializeApp({ projectId: EMULATOR_PROJECT, apiKey: 'demo' }, `menu-sync-${Date.now()}`);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, host, port);
    return { db, target: `emulator ${host}:${port} (project ${EMULATOR_PROJECT})` };
  }
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      'public/js/firebase-config.js is missing. Run: node scripts/write-firebase-config.mjs'
    );
  }
  const mod = await import(pathToFileURL(CONFIG_PATH).href);
  const config = mod.firebaseConfig;
  if (!config || typeof config !== 'object') {
    throw new Error('public/js/firebase-config.js does not export firebaseConfig');
  }
  const placeholder = Object.values(config).some((v) => String(v).startsWith('PASTE_'));
  if (placeholder) {
    throw new Error(
      'public/js/firebase-config.js still holds PASTE_ placeholders. Run: node scripts/write-firebase-config.mjs'
    );
  }
  const app = initializeApp(config, `menu-sync-${Date.now()}`);
  // No value from the config is ever printed.
  return { db: getFirestore(app), target: 'LIVE project (config from public/js/firebase-config.js)' };
}

async function readMenu(db) {
  const snap = await getDocs(collection(db, COLLECTION));
  const map = new Map();
  snap.forEach((d) => map.set(d.id, d.data() || {}));
  return map;
}

// Work out everything to do without writing anything.
function buildPlan(stored, menu) {
  const creates = [];
  const updates = [];   // fields absent from an existing document
  const differs = [];   // present, different, not ours to change
  const matches = [];
  const extras = [];

  for (const want of menu) {
    const have = stored.get(want.id);
    if (!have) {
      const data = {};
      for (const f of FIELDS) data[f] = want[f];
      creates.push({ id: want.id, data });
      continue;
    }
    let touched = false;
    for (const field of FIELDS) {
      const current = have[field];
      const wanted = want[field];
      if (current === undefined) {
        updates.push({ id: want.id, field, from: undefined, to: wanted, reason: 'field absent' });
        touched = true;
        continue;
      }
      if (same(field, current, wanted)) continue;
      // Present and different: a deliberate console edit as far as this script
      // knows. Report it, never clobber it.
      differs.push({ id: want.id, field, stored: current, table: wanted });
      touched = true;
    }
    if (!touched) matches.push(want.id);
  }

  const known = new Set(menu.map((m) => m.id));
  for (const id of stored.keys()) if (!known.has(id)) extras.push(id);

  return { creates, updates, differs, matches, extras };
}

function printPlan(plan, storedCount) {
  console.log(`Read ${storedCount} document(s) in "${COLLECTION}".`);
  console.log('');
  console.log('Plan');
  if (!plan.creates.length && !plan.updates.length) {
    console.log('  nothing to do — menu already matches the table');
  }
  for (const c of plan.creates) {
    console.log(`  create   ${c.id.padEnd(16)} ${c.data.name} (sort ${c.data.sort}, active ${c.data.active})`);
  }
  for (const u of plan.updates) {
    const from = u.from === undefined ? '<absent>' : show(u.from);
    console.log(`  update   ${(u.id + '.' + u.field).padEnd(16)} ${from} -> ${show(u.to)}   [${u.reason}]`);
  }
  for (const d of plan.differs) {
    console.log(
      `  differs  ${(d.id + '.' + d.field).padEnd(16)} stored ${show(d.stored)}, table ${show(d.table)} — left alone`
    );
  }
  for (const id of plan.extras) {
    console.log(`  extra    ${id.padEnd(16)} not in the table — left alone, never deleted`);
  }
  if (plan.matches.length) {
    console.log(`  ok       ${plan.matches.length} document(s) already correct: ${plan.matches.join(', ')}`);
  }
  console.log('');
}

async function applyCreate(db, item) {
  const ref = doc(db, COLLECTION, item.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return 'raced';     // appeared since the read: leave it alone
    tx.set(ref, item.data);
    return 'created';
  });
}

async function applyUpdate(db, u) {
  const ref = doc(db, COLLECTION, u.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return 'missing';
    const current = (snap.data() || {})[u.field];
    if (same(u.field, current, u.to)) return 'already';
    const expected = u.from;
    const changedUnderUs = expected === undefined ? current !== undefined : !same(u.field, current, expected);
    if (changedUnderUs) return 'raced';    // someone edited it: report, do not clobber
    tx.update(ref, { [u.field]: u.to });
    return 'changed';
  });
}

async function main() {
  const menu = await loadMenuTable();
  const { db, target } = await connect();
  console.log(`menu-sync — target: ${target}`);
  console.log(`Menu table: ${MENU_SOURCE} — ${menu.length} item(s) to ensure`);
  console.log(`  ${menu.map((m) => m.id).join(', ')}`);
  console.log(DRY_RUN ? 'Mode: dry run (no writes)' : 'Mode: apply');
  console.log('');

  const stored = await readMenu(db);
  const plan = buildPlan(stored, menu);
  printPlan(plan, stored.size);

  let created = 0;
  let changed = 0;
  let skipped = 0;
  const problems = [];

  if (DRY_RUN) {
    console.log('Dry run: nothing was written.');
  } else if (!plan.creates.length && !plan.updates.length) {
    console.log('No writes needed.');
  } else {
    for (const c of plan.creates) {
      const result = await applyCreate(db, c);
      if (result === 'created') {
        created += 1;
        console.log(`  created  ${c.id}`);
      } else {
        skipped += 1;
        problems.push(`${c.id}: appeared in Firestore during the run, left as it is`);
      }
    }
    for (const u of plan.updates) {
      const result = await applyUpdate(db, u);
      const label = `${u.id}.${u.field}`;
      if (result === 'changed') {
        changed += 1;
        console.log(`  changed  ${label} -> ${show(u.to)}`);
      } else if (result === 'already') {
        skipped += 1;
        console.log(`  skipped  ${label} already ${show(u.to)}`);
      } else {
        skipped += 1;
        problems.push(`${label}: changed in Firestore during the run, left as it is`);
      }
    }
  }

  console.log('');
  console.log('Summary');
  console.log(`  created  ${DRY_RUN ? plan.creates.length + ' (planned)' : created}`);
  console.log(`  changed  ${DRY_RUN ? plan.updates.length + ' field(s) (planned)' : changed + ' field(s)'}`);
  console.log(`  skipped  ${DRY_RUN ? plan.matches.length + ' document(s) already correct' : skipped + ' (already correct or changed under us)'}`);
  console.log(`  differs  ${plan.differs.length} field(s) left alone (stored value kept)`);
  console.log(`  deleted  0 (this script never deletes)`);
  if (plan.differs.length) {
    console.log('');
    console.log('Differences left alone — change them in the Firebase console if they are wrong:');
    for (const d of plan.differs) {
      console.log(`  ${d.id}.${d.field}: stored ${show(d.stored)}, table says ${show(d.table)}`);
    }
  }
  if (problems.length) {
    console.log('');
    console.log('Needs a second look:');
    for (const p of problems) console.log(`  ${p}`);
  }

  await terminate(db);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`menu-sync failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
