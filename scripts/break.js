// D&D Amigos Connector — scripts/break.js
//
// The Break Room. The GM starts a break (a preset or any number of minutes); the game pauses,
// a small panel at the top of the screen counts down and lists every player as Back, Away or
// Offline, each player presses "I'm back" when they return, and the game unpauses when the
// break ends (everyone back, time up and the GM presses End, or the GM ends it early).
//
//   /break [minutes]   GM: start a break (no number opens the picker)
//   /brb  /back        players: step away / return, during a break
//   openBreakMenu()    the "Break" entry in the D&D Amigos menu
//
// State lives in a world setting (breakState), so reloading mid-break puts the panel back as
// it was. Players cannot write world settings, so they report in over the module socket and
// the GM's client applies it. Every break is logged (breakLog) and announced with hooks, as
// groundwork for the rest of the session flow:
//
//   dndAmigosBreakStart(state)   dndAmigosBreakEnd(info)
//   dndAmigosPlayerAway(user, state)   dndAmigosPlayerBack(user, state)
//
// If the AFK Tavern module is active, this defers to it (its break room, its minigames): the
// menu entry and /break open AFK Tavern's break room instead, and nothing here shows. The
// "Break room" setting can force this one.

import { MODULE_ID, t, chatText } from './util.js';
import { openDialog, confirmDialog } from './windows.js';

const SOCKET = `module.${MODULE_ID}`;
const PRESETS = [5, 10, 15, 20, 30];
const MAX_MINUTES = 180;
const LOG_LIMIT = 200;
const STALE_AFTER_MS = 2 * 3600 * 1000; // a break that ended this long ago and was never closed is cleared on load

let panel = null;
let ticker = null;
let lastSeenKey = null; // which break this client last announced, so it announces each one once
let overDinged = null;

/* --------------------------------------------------------------------
   Settings
-------------------------------------------------------------------- */

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'breakState', {
    scope: 'world', config: false, type: Object, default: null,
    onChange: () => onStateChange(),
  });
  game.settings.register(MODULE_ID, 'breakLog', { scope: 'world', config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, 'breakProvider', {
    name: 'DNDAMIGOS.Break.Settings.Provider.Name',
    hint: 'DNDAMIGOS.Break.Settings.Provider.Hint',
    scope: 'world', config: true, type: String, default: 'auto',
    choices: {
      auto: 'DNDAMIGOS.Break.Settings.Provider.Auto',
      builtin: 'DNDAMIGOS.Break.Settings.Provider.Builtin',
    },
  });
  game.settings.register(MODULE_ID, 'breakAutoEnd', {
    name: 'DNDAMIGOS.Break.Settings.AutoEnd.Name',
    hint: 'DNDAMIGOS.Break.Settings.AutoEnd.Hint',
    scope: 'world', config: true, type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, 'breakSound', {
    name: 'DNDAMIGOS.Break.Settings.Sound.Name',
    hint: 'DNDAMIGOS.Break.Settings.Sound.Hint',
    scope: 'client', config: true, type: Boolean, default: true,
  });
});

/* --------------------------------------------------------------------
   State helpers
-------------------------------------------------------------------- */

const getState = () => game.settings.get(MODULE_ID, 'breakState');
const players = () => game.users.filter((u) => !u.isGM);
const isActiveGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;
const clockText = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function afkTavernApi() {
  const mod = game.modules.get('afk-tavern');
  return mod?.active && typeof mod.api?.openBreakRoom === 'function' ? mod.api : null;
}

function deferToAfkTavern() {
  return game.settings.get(MODULE_ID, 'breakProvider') === 'auto' && !!afkTavernApi();
}

/** 'back', 'away' or 'offline' for one player. Anyone not yet marked back counts as away. */
function statusOf(user, state) {
  if (!user.active) return 'offline';
  return state.away?.[user.id] === false ? 'back' : 'away';
}

const onlinePlayers = () => players().filter((u) => u.active);
const awayNames = (state) => onlinePlayers().filter((u) => statusOf(u, state) === 'away').map((u) => u.name);

