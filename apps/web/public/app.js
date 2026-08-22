import { el, sections, views } from './views.js';

const nav = document.querySelector('#nav');
const hero = document.querySelector('#hero');
const cards = document.querySelector('#cards');
const viewRoot = document.querySelector('#view');
const titleEl = document.querySelector('#title');
const statusEl = document.querySelector('#status');
const tenantSelect = document.querySelector('#tenant');

for (const [id, label, description] of sections) {
  const card = el('article', { class: 'card' });
  card.append(
    el('h3', { text: label }),
    el('p', { text: description }),
    el('span', { class: 'badge', text: views[id] ? 'live surface' : 'canonical' })
  );
  cards.append(card);
}

function currentTenant() {
  return (tenantSelect && tenantSelect.value) || 'tenant-acme';
}

let renderToken = 0;

async function route() {
  const id = location.hash.slice(1) || 'overview';
  const section = sections.find(([candidate]) => candidate === id) || sections[0];
  titleEl.textContent = section[1];
  for (const link of nav.querySelectorAll('a')) {
    if (link.getAttribute('href') === `#${section[0]}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const token = ++renderToken;
  const view = views[section[0]];
  if (!view) {
    hero.hidden = false;
    cards.hidden = false;
    viewRoot.hidden = true;
    viewRoot.replaceChildren();
    return;
  }
  hero.hidden = true;
  cards.hidden = true;
  viewRoot.hidden = false;
  viewRoot.replaceChildren(el('p', { class: 'note', text: 'Loading…' }));
  const ctx = {
    tenant: currentTenant,
    refresh: () => {
      if (token === renderToken) void route();
    }
  };
  const body = el('div', { class: 'view-body' });
  try {
    await view.render(body, ctx);
  } catch {
    body.replaceChildren(el('p', { class: 'error', text: 'This surface failed to load. Retry shortly.' }));
  }
  if (token !== renderToken) return;
  viewRoot.replaceChildren(body);
}

window.addEventListener('hashchange', route);
if (tenantSelect) tenantSelect.addEventListener('change', route);
route();

fetch('/healthz', { credentials: 'same-origin' })
  .then((response) => response.json().then((json) => ({ ok: response.ok, json })))
  .then(({ ok }) => { statusEl.textContent = `API status: ${ok ? 'healthy' : 'unavailable'}`; })
  .catch(() => { statusEl.textContent = 'API status: unavailable'; });
