#!/usr/bin/env node
// fix-orders-p6a.mjs — one-off data correction, 20 October 2026.
//
// Two orders from 19 October carry a line that was mis-keyed at the till. The
// customer never received the item, so the sale should never have been recorded.
// Both orders are status "collected", and Phase V (CLAUDE.md) only lets the cash
// counter edit an order while it is new or preparing — there is no in-app route
// to correct a collected order. This script makes the correction from outside the
// app and records it in the documented Phase V edit shape (editCount, editedAtMs
// and a history entry), so Reports → Order history shows the before and after
// exactly as it would for an edit made at the till.
//
// Targets are addressed by DOCUMENT ID only, never by order number: order numbers
// restart each day and repeat, and this collection already holds duplicates for
// 2026-10-19 A-001 … A-007.
//
//   QV03AS98n12GF2JR7OBG   A-085, 2026-10-19, Sayondeep — drop the samosa_only line
//   lNFW6jjprlBGEbGuUJ6O   A-089, 2026-10-19, Sayantani — drop the chat line
//
// Order of work (never changes):
//   1. back up both documents in full to
//      .secrets/backups/fix-orders-p6a-<timestamp>.json  (gitignored).
//      If the backup fails for ANY reason, stop and change nothing.
//   2. correct each order in its own runTransaction, which re-reads the document
//      and refuses unless it still matches every expectation.
//
// Safety
//   * --yes is required. Without it this prints the plan and writes nothing at
//     all (not even a backup file).
//   * It refuses to run if the backup directory is not git-ignored.
//   * Every precondition is re-checked inside the transaction, so a document that
//     changed between the read and the write is skipped, never clobbered.
//   * Idempotent: a second run sees the work is done and writes nothing.
//   * It touches `orders` only — never `menu`, never `settings`, and no document
//     other than the two ids above.
//   * It never prints a config value or a secret.
//
// Usage
//   node scripts/fix-orders-p6a.mjs                    plan only, read-only
//   node scripts/fix-orders-p6a.mjs --yes              do it, against LIVE
//   node scripts/fix-orders-p6a.mjs --emulator         plan against the emulator
//   node scripts/fix-orders-p6a.mjs --emulator --yes   do it against the emulator

import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  runTransaction,
  terminate
} from 'firebase/firestore';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'public/js/firebase-config.js');
const BACKUP_DIR = resolve(ROOT, '.secrets/backups');
const EMULATOR_PROJECT = 'demo-food-stall';
const EMULATOR_DEFAULT = '127.0.0.1:8080';
const HISTORY_LIMIT = 10; // CLAUDE.md Phase V: keep the last 10 entries.

// The reason recorded on the history entry. Free text, shown in Order history.
const REASON =
  'Mis-keyed at the till on 19 Oct; the item was never handed over. Corrected by hand on 20 Oct (collected orders cannot be edited in the app).';

