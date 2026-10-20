// menu-table.mjs — the one way a script gets the menu table.
//
// The table lives in exactly one place: the MENU seed in public/js/logic.js (the
// same table CLAUDE.md documents and the app seeds an empty Firestore with).
// logic.js is a plain ES module with no Firebase and no DOM imports, so node can
// import it directly. Adding an item to that seed is all it takes for menu-sync
// and reset-live to know about it — there is no second copy to keep in step.
//
// Ids are permanent and never reused — don't reuse samosa, straw or fountain.

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The fields a menu document holds, in the order CLAUDE.md lists them. */
export const FIELDS = ['name', 'short', 'price', 'colour', 'station', 'active', 'sort'];

/** Where the table is read from, for printing in a plan. */
export const MENU_SOURCE = 'public/js/logic.js';

const LOGIC_PATH = resolve(ROOT, MENU_SOURCE);

/**
 * Read the menu table from public/js/logic.js.
 *
 * Validates what it imports rather than trusting it: a missing or empty MENU, a
 * row with no id, a duplicate id or a row missing one of the seven fields throws
 * before a caller opens a connection. A typo in the seed should fail loudly on a
 * dry run, not half-write a document to live.
 *
 * Returns a plain array of { id, ...FIELDS }; anything else in the seed is ignored.
 */
export async function loadMenuTable() {
  if (!existsSync(LOGIC_PATH)) {
    throw new Error(`${MENU_SOURCE} is missing: there is no menu table to work from.`);
  }
  let mod;
  try {
    mod = await import(pathToFileURL(LOGIC_PATH).href);
  } catch (err) {
    throw new Error(`could not import ${MENU_SOURCE}: ${err && err.message ? err.message : err}`);
  }
  const menu = mod.MENU;
  if (!Array.isArray(menu) || !menu.length) {
    throw new Error(`${MENU_SOURCE} does not export a non-empty MENU array.`);
  }
  const seen = new Set();
  return menu.map((raw, i) => {
    const id = raw && typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) throw new Error(`MENU[${i}] in ${MENU_SOURCE} has no id.`);
    if (seen.has(id)) throw new Error(`MENU in ${MENU_SOURCE} lists "${id}" twice.`);
    seen.add(id);
    const absent = FIELDS.filter((f) => raw[f] === undefined);
    if (absent.length) {
      throw new Error(`MENU entry "${id}" in ${MENU_SOURCE} is missing: ${absent.join(', ')}`);
    }
    const item = { id };
    for (const f of FIELDS) item[f] = raw[f];
    return item;
  });
}
