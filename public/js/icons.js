// Inline stroke SVG icons, one per menu item. No emoji, no image requests.

const PATHS = {
  fuchka: '<circle cx="24" cy="28" r="14"></circle><path d="M16 23c4-3.5 12-3.5 16 0"></path><path d="M24 5v6M17 8l2.5 4.5M31 8l-2.5 4.5"></path>',
  momo: '<path d="M8 34c0-11 7-20 16-20s16 9 16 20z"></path><path d="M5 34h38"></path><path d="M24 14v7M18 16.5l3 5M30 16.5l-3 5"></path>',
  chat: '<path d="M5 23h38c0 10-8.5 18-19 18S5 33 5 23z"></path><circle cx="15" cy="17" r="3.5"></circle><circle cx="25" cy="14" r="3.5"></circle><circle cx="34" cy="17.5" r="3"></circle>',
  // The sweets: samosa_only is the samosa triangle, choc_strawberry the
  // strawberry (hotfix H1), marshmallow two stacked cylinders.
  sweet_box: '<path d="M7 18h34v22H7z"></path><path d="M5 12h38v6H5z"></path><path d="M24 12v28"></path><path d="M24 12c-4-1-8-2.5-8-5.5C16 4.5 17.5 3.5 19 4c2.5 1 4 4.5 5 8z"></path><path d="M24 12c4-1 8-2.5 8-5.5C32 4.5 30.5 3.5 29 4c-2.5 1-4 4.5-5 8z"></path>',
  samosa_only: '<path d="M24 7L42 37H6z"></path><path d="M15 29h18"></path><path d="M24 7v22"></path>',
  choc_strawberry: '<path d="M24 43c-9-5-14.5-13-12.5-22 3-4.5 22-4.5 25 0 2 9-3.5 17-12.5 22z"></path><path d="M17 15l7 4 7-4M24 19V7"></path><path d="M19 27v.5M29 27v.5M24 33v.5"></path>',
  marshmallow: '<path d="M11 14c0-2.5 5.8-4.5 13-4.5s13 2 13 4.5-5.8 4.5-13 4.5S11 16.5 11 14z"></path><path d="M11 14v8c0 2.5 5.8 4.5 13 4.5s13-2 13-4.5v-8"></path><path d="M11 26c0 2.5 5.8 4.5 13 4.5s13-2 13-4.5"></path><path d="M11 26v8c0 2.5 5.8 4.5 13 4.5s13-2 13-4.5v-8"></path>',
  // fallback: a plain plate
  unknown: '<circle cx="24" cy="24" r="17"></circle><circle cx="24" cy="24" r="9"></circle>'
};

/**
 * Markup for a menu-item icon at a given pixel size.
 * Decorative: always aria-hidden, the label sits next to it in the DOM.
 */
export function itemIcon(id, size = 48) {
  const body = PATHS[id] || PATHS.unknown;
  return `<svg class="icon" viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICON_IDS = Object.keys(PATHS).filter((k) => k !== 'unknown');
