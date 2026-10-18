// Landing page: three big buttons and the till letter setting.

import { el } from './ui.js';
import { href } from './router.js';
import { dayString, peekOrderNo } from './logic.js';

const TILL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function mountLanding(outlet, ctx) {
  const day = dayString();

  const nextNo = el('p', {
    class: 'setting-card__next',
    text: `Next order number on this device: ${peekOrderNo(ctx.settings.till, day)}`
  });

  const select = el('select', {
    id: 'till-letter-select',
    testid: 'till-letter',
    onchange: (e) => {
      ctx.setTill(e.target.value);
      nextNo.textContent = `Next order number on this device: ${peekOrderNo(ctx.settings.till, day)}`;
    }
  }, TILL_LETTERS.map((l) => el('option', { value: l, text: l })));
  select.value = ctx.settings.till;

  const main = el('main', { class: 'landing' }, [
    el('div', {}, [
      el('p', { class: 'landing__eyebrow', text: 'ONE SHARED LOGIN · ONE SHARED APP' }),
      el('h2', { text: 'Pick a screen' }),
      el('p', {
        class: 'landing__lede',
        text: 'The cash counter takes the order and payment. The food counter sees it straight away and works it through to collection. Reports add up the day.'
      })
    ]),
    el('div', { class: 'landing__grid' }, [
      el('a', { class: 'big-link', href: href('/cash'), testid: 'nav-cash' }, [
        el('strong', { text: 'Cash counter' }),
        el('span', { text: 'Build the order, take cash or card, send it to the kitchen' })
      ]),
      el('a', { class: 'big-link', href: href('/kitchen'), testid: 'nav-kitchen' }, [
        el('strong', { text: 'Food counter' }),
        el('span', { text: 'New, Preparing, Ready, Collected' })
      ]),
      el('a', { class: 'big-link', href: href('/reports'), testid: 'nav-reports' }, [
        el('strong', { text: 'Reports' }),
        el('span', { text: 'Daily totals, sales by item, peak demand, CSV export' })
      ])
    ]),
    el('section', { class: 'setting-card', 'aria-label': 'Till letter' }, [
      el('h2', { text: 'Till letter' }),
      el('p', { text: 'Give each till its own letter so order numbers never clash. This device keeps its letter until you change it.' }),
      el('label', { class: 'field-label', for: 'till-letter-select', text: 'Till letter for this device' }),
      select,
      nextNo
    ]),
    el('p', { class: 'landing__lede', text: `Today is ${day} (Europe/London).` })
  ]);

  outlet.appendChild(main);
  return () => { /* nothing to tear down */ };
}