function ding() {
  if (!game.settings.get(MODULE_ID, 'breakSound')) return;
  try {
    foundry.audio.AudioHelper.play({ src: CONFIG.sounds?.notification || 'sounds/notify.wav', volume: 0.7, autoplay: true, loop: false }, false);
  } catch (err) {
    // no sound is fine
  }
}

/* --------------------------------------------------------------------
   GM actions
-------------------------------------------------------------------- */

async function startBreak(minutes) {
  if (!game.user.isGM) return;
  const mins = Math.max(1, Math.min(MAX_MINUTES, Math.round(Number(minutes) || 0)));
  if (getState()?.active) {
    ui.notifications.info(t('DNDAMIGOS.Break.AlreadyRunning'));
    return;
  }
  const now = Date.now();
  const away = {};
  players().forEach((u) => { away[u.id] = true; }); // everyone starts away and presses "I'm back"
  const pausedByBreak = !game.paused;
  if (pausedByBreak) await game.togglePause(true, true);
  const state = { active: true, startedAt: now, endsAt: now + mins * 60000, minutes: mins, by: game.user.id, away, pausedByBreak };
  await game.settings.set(MODULE_ID, 'breakState', state);
  Hooks.callAll('dndAmigosBreakStart', state);
}

async function extendBreak(minutes) {
  const s = foundry.utils.deepClone(getState());
  if (!s?.active || !game.user.isGM) return;
  s.endsAt += minutes * 60000;
  s.minutes += minutes;
  await game.settings.set(MODULE_ID, 'breakState', s);
}

function ringBell() {
  game.socket.emit(SOCKET, { action: 'bell' });
  ding();
  ui.notifications.info(t('DNDAMIGOS.Break.BellRung'));
}

/** Ends the break: logs it, clears the state and, if the break paused the game, unpauses it. */
async function endBreak({ early = false } = {}) {
  const s = getState();
  if (!s?.active || !game.user.isGM) return;
  const endedAt = Date.now();
  const entry = { startedAt: s.startedAt, endedAt, plannedMinutes: s.minutes, early, stillAway: awayNames(s) };
  const log = [...(game.settings.get(MODULE_ID, 'breakLog') || []), entry].slice(-LOG_LIMIT);
  await game.settings.set(MODULE_ID, 'breakLog', log);
  await game.settings.set(MODULE_ID, 'breakState', null);
  if (s.pausedByBreak && game.paused) await game.togglePause(false, true);
  Hooks.callAll('dndAmigosBreakEnd', { ...s, ...entry });
}

async function endBreakWithCheck() {
  const s = getState();
  if (!s?.active) return;
  const away = awayNames(s);
  if (away.length) {
    const ok = await confirmDialog({
      title: t('DNDAMIGOS.Break.EndEarlyTitle'),
      content: `<p>${t('DNDAMIGOS.Break.EndEarlyBody', { names: foundry.utils.escapeHTML(away.join(', ')) })}</p>`,
    });
    if (!ok) return;
  }
  await endBreak({ early: away.length > 0 && Date.now() < s.endsAt });
}

/** The GM's client applies a player's report (players cannot write world settings). */
async function applyStatus(userId, away) {
  const s = foundry.utils.deepClone(getState());
  const user = game.users.get(userId);
  if (!s?.active || !user || user.isGM) return;
  s.away = { ...(s.away || {}), [userId]: !!away };
  await game.settings.set(MODULE_ID, 'breakState', s);
  Hooks.callAll(away ? 'dndAmigosPlayerAway' : 'dndAmigosPlayerBack', user, s);
  maybeAutoEnd(s);
}

let autoEndTimer = null;
function maybeAutoEnd(s) {
  if (!game.settings.get(MODULE_ID, 'breakAutoEnd') || autoEndTimer) return;
  const online = onlinePlayers();
  if (!online.length || online.some((u) => statusOf(u, s) !== 'back')) return;
  ui.notifications.info(t('DNDAMIGOS.Break.EveryoneBack'));
  autoEndTimer = setTimeout(async () => {
    autoEndTimer = null;
    const cur = getState();
    if (cur?.active && onlinePlayers().every((u) => statusOf(u, cur) === 'back')) await endBreak();
  }, 2500);
}

