// D&D Amigos Connector — scripts/eyffo.js
//
// Play E.Y.F.F.O. from Foundry, mostly for breaks. E.Y.F.F.O. is a website game, so "playing it
// from Foundry" means opening the site in a pop-up window beside the game:
//
//   openEyffo()   opens (or re-uses) one pop-up window and signs it in. The module asks the site
//                 for a one-time sign-in link with the player's personal token
//                 (api/foundry/eyffo-link.php); the window follows it and lands on the game
//                 already logged in. A player with no personal token, or a site that is
//                 unreachable, just gets the site's normal game page (its sign-in screen).
//
// It shows up in three places: the D&D Amigos menu, a button on this module's Break Room panel
// (break.js), and, when the AFK Tavern module is active, as a game card in AFK Tavern's break
// room (a small window with the hero's level, HP, gold and turns left, and a Play button).
//
// The pop-up is opened inside the click that asked for it, before any network call, so the
// browser's pop-up blocker lets it through; it shows a short "connecting" line until the link
// arrives. main.js hands over its API helpers through configureEyffo().

import { MODULE_ID, esc, t } from './util.js';

const WINDOW_NAME = 'dnd-amigos-eyffo';
const GAME_ID = 'dnd-amigos-eyffo';
const WINDOW_FEATURES = 'popup=yes,width=1000,height=760';

let deps = null;

export function configureEyffo(d) {
  deps = d;
}

const siteBase = () => String(game.settings.get(MODULE_ID, 'siteUrl') ?? '').trim().replace(/\/+$/, '');

/** True when the module knows a site address (the Play buttons are hidden until then). */
export const eyffoAvailable = () => !!siteBase();

export async function openEyffo() {
  const base = siteBase();
  if (!base) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  // Must happen synchronously inside the click, or the browser's pop-up blocker refuses it.
  const win = window.open('', WINDOW_NAME, WINDOW_FEATURES);
  if (!win) {
    ui.notifications.warn(t('DNDAMIGOS.Eyffo.PopupBlocked'));
    return;
  }
  try {
    win.document.title = 'E.Y.F.F.O.';
    win.document.body.style.cssText = 'margin:0;padding:2em;background:#000;color:#33ff66;font-family:monospace;';
    win.document.body.textContent = t('DNDAMIGOS.Eyffo.Connecting');
  } catch (err) {
    // a window that was already on the site belongs to another origin; it is about to navigate anyway
  }

  let url = `${base}/engine/pages/game.php`;
  if (deps?.isConfigured()) {
    try {
      const link = await deps.apiRequest('eyffo-link.php', { method: 'POST', body: {} });
      url = `${base}${link.path}`;
    } catch (err) {
      // No personal token yet, or the site said no: the plain game page still works for anyone
      // already signed in to the site in this browser, and shows the sign-in screen otherwise.
      console.info(`${MODULE_ID} | no one-time sign-in link (${err.message}); opening the game page`);
    }
  }
  try {
    win.location.href = url;
    win.focus();
  } catch (err) {
    ui.notifications.warn(t('DNDAMIGOS.Eyffo.PopupBlocked'));
  }
}

/* --------------------------------------------------------------------
   AFK Tavern game card
-------------------------------------------------------------------- */

/**
 * The card AFK Tavern opens for this "game": a small window, not the game itself. It is built
 * when needed, because the Foundry window classes only exist once Foundry is up.
 */
function buildCardClass() {
  const { ApplicationV2 } = foundry.applications.api;
  return class EyffoCard extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: 'dnd-amigos-eyffo-card',
      classes: ['dnd-amigos-eyffo-card'],
      tag: 'section',
      window: { title: 'DNDAMIGOS.Eyffo.Title', icon: 'fa-solid fa-dungeon', resizable: false },
      position: { width: 340, height: 'auto' },
    };

    async _renderHTML() {
      let hero = '';
      try {
        const data = await deps.apiRequest(`persona.php?user_id=${deps.getMyUserId() ?? ''}`);
        const p = data.persona;
        hero = p && p.class_key
          ? `<h3>${esc(p.name)}</h3>
             <ul class="dae-stats">
               <li><span>${t('DNDAMIGOS.Eyffo.Level')}</span><strong>${esc(p.level)}</strong></li>
               <li><span>${t('DNDAMIGOS.Eyffo.HP')}</span><strong>${esc(p.hp_current)}/${esc(p.hp_max)}</strong></li>
               <li><span>${t('DNDAMIGOS.Eyffo.Gold')}</span><strong>${esc(p.gold)}</strong></li>
               <li><span>${t('DNDAMIGOS.Eyffo.Turns')}</span><strong>${esc(p.turns_remaining)}</strong></li>
             </ul>`
          : `<p>${t('DNDAMIGOS.Eyffo.NoHero')}</p>`;
      } catch (err) {
        hero = `<p>${t('DNDAMIGOS.Eyffo.NoStats')}</p>`;
      }
      return `<p class="dae-blurb">${t('DNDAMIGOS.Eyffo.Blurb')}</p>${hero}
        <button type="button" data-action="play" class="dae-play"><i class="fa-solid fa-dungeon"></i> ${t('DNDAMIGOS.Eyffo.Play')}</button>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
      content.querySelector('[data-action="play"]')?.addEventListener('click', () => openEyffo());
    }
  };
}

/** Adds the card to AFK Tavern's break room, if that module is active and has its API up. */
function registerWithAfkTavern() {
  const mod = game.modules.get('afk-tavern');
  if (!mod?.active) return true; // nothing to register with
  if (typeof mod.api?.registerMinigame !== 'function') return false; // not ready yet; try again
  const Card = buildCardClass();
  mod.api.registerMinigame(GAME_ID, {
    label: t('DNDAMIGOS.Eyffo.Title'),
    icon: 'fa-solid fa-dungeon',
    description: t('DNDAMIGOS.Eyffo.Description'),
    appClass: Card,
    difficulties: [],
    category: 'classic',
    options: {
      // skip AFK Tavern's difficulty step: open the card, then tell its break room about it
      customLaunch: ({ onGameOpened } = {}) => {
        const app = new Card();
        app.render(true);
        if (typeof onGameOpened === 'function') onGameOpened(app, 340);
      },
    },
  });
  return true;
}

Hooks.once('ready', () => {
  // AFK Tavern puts its api up in its own ready hook, which may run after this one.
  let tries = 0;
  const attempt = () => {
    let done = false;
    try {
      done = registerWithAfkTavern();
    } catch (err) {
      console.warn(`${MODULE_ID} | could not add E.Y.F.F.O. to AFK Tavern`, err);
      done = true;
    }
    tries += 1;
    if (!done && tries < 20) setTimeout(attempt, 500);
  };
  attempt();
});
