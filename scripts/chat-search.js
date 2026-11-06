// D&D Amigos Connector — scripts/chat-search.js
//
// Search the chat log. A search box sits above the chat (sidebar and pop-out). Type to filter; the
// sliders button adds a speaker or player, a from/to date and "rolls only". Clear it (the X, or
// Escape in the box) and the chat is back exactly as it was.
//
// How it works: Foundry's chat log only keeps the newest messages drawn (older ones are loaded as
// you scroll up), so the search looks through EVERY message this world has loaded (game.messages,
// the ones you are allowed to see), then draws the matches, newest 300 at most, in a list of its own
// next to the real chat. The messages in that list are drawn by Foundry's own message renderer, so
// they look and behave like normal chat messages (roll cards, buttons, right-click menu). The real
// chat log is only hidden while a search is active, so nothing in it is touched, and new messages
// that match show up in the results as they are posted.
//
// All the words typed must appear (in any order), anywhere in the message: what was said, the card's
// text (an attack or spell name), the speaker, the player, or a roll's formula. Matching words are
// highlighted in the results.

import { esc, t } from './util.js';

const MAX_RESULTS = 300;
const RENDER_CHUNK = 25;
const TYPING_DELAY_MS = 250;

/** Search state per chat window (the sidebar and the pop-out each have their own). */
const states = new WeakMap();
const blank = () => ({ text: '', who: '', from: '', to: '', rollsOnly: false, token: 0, shown: 0, total: 0 });

const isActive = (st) => !!(st.text.trim() || st.who || st.from || st.to || st.rollsOnly);
const terms = (st) => st.text.toLowerCase().split(/\s+/).filter(Boolean);

/* --------------------------------------------------------------------
   Matching
-------------------------------------------------------------------- */

const textCache = new WeakMap();

/** What the message says and shows, as one lower-case string. Cached until the message changes. */
function haystack(message) {
  const key = `${message._stats?.modifiedTime ?? ''}:${message.content?.length ?? 0}:${message.flavor?.length ?? 0}:${message.rolls?.length ?? 0}`;
  const cached = textCache.get(message);
  if (cached?.key === key) return cached.text;
  const plain = (html) => (html ? new DOMParser().parseFromString(String(html), 'text/html').body.textContent : '');
  const text = [
    plain(message.flavor),
    plain(message.content),
    message.alias,
    message.author?.name,
    ...(message.rolls ?? []).map((r) => `${r.formula ?? ''} ${r.total ?? ''}`),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').toLowerCase();
  textCache.set(message, { key, text });
  return text;
}

/** Does this message pass every filter in `st`? */
export function matches(message, st) {
  if (st.rollsOnly && !message.rolls?.length) return false;
  if (st.who) {
    const [kind, value] = [st.who.slice(0, 1), st.who.slice(2)];
    if (kind === 'u' && message.author?.id !== value) return false;
    if (kind === 'c' && message.alias !== value) return false;
  }
  if (st.from && message.timestamp < new Date(`${st.from}T00:00:00`).getTime()) return false;
  if (st.to && message.timestamp > new Date(`${st.to}T23:59:59.999`).getTime()) return false;
  const words = terms(st);
  if (words.length) {
    const text = haystack(message);
    if (!words.every((w) => text.includes(w))) return false;
  }
  return true;
}

const visibleMessages = () => game.messages.contents.filter((m) => m.visible).sort((a, b) => a.timestamp - b.timestamp);

/* --------------------------------------------------------------------
   Drawing
-------------------------------------------------------------------- */

async function renderOne(message) {
  const ChatLog = ui.chat?.constructor;
  if (typeof ChatLog?.renderMessage === 'function') return ChatLog.renderMessage(message);
  if (typeof message.renderHTML === 'function') return message.renderHTML();
  const html = await message.getHTML();
  return html[0] ?? html;
}

/** Wraps each searched word in <mark> inside the message text (not in buttons or inputs). */
function highlight(element, words) {
  if (!words.length) return;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('button, input, textarea, select, script, style, mark') || !node.nodeValue.trim()
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!pattern.test(node.nodeValue)) continue;
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    node.nodeValue.split(pattern).forEach((piece, i) => {
      if (i % 2 === 1) {
        const mark = document.createElement('mark');
        mark.className = 'dah-hit';
        mark.textContent = piece;
        frag.append(mark);
      } else if (piece) frag.append(document.createTextNode(piece));
    });
    node.replaceWith(frag);
  }
}

