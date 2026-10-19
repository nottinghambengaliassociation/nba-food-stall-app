// The only module that talks to Firebase.
// Everything else in the app works with plain objects.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

import { MENU, ACTIVE_MENU } from './logic.js';

const EMULATOR_PROJECT = 'demo-food-stall';
const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8080;

/** Status the UI renders: 'loading' | 'ready' | 'unconfigured' | 'error'. */
export const status = {
  state: 'loading',
  message: '',
  mode: 'emulator' // 'emulator' | 'live'
};

let db = null;
let startPromise = null;

const connection = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  queued: 0
};
const connectionListeners = new Set();

function isLocalHost() {
  if (typeof location === 'undefined') return false;
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
}

function useEmulator() {
  if (!isLocalHost()) return false;
  const params = new URLSearchParams(location.search || '');
  return params.get('live') !== '1';
}

function makeDb(app) {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (err) {
    console.warn('Persistent cache unavailable, falling back to memory cache', err);
    return getFirestore(app);
  }
}

/** Start Firebase. Resolves to true when Firestore is usable. */
export function start() {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    try {
      if (useEmulator()) {
        const app = initializeApp({ projectId: EMULATOR_PROJECT, apiKey: 'demo' });
        db = makeDb(app);
        connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT);
        status.mode = 'emulator';
      } else {
        let config = null;
        try {
          const mod = await import('./firebase-config.js');
          config = mod.firebaseConfig || mod.default || null;
        } catch {
          config = null;
        }
        if (!config || !isConfigured(config)) {
          status.state = 'unconfigured';
          status.message = 'Storage not configured';
          return false;
        }
        const app = initializeApp(config);
        db = makeDb(app);
        status.mode = 'live';
      }
      status.state = 'ready';
      watchBrowserConnection();
      return true;
    } catch (err) {
      console.error('Firebase failed to start', err);
      status.state = 'error';
      status.message = 'Storage not configured';
      return false;
    }
  })();
  return startPromise;
}

function isConfigured(config) {
  const values = Object.values(config || {});
  if (!values.length) return false;
  return values.every((v) => typeof v === 'string' && v.length > 0 && !v.startsWith('PASTE_'));
}

export function isReady() {
  return status.state === 'ready' && !!db;
}

/* ---------------------------------------------------------- connection pill */

function watchBrowserConnection() {
  if (typeof window === 'undefined') return;
  const update = () => {
    connection.online = navigator.onLine !== false;
    emitConnection();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}

function emitConnection() {
  for (const fn of connectionListeners) {
    try { fn({ ...connection }); } catch (err) { console.error(err); }
  }
}

/** Subscribe to { online, queued }. Returns an unsubscribe function. */
export function onConnection(fn) {
  connectionListeners.add(fn);
  fn({ ...connection });
  return () => connectionListeners.delete(fn);
}

function setQueued(n) {
  if (connection.queued === n) return;
  connection.queued = n;
  emitConnection();
}

/* ----------------------------------------------------------------- menu */

/** Write the seed items (including the retired ones) if the menu collection is empty. Safe to call repeatedly. */
export async function seedMenuIfEmpty() {
  if (!isReady()) return false;
  const snap = await getDocs(collection(db, 'menu'));
  if (!snap.empty) return false;
  const batch = writeBatch(db);
  for (const item of MENU) {
    const { id, ...rest } = item;
    batch.set(doc(db, 'menu', id), rest);
  }
  await batch.commit();
  return true;
}

/**
 * Live menu, active items only. Falls back to the seed list if Firestore has
 * nothing yet.
 *
 * Seeding the collection makes the listener fire a burst of part-finished
 * snapshots (one per document as the cache catches up with the server), so
 * the callback is coalesced: only the settled snapshot reaches the till and
 * the tiles are not rebuilt under a volunteer's finger.
 */
const MENU_SETTLE_MS = 120;

export function watchMenu(callback) {
  if (!isReady()) {
    callback(ACTIVE_MENU.slice());
    return () => {};
  }
  let timer = null;
  let pending = null;
  const emit = () => {
    timer = null;
    const items = pending;
    pending = null;
    if (items) callback(items);
  };
  const queue = (items) => {
    pending = items;
    if (timer) clearTimeout(timer);
    timer = setTimeout(emit, MENU_SETTLE_MS);
  };
  const stop = onSnapshot(
    collection(db, 'menu'),
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((m) => m.active !== false)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.id.localeCompare(b.id));
      queue(items.length ? items : ACTIVE_MENU.slice());
    },
    (err) => {
      console.error('menu listener failed', err);
      queue(ACTIVE_MENU.slice());
    }
  );
  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}