// The correction, stated in full so the transaction can check every part of it.
const TARGETS = [
  {
    docId: 'QV03AS98n12GF2JR7OBG',
    day: '2026-10-19',
    orderNo: 'A-085',
    expectTotal: 1000,
    removeItemId: 'samosa_only',
    removeItemQty: 1,
    removeItemPrice: 500,
    keepItemIds: ['fuchka'],
    newTotal: 500
  },
  {
    docId: 'lNFW6jjprlBGEbGuUJ6O',
    day: '2026-10-19',
    orderNo: 'A-089',
    expectTotal: 1000,
    removeItemId: 'chat',
    removeItemQty: 1,
    removeItemPrice: 500,
    keepItemIds: ['samosa_only'],
    newTotal: 500
  }
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

const money = (pence) => `£${(pence / 100).toFixed(2)}`;
const describeItems = (items) =>
  Array.isArray(items) && items.length
    ? items.map((i) => `${i.qty}x ${i.id} "${i.name}" @ ${i.price}p`).join(', ')
    : '(no items)';

// ---------------------------------------------------------------- connection

async function connect() {
  if (useEmulator) {
    const [host, portText] = emulatorHostPort.split(':');
    const port = Number(portText || 8080);
    const app = initializeApp(
      { projectId: EMULATOR_PROJECT, apiKey: 'demo' },
      `fix-orders-p6a-${Date.now()}`
    );
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
    fail(
      'public/js/firebase-config.js still holds PASTE_ placeholders. Run: node scripts/write-firebase-config.mjs'
    );
  }
  const app = initializeApp(config, `fix-orders-p6a-${Date.now()}`);
  // No config value is ever printed.
  return {
    db: getFirestore(app),
    target: 'LIVE project (config from public/js/firebase-config.js)',
    live: true
  };
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

function assertBackupDirIgnored() {
  // Belt and braces: the backup holds live order data, so refuse to write it
  // anywhere git would pick it up.
  const rel = relative(ROOT, BACKUP_DIR);
  try {
    execFileSync('git', ['check-ignore', '-q', `${rel}/`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    fail(
      `${rel}/ is not covered by .gitignore. Add ".secrets/" to .gitignore before running this. Nothing was changed.`
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

// Never overwrite an existing backup.
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
function writeBackup(docs, live) {
  assertBackupDirIgnored();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const path = freeBackupPath('fix-orders-p6a');

  const payload = {
    tool: 'fix-orders-p6a.mjs',
    note: 'Pre-correction backup of the two orders this script edits. Full documents, as read.',
    takenAt: new Date().toISOString(),
    target: live ? 'live' : 'emulator',
    counts: { orders: docs.length },
    collections: { orders: docs }
  };

  writeFileSync(path, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });

  // Verify: re-read and compare. Never print contents.
  const back = JSON.parse(readFileSync(path, 'utf8'));
  const got = Array.isArray(back.collections?.orders) ? back.collections.orders.length : -1;
  if (got !== docs.length) {
    fail(`backup verification failed (${got} of ${docs.length} documents). Nothing was changed.`);
  }
  for (const d of docs) {
    const mirrored = back.collections.orders.find((x) => x.id === d.id);
    const lines = Array.isArray(d.data?.items) ? d.data.items.length : -1;
    if (!mirrored || !Array.isArray(mirrored.data?.items) || mirrored.data.items.length !== lines) {
      fail(`backup verification failed for ${d.id}. Nothing was changed.`);
    }
  }
  return path;
}

// ------------------------------------------------------------------ checking

// The single source of truth for "may this document be corrected?". Used for the
// plan and again inside the transaction against the freshly re-read document.
// Returns { state: 'todo' | 'done' | 'blocked', why, ... }.
function assess(target, exists, data) {
  if (!exists) return { state: 'blocked', why: `document ${target.docId} does not exist` };

  const items = Array.isArray(data.items) ? data.items : [];
  const matching = items.filter((i) => i && i.id === target.removeItemId);

  // Already corrected? Recognised by the shape this script leaves behind.
  const alreadyEdited = typeof data.editCount === 'number' && data.editCount >= 1;
  if (alreadyEdited && matching.length === 0 && data.total === target.newTotal) {
    return {
      state: 'done',
      why: `already corrected (editCount ${data.editCount}, total ${data.total}p, no ${target.removeItemId} line)`
    };
  }
  if (alreadyEdited) {
    return {
      state: 'blocked',
      why: `editCount is already ${data.editCount} but the document does not look corrected (total ${data.total}p, ${matching.length} "${target.removeItemId}" line(s)). Left alone.`
    };
  }

  if (data.day !== target.day) {
    return { state: 'blocked', why: `day is "${data.day}", expected "${target.day}"` };
  }
  if (data.orderNo !== target.orderNo) {
    return { state: 'blocked', why: `orderNo is "${data.orderNo}", expected "${target.orderNo}"` };
  }
  if (data.total !== target.expectTotal) {
    return { state: 'blocked', why: `total is ${data.total}p, expected ${target.expectTotal}p` };
  }
  if (matching.length !== 1) {
    return {
      state: 'blocked',
      why: `expected exactly 1 "${target.removeItemId}" line, found ${matching.length}`
    };
  }
  const line = matching[0];
  if (line.qty !== target.removeItemQty) {
    return {
      state: 'blocked',
      why: `"${target.removeItemId}" line has qty ${line.qty}, expected ${target.removeItemQty}`
    };
  }
  if (line.price !== target.removeItemPrice) {
    return {
      state: 'blocked',
      why: `"${target.removeItemId}" line has price ${line.price}p, expected ${target.removeItemPrice}p`
    };
  }
  const remaining = items.filter((i) => i && i.id !== target.removeItemId);
  const remainingIds = remaining.map((i) => i.id).join(', ');
  if (remainingIds !== target.keepItemIds.join(', ')) {
    return {
      state: 'blocked',
      why: `remaining lines would be "${remainingIds}", expected "${target.keepItemIds.join(', ')}"`
    };
  }
  const remainingTotal = remaining.reduce((sum, i) => sum + i.qty * i.price, 0);
  if (remainingTotal !== target.newTotal) {
    return {
      state: 'blocked',
      why: `remaining lines come to ${remainingTotal}p, expected ${target.newTotal}p`
    };
  }

  return { state: 'todo', why: '', line, remaining, remainingTotal };
}

// --------------------------------------------------------------------- apply

async function correct(db, target) {
  const ref = doc(db, 'orders', target.docId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : null;
    const check = assess(target, snap.exists(), data || {});

    if (check.state !== 'todo') {
      return { written: false, state: check.state, why: check.why, before: data, after: data };
    }

    const atMs = Date.now();
    const entry = {
      atMs,
      action: 'edit',
      till: data.till,
      fromStatus: data.status,
      reason: REASON,
      before: {
        items: data.items,
        total: data.total,
        name: data.name,
        payment: data.payment
      },
      deltaPence: check.remainingTotal - data.total
    };
    const history = [...(Array.isArray(data.history) ? data.history : []), entry].slice(-HISTORY_LIMIT);

    // Only these five fields change. orderNo, till, day, name, payment, status,
    // createdAtMs, createdAt and every other timestamp are left untouched.
    tx.update(ref, {
      items: check.remaining,
      total: check.remainingTotal,
      editCount: (typeof data.editCount === 'number' ? data.editCount : 0) + 1,
      editedAtMs: atMs,
      history
    });

    return {
      written: true,
      state: 'todo',
      why: '',
      before: data,
      after: {
        ...data,
        items: check.remaining,
        total: check.remainingTotal,
        editCount: 1,
        editedAtMs: atMs,
        history
      },
      removedLine: check.line
    };
  });
}

// ---------------------------------------------------------------------- main

function printOrder(label, docId, data) {
  console.log(`  ${label}`);
  console.log(`    doc id   ${docId}`);
  console.log(
    `    order    ${data.orderNo} · ${data.day} · till ${data.till} · ${data.name} · ${data.status} · ${data.payment}`
  );
  console.log(`    items    ${describeItems(data.items)}`);
  console.log(`    total    ${data.total}p (${money(data.total)})`);
  console.log(
    `    edit     editCount=${data.editCount ?? '(absent)'} editedAtMs=${data.editedAtMs ?? '(absent)'} history=${
      Array.isArray(data.history) ? data.history.length + ' entry(ies)' : '(absent)'
    }`
  );
}

async function main() {
  const { db, target: targetName, live } = await connect();
  console.log(`fix-orders-p6a — target: ${targetName}`);
  console.log(APPLY ? 'Mode: APPLY (--yes given)' : 'Mode: plan only (no --yes, nothing is written)');
  console.log(`Documents addressed by id: ${TARGETS.map((t) => t.docId).join(', ')}`);
  console.log('');

  // Read both documents first, for the plan and for the backup.
  const read = [];
  for (const t of TARGETS) {
    const snap = await getDoc(doc(db, 'orders', t.docId));
    read.push({ target: t, exists: snap.exists(), data: snap.exists() ? snap.data() : null });
  }

  console.log('Read and plan');
  let todo = 0;
  let done = 0;
  let blocked = 0;
  for (const r of read) {
    const check = assess(r.target, r.exists, r.data || {});
    console.log(
      `  ${r.target.orderNo} (${r.target.docId}) — ${check.state.toUpperCase()}${check.why ? ': ' + check.why : ''}`
    );
    if (r.exists) {
      printOrder('now', r.target.docId, r.data);
      if (check.state === 'todo') {
        const removed = r.target.removeItemPrice * r.target.removeItemQty;
        console.log(
          `    remove   ${r.target.removeItemQty}x ${r.target.removeItemId} @ ${r.target.removeItemPrice}p = ${removed}p (${money(removed)})`
        );
        console.log(`    becomes  ${describeItems(check.remaining)}`);
        console.log(
          `    total    ${r.data.total}p -> ${check.remainingTotal}p (${money(r.data.total)} -> ${money(check.remainingTotal)})`
        );
        console.log('    writes   items, total, editCount=1, editedAtMs, history[+1 edit entry]');
      }
    }
    console.log('');
    if (check.state === 'todo') todo += 1;
    else if (check.state === 'done') done += 1;
    else blocked += 1;
  }

  if (!APPLY) {
    console.log(
      `Plan only: ${todo} to correct, ${done} already corrected, ${blocked} blocked. Nothing was backed up or written.`
    );
    console.log(todo ? 'Re-run with --yes to apply it.' : 'Nothing left to do.');
    await terminate(db);
    return;
  }

  if (todo === 0) {
    console.log(
      `Nothing to do: ${done} already corrected, ${blocked} blocked. No backup written, no document changed.`
    );
    await terminate(db);
    return;
  }

  // 1. Backup first. Any failure here throws and nothing below runs.
  const present = read.filter((r) => r.exists);
  const backupPath = writeBackup(
    present.map((r) => ({ id: r.target.docId, data: plain(r.data) })),
    live
  );
  console.log(`Backup  ${relative(ROOT, backupPath)} (${present.length} document(s), full)`);
  console.log('');

  // 2. Correct each order in its own transaction.
  const results = [];
  for (const t of TARGETS) {
    try {
      const res = await correct(db, t);
      results.push({ target: t, ...res });
      if (res.written) {
        console.log(`${t.orderNo} — corrected`);
        printOrder('before', t.docId, res.before);
        printOrder('after ', t.docId, res.after);
      } else {
        console.log(`${t.orderNo} — not written (${res.state}): ${res.why}`);
      }
    } catch (err) {
      results.push({
        target: t,
        written: false,
        state: 'error',
        why: err && err.message ? err.message : String(err)
      });
      console.log(`${t.orderNo} — not written (error): ${err && err.message ? err.message : err}`);
    }
    console.log('');
  }

  // Read back so the summary reports what Firestore actually holds now.
  console.log('Now in Firestore');
  for (const t of TARGETS) {
    const snap = await getDoc(doc(db, 'orders', t.docId));
    if (!snap.exists()) {
      console.log(`  ${t.orderNo} — document missing`);
      continue;
    }
    printOrder(`${t.orderNo}`, t.docId, snap.data());
  }

  const written = results.filter((r) => r.written).length;
  console.log('');
  console.log('Summary');
  console.log(`  backup file        ${relative(ROOT, backupPath)}`);
  console.log(`  orders corrected   ${written} of ${TARGETS.length}`);
  console.log(`  orders skipped     ${results.length - written}`);
  console.log('  collections        orders only — menu and settings untouched');

  await terminate(db);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`fix-orders-p6a failed: ${err && err.message ? err.message : err}`);
    console.error('Nothing further was changed.');
    process.exit(1);
  });