function setStatus(root, st, text) {
  const status = root.querySelector('.dah-status');
  if (!status) return;
  status.textContent = text;
  status.hidden = !text;
}

const countText = (st) => (st.shown === 0
  ? t('DNDAMIGOS.ChatSearch.None')
  : t(st.total > st.shown ? 'DNDAMIGOS.ChatSearch.Capped' : 'DNDAMIGOS.ChatSearch.Found', { count: st.total, shown: st.shown }));

/** Runs the search for one chat window and draws the results (or restores the normal chat). */
async function runSearch(root) {
  const st = states.get(root);
  const wrap = root.querySelector('.dah-results-wrap');
  const scroll = root.querySelector('.chat-scroll');
  if (!st || !wrap || !scroll) return;
  const list = wrap.querySelector('ol');
  const active = isActive(st);
  root.querySelector('.dah-clear').hidden = !active;
  wrap.classList.toggle('dah-hidden', !active);
  scroll.classList.toggle('dah-hidden', active);
  if (!active) {
    st.token += 1;
    list.replaceChildren();
    setStatus(root, st, '');
    return;
  }

  const token = ++st.token;
  setStatus(root, st, t('DNDAMIGOS.ChatSearch.Searching'));
  const all = visibleMessages();
  const found = all.filter((m) => matches(m, st));
  const shownMessages = found.slice(-MAX_RESULTS);
  const elements = [];
  for (let i = 0; i < shownMessages.length; i += RENDER_CHUNK) {
    const chunk = await Promise.all(shownMessages.slice(i, i + RENDER_CHUNK).map((m) => renderOne(m).catch(() => null)));
    if (token !== st.token) return; // a newer search started
    elements.push(...chunk.filter(Boolean));
  }
  const words = terms(st);
  elements.forEach((el) => highlight(el, words));
  list.replaceChildren(...elements);
  st.shown = elements.length;
  st.total = found.length;
  setStatus(root, st, countText(st));
  wrap.scrollTop = wrap.scrollHeight;
}

/* --------------------------------------------------------------------
   The search box
-------------------------------------------------------------------- */

function whoOptions() {
  const aliases = new Set();
  for (const m of game.messages) if (m.visible && m.alias) aliases.add(m.alias);
  const players = game.users.map((u) => `<option value="u:${esc(u.id)}">${esc(u.name)}</option>`).join('');
  const characters = [...aliases].sort((a, b) => a.localeCompare(b)).map((a) => `<option value="c:${esc(a)}">${esc(a)}</option>`).join('');
  return `<option value="">${t('DNDAMIGOS.ChatSearch.Anyone')}</option>
    <optgroup label="${t('DNDAMIGOS.ChatSearch.Players')}">${players}</optgroup>
    <optgroup label="${t('DNDAMIGOS.ChatSearch.Characters')}">${characters}</optgroup>`;
}