/* --------------------------------------------------------------- orders */

/**
 * Live orders for one Europe/London day.
 * Single-field query only: filtering and sorting happen on the client.
 */
export function watchOrders(day, callback) {
  if (!isReady()) {
    callback([]);
    return () => {};
  }
  const q = query(collection(db, 'orders'), where('day', '==', day));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      let queued = 0;
      const orders = snap.docs.map((d) => {
        if (d.metadata.hasPendingWrites) queued += 1;
        return { id: d.id, ...d.data() };
      });
      setQueued(queued);
      orders.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      callback(orders);
    },
    (err) => {
      console.error('orders listener failed', err);
      callback([]);
    }
  );
}

/**
 * Write a new order. Deliberately not awaited by callers: offline the promise
 * only settles once the server acknowledges, and the till must never wait.
 */
export function createOrder(order) {
  if (!isReady()) return Promise.reject(new Error('Storage not configured'));
  const payload = {
    ...order,
    createdAt: serverTimestamp()
  };
  return addDoc(collection(db, 'orders'), payload);
}

const STATUS_STAMP = {
  preparing: 'startedAtMs',
  ready: 'readyAtMs',
  collected: 'collectedAtMs',
  cancelled: 'cancelledAtMs'
};

/** Move an order to a new status, stamping the matching time. */
export function setOrderStatus(id, nextStatus, nowMs = Date.now()) {
  if (!isReady()) return Promise.reject(new Error('Storage not configured'));
  const patch = { status: nextStatus };
  const stamp = STATUS_STAMP[nextStatus];
  if (stamp) patch[stamp] = nowMs;
  return updateDoc(doc(db, 'orders', id), patch);
}

/** Undo: put the status back without re-stamping. */
export function revertOrderStatus(id, previousStatus) {
  if (!isReady()) return Promise.reject(new Error('Storage not configured'));
  return updateDoc(doc(db, 'orders', id), { status: previousStatus });
}

export function cancelOrder(id) {
  return setOrderStatus(id, 'cancelled');
}

/** One-off read of a day's orders (reports screen). */
export async function fetchOrders(day) {
  if (!isReady()) return [];
  const q = query(collection(db, 'orders'), where('day', '==', day));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * One-off read of every order in an inclusive day range (Sales by day report).
 * Both filters are on `day`, a single field, so no composite index is needed.
 */
export async function fetchOrdersInRange(from, to) {
  if (!isReady()) return [];
  const q = query(
    collection(db, 'orders'),
    where('day', '>=', from),
    where('day', '<=', to)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.day).localeCompare(String(b.day)) || (a.createdAtMs || 0) - (b.createdAtMs || 0));
}

/**
 * settings/event = { name, from, to }, edited in the Firebase console.
 * Returns null when the document is missing or unusable: the "This event"
 * quick button is then hidden (CLAUDE.md Phase III 2).
 */
export async function fetchEvent() {
  if (!isReady()) return null;
  try {
    const snap = await getDoc(doc(db, 'settings', 'event'));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const from = typeof data.from === 'string' ? data.from : '';
    const to = typeof data.to === 'string' ? data.to : '';
    if (!from || !to) return null;
    return { name: typeof data.name === 'string' && data.name ? data.name : 'This event', from, to };
  } catch (err) {
    console.error('event settings read failed', err);
    return null;
  }
}