/* --------------------------------------------------------------------
   Player actions
-------------------------------------------------------------------- */

function reportStatus(away) {
  const s = getState();
  if (!s?.active || game.user.isGM) return;
  game.socket.emit(SOCKET, { action: 'status', userId: game.user.id, away: !!away });
}

function onSocket(data, senderId) {
  if (!data?.action) return;
  if (data.action === 'bell') {
    ding();
    if (!game.user.isGM) ui.notifications.info(t('DNDAMIGOS.Break.BellRung'));
    return;
  }
  // Only the one active GM client acts on a report, and only for the player who sent it.
  if (data.action === 'status' && isActiveGM() && senderId === data.userId) {
    applyStatus(String(data.userId), !!data.away);
  }
}

/* --------------------------------------------------------------------
   The panel
-------------------------------------------------------------------- */

function teardown() {
  clearInterval(ticker);
  ticker = null;
  panel?.remove();
  panel = null;
  overDinged = null;
}

function remainingText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function tick() {
  const s = getState();
  if (!s?.active || !panel) return;
  const left = s.endsAt - Date.now();
  const clock = panel.querySelector('.dab-clock');
  if (clock) clock.textContent = left > 0 ? remainingText(left) : t('DNDAMIGOS.Break.TimesUp');
  panel.classList.toggle('dab-over', left <= 0);
  if (left <= 0 && overDinged !== s.startedAt) {
    overDinged = s.startedAt;
    ding();
  }
}

function renderBreak() {
  const s = getState();
  if (!s?.active) {
    teardown();
    return;
  }
  if (deferToAfkTavern()) return;

  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'dnd-amigos-break';
    panel.setAttribute('role', 'status');
    panel.addEventListener('click', onPanelClick);
    document.body.append(panel);
  }
  const isGM = game.user.isGM;
  const me = statusOf(game.user, s);
  const roster = players().map((u) => {
    const st = statusOf(u, s);
    const label = t(`DNDAMIGOS.Break.Status.${st}`);
    return `<li class="dab-${st}${u.id === game.user.id ? ' dab-me' : ''}"><span class="dab-dot"></span><span class="dab-name">${foundry.utils.escapeHTML(u.name)}</span><em>${label}</em></li>`;
  }).join('');
  const buttons = isGM
    ? `<button type="button" data-action="extend"><i class="fa-solid fa-plus"></i> ${t('DNDAMIGOS.Break.Plus5')}</button>
       <button type="button" data-action="bell"><i class="fa-solid fa-bell"></i> ${t('DNDAMIGOS.Break.Bell')}</button>
       <button type="button" data-action="end" class="dab-end"><i class="fa-solid fa-flag-checkered"></i> ${t('DNDAMIGOS.Break.End')}</button>`
    : (me === 'back'
      ? `<button type="button" data-action="away"><i class="fa-solid fa-door-open"></i> ${t('DNDAMIGOS.Break.StepAway')}</button>`
      : `<button type="button" data-action="back" class="dab-primary"><i class="fa-solid fa-person-walking-arrow-loop-left"></i> ${t('DNDAMIGOS.Break.ImBack')}</button>`);
  panel.innerHTML = `
    <div class="dab-head">
      <i class="fa-solid fa-mug-hot"></i>
      <strong>${t('DNDAMIGOS.Break.Title')}</strong>
      <span class="dab-clock"></span>
      <span class="dab-until">${t('DNDAMIGOS.Break.BackAt', { time: clockText(s.endsAt) })}</span>
    </div>
    <ul class="dab-roster">${roster}</ul>
    <div class="dab-actions">${buttons}</div>`;
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
  tick();
}

function onPanelClick(ev) {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'back': reportStatus(false); break;
    case 'away': reportStatus(true); break;
    case 'extend': extendBreak(5); break;
    case 'bell': ringBell(); break;
    case 'end': endBreakWithCheck(); break;
    default: break;
  }
}

