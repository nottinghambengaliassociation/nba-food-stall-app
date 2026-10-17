// Tiny DOM helpers. No framework, no build step.

/**
 * el('button', { class: 'tile', testid: 'tile-momo', onclick: fn }, ['Momo'])
 * Special keys: class, text, html, testid, on<event>, style, dataset.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'testid') node.setAttribute('data-testid', value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') node.setAttribute('style', value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
  return node;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

/** Icon wrapper that keeps the svg markup out of innerHTML churn. */
export function svgNode(markup) {
  const wrap = document.createElement('span');
  wrap.className = 'icon-wrap';
  wrap.innerHTML = markup;
  return wrap.firstElementChild || wrap;
}