function attach(app) {
  const root = app?.element?.[0] ?? app?.element;
  const scroll = root?.querySelector?.('.chat-scroll');
  if (!scroll) return;
  if (!states.has(root)) states.set(root, blank());
  const st = states.get(root);

  // The window's parts can be redrawn; the box and the results list are added once and re-found after.
  let bar = root.querySelector('.dah-chatsearch');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'dah-chatsearch';
    bar.innerHTML = `
      <div class="dah-row">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="search" class="dah-q" placeholder="${esc(t('DNDAMIGOS.ChatSearch.Placeholder'))}" autocomplete="off">
        <button type="button" class="dah-toggle" title="${esc(t('DNDAMIGOS.ChatSearch.Filters'))}"><i class="fa-solid fa-sliders"></i></button>
        <button type="button" class="dah-clear" title="${esc(t('DNDAMIGOS.ChatSearch.Clear'))}" hidden><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="dah-filters" hidden>
        <label>${t('DNDAMIGOS.ChatSearch.Who')} <select class="dah-who"></select></label>
        <label>${t('DNDAMIGOS.ChatSearch.From')} <input type="date" class="dah-from"></label>
        <label>${t('DNDAMIGOS.ChatSearch.To')} <input type="date" class="dah-to"></label>
        <label class="dah-check"><input type="checkbox" class="dah-rolls"> ${t('DNDAMIGOS.ChatSearch.RollsOnly')}</label>
      </div>
      <div class="dah-status" hidden></div>`;
    scroll.before(bar);

    const q = bar.querySelector('.dah-q');
    const who = bar.querySelector('.dah-who');
    const filters = bar.querySelector('.dah-filters');
    let timer = null;
    const go = () => runSearch(root);
    q.addEventListener('input', () => {
      st.text = q.value;
      clearTimeout(timer);
      timer = setTimeout(go, TYPING_DELAY_MS);
    });
    q.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') clearAll();
      ev.stopPropagation(); // typing here must not trigger Foundry's keybindings
    });
    who.addEventListener('change', () => { st.who = who.value; go(); });
    bar.querySelector('.dah-from').addEventListener('change', (ev) => { st.from = ev.target.value; go(); });
    bar.querySelector('.dah-to').addEventListener('change', (ev) => { st.to = ev.target.value; go(); });
    bar.querySelector('.dah-rolls').addEventListener('change', (ev) => { st.rollsOnly = ev.target.checked; go(); });
    bar.querySelector('.dah-toggle').addEventListener('click', () => {
      filters.hidden = !filters.hidden;
      if (!filters.hidden) who.innerHTML = whoOptions().replace(`value="${st.who}"`, `value="${st.who}" selected`);
    });
    const clearAll = () => {
      Object.assign(st, { text: '', who: '', from: '', to: '', rollsOnly: false });
      q.value = '';
      bar.querySelector('.dah-from').value = '';
      bar.querySelector('.dah-to').value = '';
      bar.querySelector('.dah-rolls').checked = false;
      who.value = '';
      go();
    };
    bar.querySelector('.dah-clear').addEventListener('click', clearAll);
  }

  if (!root.querySelector('.dah-results-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'dah-results-wrap dah-hidden';
    wrap.innerHTML = '<ol class="chat-log plain themed theme-light dah-results"></ol>';
    scroll.after(wrap);
  }
  if (isActive(st)) runSearch(root); // the window was redrawn while a search was on
}

/* --------------------------------------------------------------------
   Keeping results current
-------------------------------------------------------------------- */

const chatRoots = () => [ui.chat?.element, ui.chat?.popout?.element].filter((el) => el && states.has(el));
const activeRoots = () => chatRoots().filter((root) => isActive(states.get(root)));

Hooks.on('renderChatLog', (app) => attach(app));

// A new message that matches joins the results as it is posted.
Hooks.on('createChatMessage', async (message) => {
  for (const root of activeRoots()) {
    const st = states.get(root);
    if (!message.visible || !matches(message, st)) continue;
    const el = await renderOne(message).catch(() => null);
    const list = root.querySelector('.dah-results');
    if (!el || !list) continue;
    highlight(el, terms(st));
    list.append(el);
    while (list.children.length > MAX_RESULTS) list.firstElementChild.remove();
    st.total += 1;
    st.shown = list.children.length;
    setStatus(root, st, countText(st));
    const wrap = root.querySelector('.dah-results-wrap');
    wrap.scrollTop = wrap.scrollHeight;
  }
});

Hooks.on('deleteChatMessage', (message) => {
  for (const root of activeRoots()) {
    const el = root.querySelector(`.dah-results [data-message-id="${message.id}"]`);
    if (!el) continue;
    el.remove();
    const st = states.get(root);
    st.total = Math.max(0, st.total - 1);
    st.shown = root.querySelector('.dah-results').children.length;
    setStatus(root, st, countText(st));
  }
});

// An edited message may now match, or stop matching: redo the search shortly.
let updateTimer = null;
Hooks.on('updateChatMessage', () => {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => activeRoots().forEach((root) => runSearch(root)), 500);
});