/** The world setting changed (a break started, someone reported, or it ended): redraw and announce. */
function onStateChange() {
  const s = getState();
  const key = s?.active ? `${s.startedAt}` : null;
  if (key && key !== lastSeenKey) {
    lastSeenKey = key;
    if (!deferToAfkTavern()) {
      ding();
      ui.notifications.info(t('DNDAMIGOS.Break.Started', { time: clockText(s.endsAt) }));
    }
  } else if (!key && lastSeenKey) {
    lastSeenKey = null;
    if (!deferToAfkTavern()) ui.notifications.info(t('DNDAMIGOS.Break.Over'));
  }
  renderBreak();
}

/* --------------------------------------------------------------------
   Entry points
-------------------------------------------------------------------- */

function openStartDialog() {
  openDialog({
    title: t('DNDAMIGOS.Break.StartTitle'),
    width: 360,
    content: `
      <p>${t('DNDAMIGOS.Break.StartBody')}</p>
      <div class="dab-presets">${PRESETS.map((m) => `<button type="button" data-min="${m}">${m} min</button>`).join('')}</div>
      <div class="form-group">
        <label>${t('DNDAMIGOS.Break.Custom')}</label>
        <input type="number" name="minutes" min="1" max="${MAX_MINUTES}" value="10" style="width:5em">
      </div>`,
    buttons: {
      start: {
        label: t('DNDAMIGOS.Break.Start'),
        icon: '<i class="fa-solid fa-mug-hot"></i>',
        callback: (html) => startBreak(html.find('[name="minutes"]').val()),
      },
      cancel: { label: t('Cancel') },
    },
    default: 'start',
    render: (html) => {
      html.find('[data-min]').on('click', (ev) => html.find('[name="minutes"]').val(ev.currentTarget.dataset.min));
    },
  });
}

/** The "Break" entry in the D&D Amigos menu. */
export function openBreakMenu() {
  if (deferToAfkTavern()) {
    const api = afkTavernApi();
    try {
      if (game.user.isGM) api.openBreakRoom();
      else (api.openTavernAsPlayer ?? api.openBreakRoom)();
    } catch (err) {
      console.warn(`${MODULE_ID} | AFK Tavern would not open`, err);
    }
    return;
  }
  const s = getState();
  if (s?.active) {
    renderBreak();
    ui.notifications.info(t('DNDAMIGOS.Break.AlreadyRunning'));
    return;
  }
  if (!game.user.isGM) {
    ui.notifications.info(t('DNDAMIGOS.Break.NoBreak'));
    return;
  }
  openStartDialog();
}

// "/break [minutes]", "/brb", "/back" — handled here and kept out of the normal chat.
Hooks.on('chatMessage', (chatLog, text) => {
  const match = /^\/(break|brb|back)(?:\s+(\d{1,3}))?\s*$/i.exec(chatText(text));
  if (!match) return true;
  const command = match[1].toLowerCase();
  if (command === 'break') {
    if (!game.user.isGM) ui.notifications.info(t('DNDAMIGOS.Break.GMOnly'));
    else if (deferToAfkTavern()) openBreakMenu();
    else if (match[2]) startBreak(Number(match[2]));
    else openBreakMenu();
    return false;
  }
  if (deferToAfkTavern()) {
    ui.notifications.info(t('DNDAMIGOS.Break.UseAfkTavern'));
    return false;
  }
  if (!getState()?.active) ui.notifications.info(t('DNDAMIGOS.Break.NoBreak'));
  else if (game.user.isGM) ui.notifications.info(t('DNDAMIGOS.Break.GMNoStatus'));
  else reportStatus(command === 'brb');
  return false;
});

Hooks.once('ready', () => {
  game.socket.on(SOCKET, onSocket);
  // A break nobody closed (the GM's browser died, say) is cleared once it is long past its end.
  const s = getState();
  if (s?.active && Date.now() > s.endsAt + STALE_AFTER_MS && isActiveGM()) {
    game.settings.set(MODULE_ID, 'breakState', null).then(() => { if (s.pausedByBreak && game.paused) game.togglePause(false, true); });
    return;
  }
  lastSeenKey = s?.active ? `${s.startedAt}` : null; // joining mid-break: show the panel, no announcement
  renderBreak();
});

// Players coming and going change who is Offline; the roster follows.
Hooks.on('userConnected', () => renderBreak());
Hooks.on('renderPlayers', () => renderBreak());
