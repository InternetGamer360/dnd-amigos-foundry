// D&D Amigos Connector — scripts/main.js
//
// Everything in this module is a deliberate, click-triggered action.
// There are no hooks on gameplay events (combat, updateActor, etc.) —
// only *render* hooks (renderActorSheet, renderJournalDirectory) that
// place a button when a window/sidebar is drawn. The button click is
// what does anything; opening a sheet or the sidebar never talks to
// the site on its own.

import { configureLore, pullLore, describePull, pushLore, openLoreDialog } from './lore.js';
import { openDialog, confirmDialog, MenuWindow } from './windows.js';
import { configureNethys, openNethysWindow } from './nethys.js';
import { configureStash, openStashWindow } from './stash.js';
import { configureSessionSync, openSessionSync } from './session-sync.js';
import { MODULE_ID, esc as attr } from './util.js';


// NPCs & Places (scripts/lore.js) gets the pieces of this file it needs handed to it,
// so the two files never import each other. These are all function declarations or
// settings read at call time, so wiring them up here is safe.
configureLore({ MODULE_ID, apiRequest, apiUploadFile, isConfigured, getMyUserId });
configureNethys({ MODULE_ID, apiRequest, isConfigured });
configureStash({ MODULE_ID, apiRequest, isConfigured });
configureSessionSync({ MODULE_ID, isConfigured, getMyUserId, syncCharacterCore });

/* --------------------------------------------------------------------
   Settings
-------------------------------------------------------------------- */

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'siteUrl', {
    name: 'DNDAMIGOS.Settings.SiteUrl.Name',
    hint: 'DNDAMIGOS.Settings.SiteUrl.Hint',
    scope: 'world',
    config: false,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, 'apiKey', {
    name: 'DNDAMIGOS.Settings.ApiKey.Name',
    hint: 'DNDAMIGOS.Settings.ApiKey.Hint',
    scope: 'world',
    config: false,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, 'journalId', {
    name: 'DNDAMIGOS.Settings.JournalId.Name',
    hint: 'DNDAMIGOS.Settings.JournalId.Hint',
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });

  game.settings.registerMenu(MODULE_ID, 'connectionMenu', {
    name: 'DNDAMIGOS.SettingsMenu.Name',
    label: 'DNDAMIGOS.SettingsMenu.Label',
    hint: 'DNDAMIGOS.SettingsMenu.Hint',
    icon: 'fa-solid fa-link',
    type: ConnectionSettingsMenu,
    restricted: true,
  });

  // Client-scoped (per-browser-profile, not per-world) so each player
  // picks their own site identity independently — there's still no
  // Foundry-user-to-site-user mapping otherwise, and this is what lets
  // Post Session Update and notes credit the right
  // person instead of everything landing under the GM's or DM's name.
  game.settings.register(MODULE_ID, 'myUserId', {
    name: 'DNDAMIGOS.Settings.MyUserId.Name',
    hint: 'DNDAMIGOS.Settings.MyUserId.Hint',
    scope: 'client',
    config: false,
    type: Number,
    default: 0,
  });

  // The black-and-red "&" button in the bottom-right corner of the game screen (placeCanvasButton()).
  game.settings.register(MODULE_ID, 'canvasButton', {
    name: 'DNDAMIGOS.Settings.CanvasButton.Name',
    hint: 'DNDAMIGOS.Settings.CanvasButton.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => placeCanvasButton(),
  });

  // Escape hatch: draw the module's windows with Foundry's old Dialog instead of the newer one.
  game.settings.register(MODULE_ID, 'legacyWindows', {
    name: 'DNDAMIGOS.Settings.LegacyWindows.Name',
    hint: 'DNDAMIGOS.Settings.LegacyWindows.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.registerMenu(MODULE_ID, 'identityMenu', {
    name: 'DNDAMIGOS.IdentityMenu.Name',
    label: 'DNDAMIGOS.IdentityMenu.Label',
    hint: 'DNDAMIGOS.IdentityMenu.Hint',
    icon: 'fa-solid fa-id-badge',
    type: IdentitySettingsMenu,
    restricted: false,
  });
});

function isConfigured() {
  return Boolean(
    game.settings.get(MODULE_ID, 'siteUrl') &&
    game.settings.get(MODULE_ID, 'apiKey') &&
    game.settings.get(MODULE_ID, 'journalId')
  );
}

function getMyUserId() {
  const id = Number(game.settings.get(MODULE_ID, 'myUserId')) || 0;
  return id || null;
}

/* --------------------------------------------------------------------
   First-run setup reminder — a GM installing this module for the first
   time has no reason to already know it needs a Site URL/API Key/
   Journal ID, or that it's read from engine/config.php on the website.
   This just surfaces that instead of leaving them to find the README.
   Purely informational (nothing here talks to the site) — it shows
   once per world load and stops on its own the moment the connection
   is actually configured, so it never nags a world that's already set
   up.
-------------------------------------------------------------------- */

Hooks.once('ready', () => {
  if (!game.user.isGM || isConfigured()) return;

  openDialog({
    title: game.i18n.localize('DNDAMIGOS.Setup.Title'),
    content: game.i18n.localize('DNDAMIGOS.Setup.Body'),
    buttons: {
      open: {
        label: game.i18n.localize('DNDAMIGOS.Setup.Open'),
        icon: '<i class="fa-solid fa-link"></i>',
        callback: () => openConnectionSettings(),
      },
      later: { label: game.i18n.localize('DNDAMIGOS.Setup.Later') },
    },
    default: 'open',
    width: 480,
  });
});

/* --------------------------------------------------------------------
   API client — every call is a plain fetch() to engine/api/foundry/*.php,
   authenticated with the X-Foundry-Key header (see the site's
   includes/functions.php require_foundry_key()). No session/cookie
   involved on either side.
-------------------------------------------------------------------- */

class DndAmigosApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/**
 * Shared by apiRequest() and apiUploadFile() below — both need the same
 * "is this even configured" check and base URL, just with a different
 * request body shape (JSON vs FormData) after this point.
 */
function getApiConfig(override = null) {
  const baseUrl = String(override?.siteUrl ?? game.settings.get(MODULE_ID, 'siteUrl') ?? '').replace(/\/+$/, '');
  const apiKey = override?.apiKey ?? game.settings.get(MODULE_ID, 'apiKey');
  if (!baseUrl || !apiKey) {
    throw new DndAmigosApiError(game.i18n.localize('DNDAMIGOS.Error.NotConfigured'));
  }
  return { baseUrl, apiKey };
}

/**
 * Shared response handling for both request functions below: parse the
 * JSON body, and throw a DndAmigosApiError for either a malformed
 * response or one the server marked as a failure ({ok: false}).
 */
async function parseApiResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new DndAmigosApiError(`Unexpected response (status ${response.status})`);
  }
  if (!data.ok) {
    throw new DndAmigosApiError(data.error || `Request failed (status ${response.status})`, response.status);
  }
  return data;
}

/** `config` ({ siteUrl, apiKey }) overrides the saved connection, e.g. to test typed-in values. */
async function apiRequest(path, { method = 'GET', body = null, config = null } = {}) {
  const { baseUrl, apiKey } = getApiConfig(config);

  const options = {
    method,
    headers: { 'X-Foundry-Key': apiKey },
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${baseUrl}/engine/api/foundry/${path}`, options);
  } catch (err) {
    throw new DndAmigosApiError(err.message || 'Network error');
  }

  return parseApiResponse(response);
}

/**
 * Same auth/error handling as apiRequest(), but for a multipart file
 * upload — no Content-Type header set manually (the browser fills in
 * the multipart boundary itself), and the body is a FormData rather
 * than a JSON string.
 */
async function apiUploadFile(path, formData) {
  const { baseUrl, apiKey } = getApiConfig();

  let response;
  try {
    response = await fetch(`${baseUrl}/engine/api/foundry/${path}`, {
      method: 'POST',
      headers: { 'X-Foundry-Key': apiKey },
      body: formData,
    });
  } catch (err) {
    throw new DndAmigosApiError(err.message || 'Network error');
  }

  return parseApiResponse(response);
}

/* --------------------------------------------------------------------
   Settings windows — opened from Configure Settings. Connection has its
   own "Test Connection" button, so a GM can confirm the URL/key/journal id
   are all correct before relying on them anywhere else. Identity is
   client-scoped and open to every player (not just the GM): pick which
   D&D Amigos member you are, from a plain dropdown of site members, so
   loot/session-post actions get credited correctly.
-------------------------------------------------------------------- */


function openConnectionSettings() {
  const t = (key) => game.i18n.localize(key);
  openDialog({
    title: t('DNDAMIGOS.SettingsMenu.Name'),
    width: 480,
    content: `
      <div class="form-group">
        <label>${t('DNDAMIGOS.Settings.SiteUrl.Name')}</label>
        <input type="text" name="siteUrl" value="${attr(game.settings.get(MODULE_ID, 'siteUrl'))}" placeholder="https://dndamigos.com">
        <p class="notes">${t('DNDAMIGOS.Settings.SiteUrl.Hint')}</p>
      </div>
      <div class="form-group">
        <label>${t('DNDAMIGOS.Settings.ApiKey.Name')}</label>
        <input type="password" name="apiKey" value="${attr(game.settings.get(MODULE_ID, 'apiKey'))}">
        <p class="notes">${t('DNDAMIGOS.Settings.ApiKey.Hint')}</p>
      </div>
      <div class="form-group">
        <label>${t('DNDAMIGOS.Settings.JournalId.Name')}</label>
        <input type="number" name="journalId" value="${attr(game.settings.get(MODULE_ID, 'journalId'))}" min="1" step="1">
        <p class="notes">${t('DNDAMIGOS.Settings.JournalId.Hint')}</p>
      </div>
      <div class="form-group">
        <button type="button" data-action="test-connection"><i class="fa-solid fa-plug"></i> ${t('DNDAMIGOS.SettingsMenu.TestConnection')}</button>
        <p class="dnd-amigos-test-result notes"></p>
      </div>
    `,
    buttons: {
      save: {
        label: game.i18n.localize('DNDAMIGOS.Common.Save'),
        icon: '<i class="fa-solid fa-save"></i>',
        callback: async (html) => {
          await game.settings.set(MODULE_ID, 'siteUrl', String(html.find('[name="siteUrl"]').val() || '').replace(/\/+$/, ''));
          await game.settings.set(MODULE_ID, 'apiKey', html.find('[name="apiKey"]').val() || '');
          await game.settings.set(MODULE_ID, 'journalId', Number(html.find('[name="journalId"]').val()) || 0);
        },
      },
      cancel: { label: t('Cancel') },
    },
    default: 'save',
    render: (html) => {
      html.find('[data-action="test-connection"]').on('click', async () => {
        const siteUrl = html.find('[name="siteUrl"]').val();
        const apiKey = html.find('[name="apiKey"]').val();
        const journalId = Number(html.find('[name="journalId"]').val());
        const resultEl = html.find('.dnd-amigos-test-result');

        // Test whatever is typed right now, without saving it: Cancel must leave the old settings alone.
        try {
          const data = await apiRequest(`campaign-info.php?journal_id=${journalId}`, { config: { siteUrl, apiKey } });
          resultEl.text(game.i18n.format('DNDAMIGOS.Error.TestConnectionOk', { name: data.journal.name }));
          resultEl.css('color', 'green');
        } catch (err) {
          resultEl.text(game.i18n.format('DNDAMIGOS.Error.TestConnectionFailed', { error: err.message }));
          resultEl.css('color', 'red');
        }
      });
    },
  });
}

async function openIdentitySettings() {
  const t = (key) => game.i18n.localize(key);
  const currentId = getMyUserId();

  let choices = [];
  let error = null;
  if (!isConfigured()) {
    error = t('DNDAMIGOS.Error.NotConfigured');
  } else {
    try {
      const data = await apiRequest('members-list.php');
      choices = data.members;
    } catch (err) {
      error = err.message;
    }
  }

  const body = error
    ? `<p class="notes" style="color:#a94442;">${attr(error)}</p>`
    : `
      <div class="form-group">
        <label>${t('DNDAMIGOS.Settings.MyUserId.Name')}</label>
        <select name="userId" style="width:100%;">
          <option value="0">${t('DNDAMIGOS.Settings.MyUserId.None')}</option>
          ${choices.map((m) => `<option value="${attr(m.id)}"${Number(m.id) === currentId ? ' selected' : ''}>${attr(m.display_name)}</option>`).join('')}
        </select>
        <p class="notes">${t('DNDAMIGOS.Settings.MyUserId.Hint')}</p>
      </div>`;

  openDialog({
    title: t('DNDAMIGOS.IdentityMenu.Name'),
    width: 420,
    content: body,
    buttons: {
      ...(error ? {} : {
        save: {
          label: game.i18n.localize('DNDAMIGOS.Common.Save'),
          icon: '<i class="fa-solid fa-save"></i>',
          callback: async (html) => {
            await game.settings.set(MODULE_ID, 'myUserId', Number(html.find('[name="userId"]').val()) || 0);
          },
        },
      }),
      cancel: { label: t(error ? 'Close' : 'Cancel') },
    },
    default: error ? 'cancel' : 'save',
  });
}

// What Configure Settings builds for the two menu buttons; each just opens its dialog above.
class ConnectionSettingsMenu extends MenuWindow {
  static open() { openConnectionSettings(); }
}

class IdentitySettingsMenu extends MenuWindow {
  static open() { openIdentitySettings(); }
}

/* --------------------------------------------------------------------
   "D&D Amigos Sync" — actor sheet header button. Named
   direction-neutrally on purpose: once an actor is linked, clicking it
   offers both Pull and Push, not just a one-way sync from the site, and
   the old "Sync from D&D Amigos" label was confusing players who only
   ever saw the two-way choice.
-------------------------------------------------------------------- */

Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
  if (sheet.actor?.type !== 'character') return;
  buttons.unshift({
    label: game.i18n.localize('DNDAMIGOS.ActorSheet.HeaderButton'),
    class: 'dnd-amigos-sync',
    icon: 'fa-solid fa-arrows-rotate',
    onclick: () => syncActorFromVault(sheet.actor),
  });
});

// The same button for sheets built on the newer window type, whose header menu is a list of controls
// (an `action` the sheet runs, or an `onClick` of our own). Harmless where no sheet fires this hook.
Hooks.on('getHeaderControlsActorSheetV2', (sheet, controls) => {
  if (sheet.actor?.type !== 'character') return;
  if (controls.some((c) => c.action === 'dndAmigosSync')) return;
  controls.unshift({
    action: 'dndAmigosSync',
    label: 'DNDAMIGOS.ActorSheet.HeaderButton',
    icon: 'fa-solid fa-arrows-rotate',
    onClick: () => syncActorFromVault(sheet.actor),
  });
});

async function syncActorFromVault(actor) {
  if (!isConfigured()) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }

  const linkedId = actor.getFlag(MODULE_ID, 'characterId');

  if (linkedId) {
    const linkedName = actor.getFlag(MODULE_ID, 'characterName') || actor.name;
    openDialog({
      title: game.i18n.localize('DNDAMIGOS.ActorSheet.DirectionTitle'),
      content: `<p>${game.i18n.format('DNDAMIGOS.ActorSheet.DirectionBody', { name: attr(linkedName) })}</p>`,
      buttons: {
        pull: {
          label: game.i18n.localize('DNDAMIGOS.ActorSheet.PullButton'),
          icon: '<i class="fa-solid fa-cloud-arrow-down"></i>',
          callback: async () => {
            const confirmed = await confirmDialog({
              title: game.i18n.localize('DNDAMIGOS.ActorSheet.ReSyncTitle'),
              content: `<p>${game.i18n.format('DNDAMIGOS.ActorSheet.ReSyncBody', { name: attr(linkedName) })}</p>`,
            });
            if (!confirmed) return;
            await applyCharacterToActor(actor, linkedId);
          },
        },
        push: {
          label: game.i18n.localize('DNDAMIGOS.ActorSheet.PushButton'),
          icon: '<i class="fa-solid fa-cloud-arrow-up"></i>',
          callback: async () => {
            const confirmed = await confirmDialog({
              title: game.i18n.localize('DNDAMIGOS.ActorSheet.PushConfirmTitle'),
              content: `<p>${game.i18n.format('DNDAMIGOS.ActorSheet.PushConfirmBody', { name: attr(linkedName) })}</p>`,
            });
            if (!confirmed) return;
            await pushActorToVault(actor, linkedId);
          },
        },
        cancel: { label: game.i18n.localize('Cancel') },
      },
      default: 'pull',
    });
    return;
  }

  let characters;
  try {
    const journalId = game.settings.get(MODULE_ID, 'journalId');
    const data = await apiRequest(`characters-list.php?journal_id=${journalId}`);
    characters = data.characters;
  } catch (err) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  // Always offer both paths — pick an existing vault character, or
  // create a new one from this actor's current data — rather than
  // dead-ending when the vault (for this journal) happens to be empty.
  const hasExisting = characters.length > 0;
  const options = characters
    .map((c) => `<option value="${c.id}">${foundry.utils.escapeHTML(c.name)} — ${foundry.utils.escapeHTML(c.player_display || '')}</option>`)
    .join('');

  openDialog({
    title: game.i18n.localize('DNDAMIGOS.ActorSheet.PickerTitle'),
    content: `
      <p>${game.i18n.localize('DNDAMIGOS.ActorSheet.PickerHint')}</p>
      ${hasExisting
        ? `<select name="character-id" style="width:100%;">${options}</select>`
        : `<p><em>${game.i18n.localize('DNDAMIGOS.ActorSheet.NoCharacters')}</em></p>`}
      <p class="notes">${game.i18n.localize('DNDAMIGOS.ActorSheet.CreateNewHint')}</p>
    `,
    buttons: {
      ...(hasExisting ? {
        sync: {
          label: game.i18n.localize('DNDAMIGOS.ActorSheet.SyncButton'),
          callback: async (html) => {
            const characterId = Number(html.find('[name="character-id"]').val());
            await applyCharacterToActor(actor, characterId);
          },
        },
      } : {}),
      create: {
        label: game.i18n.localize('DNDAMIGOS.ActorSheet.CreateNewButton'),
        callback: () => createCharacterFromActor(actor),
      },
      cancel: { label: game.i18n.localize('Cancel') },
    },
    default: hasExisting ? 'sync' : 'create',
  });
}

async function applyCharacterToActor(actor, characterId) {
  let character;
  let snapshotMeta = null;
  try {
    const data = await apiRequest(`character.php?character_id=${characterId}`);
    character = data.character;
    snapshotMeta = data.snapshot || null;
  } catch (err) {
    if (err instanceof DndAmigosApiError && err.status === 404) {
      // The linked Character Vault entry is gone (deleted on the site
      // since this actor was last synced) — the stale link on its own
      // is a dead end, so offer a way out instead of just erroring.
      await offerRecreateAfterMissingCharacter(actor);
      return;
    }
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  // The site has the WHOLE character saved: offer to restore all of it, not just the basics.
  if (snapshotMeta) {
    const choice = await new Promise((resolve) => {
      openDialog({
        title: game.i18n.localize('DNDAMIGOS.ActorSheet.RestoreTitle'),
        content: `<p>${game.i18n.format('DNDAMIGOS.ActorSheet.RestoreBody', { name: foundry.utils.escapeHTML(character.name), date: String(snapshotMeta.taken_at).slice(0, 10) })}</p>`,
        buttons: {
          all: { label: game.i18n.localize('DNDAMIGOS.ActorSheet.RestoreAllButton'), icon: '<i class="fa-solid fa-box-open"></i>', callback: () => resolve('all') },
          stats: { label: game.i18n.localize('DNDAMIGOS.ActorSheet.RestoreStatsButton'), callback: () => resolve('stats') },
          cancel: { label: game.i18n.localize('Cancel'), callback: () => resolve('cancel') },
        },
        default: 'cancel',
        close: () => resolve('cancel'),
      });
    });
    if (choice === 'cancel') return;
    if (choice === 'all') {
      await restoreActorFromSnapshot(actor, character);
      return;
    }
  }

  const update = buildBasicPf2eUpdate(character);
  await actor.update(update);
  await actor.setFlag(MODULE_ID, 'characterId', character.id);
  await actor.setFlag(MODULE_ID, 'characterName', character.name);

  if (character.pathbuilder_json) {
    await actor.setFlag(MODULE_ID, 'pathbuilderJson', character.pathbuilder_json);
    try {
      await game.clipboard.copyPlainText(character.pathbuilder_json);
    } catch (err) {
      // Clipboard access can be blocked by the browser outside a direct
      // user gesture context in some setups — the JSON is still saved
      // on the actor's flags either way, just not auto-copied.
    }
    ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.SyncedBasic', { name: character.name }));
    ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.PathbuilderCopied', { name: character.name }), { permanent: true });
  } else {
    ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.SyncedThin', { name: character.name }));
  }
}

/**
 * The "Push to Site" direction — reads this actor's CURRENT basic
 * fields (extractBasicCharacterFromActor(), the same helper "Create New
 * on Site" uses) and overwrites the linked Character Vault entry with
 * them via api/foundry/update-character.php. Requires an identity to be
 * set, same as Create New — and the site
 * itself only allows the push through if that identity is the
 * character's actual owner there (api/foundry/update-character.php's
 * own check), so this module doesn't need to guess or duplicate that
 * rule.
 */
/**
 * The push itself, with no pop-ups: returns { ok, name, tokenError, snapshotLine, snapshotSaved,
 * error, status } so both the sheet button (pushActorToVault) and End of Session Sync can report it
 * their own way. status is the HTTP status on failure (404 = the vault entry was deleted on the site).
 */
async function pushCharacterCore(actor, characterId) {
  const myUserId = getMyUserId();
  if (!myUserId) return { ok: false, error: game.i18n.localize('DNDAMIGOS.ActorSheet.NoIdentityWarning') };

  const snap = buildActorSnapshot(actor);
  const payload = { character_id: characterId, user_id: myUserId, ...extractBasicCharacterFromActor(actor), ...snapshotPayloadFrom(snap) };

  let character;
  let snapshotResult = null;
  try {
    const data = await apiRequest('update-character.php', { method: 'POST', body: payload });
    character = data.character;
    snapshotResult = data.snapshot || null;
  } catch (err) {
    return { ok: false, error: err.message, status: err.status ?? null };
  }

  await actor.setFlag(MODULE_ID, 'characterName', character.name);
  const tokenResult = await pushActorTokenToVault(actor, characterId, myUserId);
  return {
    ok: true,
    name: character.name,
    tokenError: tokenResult.status === 'error' ? tokenResult.error : null,
    snapshotLine: snap.error || describeSnapshotResult(actor, snapshotResult),
    snapshotSaved: !snap.error && !!snapshotResult?.saved,
  };
}

async function pushActorToVault(actor, characterId) {
  if (!getMyUserId()) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NoIdentityWarning'));
    return;
  }
  const r = await pushCharacterCore(actor, characterId);
  if (!r.ok) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: r.error }));
    return;
  }
  if (r.tokenError) {
    ui.notifications.warn(game.i18n.format('DNDAMIGOS.ActorSheet.PushedStatsTokenFailed', { name: r.name, error: r.tokenError }));
  } else {
    ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.PushedToSite', { name: r.name }));
  }
  if (r.snapshotLine) {
    (r.snapshotSaved ? ui.notifications.info : ui.notifications.warn).call(ui.notifications, r.snapshotLine);
  }
}

/**
 * Pushes this actor's current portrait (actor.img) to the site as the
 * linked character's token — a separate multipart request from
 * update-character.php's JSON body, same split the site's own manual
 * token-upload form uses (create/update the row, then a follow-up
 * upload-token.php call). Skipped entirely — no error, nothing
 * reported — for an obviously-default Foundry icon (anything ending in
 * .svg): the site only accepts JPEG/PNG/WEBP/GIF anyway, so pushing a
 * generic placeholder like icons/svg/mystery-man.svg would just fail
 * loudly for no reason.
 */
async function pushActorTokenToVault(actor, characterId, userId) {
  const imgSrc = actor.img;
  if (!imgSrc || imgSrc.toLowerCase().endsWith('.svg')) {
    return { status: 'skipped' };
  }

  let blob;
  try {
    const imgResponse = await fetch(imgSrc);
    blob = await imgResponse.blob();
  } catch (err) {
    return { status: 'error', error: err.message };
  }

  const filename = imgSrc.split('/').pop() || 'token.png';
  const formData = new FormData();
  formData.append('character_id', characterId);
  formData.append('user_id', userId);
  formData.append('token', blob, filename);

  try {
    await apiUploadFile('upload-token.php', formData);
    return { status: 'pushed' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

/**
 * Recovery path for a stale link: this actor's characterId flag points
 * at a Character Vault entry that's been deleted on the site since the
 * last sync. Either way, the dead link gets cleared — it can never
 * resolve again — and the user's offered a straight path to create a
 * fresh entry from the actor's current data instead of a dead end.
 */
async function offerRecreateAfterMissingCharacter(actor) {
  const missingName = actor.getFlag(MODULE_ID, 'characterName') || actor.name;

  openDialog({
    title: game.i18n.localize('DNDAMIGOS.ActorSheet.MissingTitle'),
    content: `<p>${game.i18n.format('DNDAMIGOS.ActorSheet.MissingBody', { name: attr(missingName) })}</p>`,
    buttons: {
      create: {
        label: game.i18n.localize('DNDAMIGOS.ActorSheet.CreateNewButton'),
        icon: '<i class="fa-solid fa-plus"></i>',
        callback: async () => {
          await actor.unsetFlag(MODULE_ID, 'characterId');
          await actor.unsetFlag(MODULE_ID, 'characterName');
          await createCharacterFromActor(actor);
        },
      },
      unlink: {
        label: game.i18n.localize('DNDAMIGOS.ActorSheet.UnlinkButton'),
        callback: async () => {
          await actor.unsetFlag(MODULE_ID, 'characterId');
          await actor.unsetFlag(MODULE_ID, 'characterName');
          ui.notifications.info(game.i18n.localize('DNDAMIGOS.ActorSheet.Unlinked'));
        },
      },
      cancel: { label: game.i18n.localize('Cancel') },
    },
    default: 'create',
  });
}

/**
 * The write counterpart to buildBasicPf2eUpdate() below — reads this
 * actor's current *basic* fields back out to send to
 * create-character.php. Same scope limit applies in reverse: no
 * attempt to serialize feats/skills/spells, just what a Character
 * Vault row actually has columns for.
 */
/**
 * The COMPLETE actor for the Character Vault: everything the actor holds (every item, its
 * quantities and containers, spells, feats, skills, conditions, coins, biography...), as Foundry
 * itself would export it, minus the bits that belong to this world rather than the character
 * (its id, folder, sort order and who may open it). Returns { data, bytes } or { error }.
 */
const SNAPSHOT_LIMIT_BYTES = 2900000; // the site refuses anything over 3 MB

function buildActorSnapshot(actor) {
  const data = actor.toObject();
  for (const k of ['_id', 'folder', 'sort', 'ownership', '_stats']) delete data[k];
  const bytes = JSON.stringify(data).length;
  if (bytes > SNAPSHOT_LIMIT_BYTES) return { error: game.i18n.format('DNDAMIGOS.ActorSheet.SnapshotTooBig', { mb: (bytes / 1048576).toFixed(1) }) };
  return { data, bytes };
}

/** Fields every push or create sends alongside the basics so the site can keep the whole character. */
function snapshotPayload(actor) {
  const snap = buildActorSnapshot(actor);
  if (snap.error) ui.notifications.warn(snap.error);
  return snapshotPayloadFrom(snap);
}

/** snapshotPayload() without the pop-up, for callers that report problems themselves. */
function snapshotPayloadFrom(snap) {
  if (snap.error) return {};
  return {
    snapshot: snap.data,
    foundry_version: String(game.version || ''),
    module_version: String(game.modules.get(MODULE_ID)?.version || ''),
    system_id: String(game.system?.id || 'pf2e'),
  };
}

/** One line about what happened to the full snapshot, from the site's reply. */
function describeSnapshotResult(actor, result) {
  if (!result) return '';
  if (result.saved) return game.i18n.format('DNDAMIGOS.ActorSheet.SnapshotSaved', { items: actor.items.size });
  return result.error ? game.i18n.format('DNDAMIGOS.ActorSheet.SnapshotFailed', { error: result.error }) : '';
}

/**
 * Replaces this actor with the complete character saved on the site, using Foundry's own "Import
 * Data" path (so embedded items come along), then re-links it to the vault entry. If that path
 * refuses, falls back to replacing the actor's data and items by hand.
 */
async function restoreActorFromSnapshot(actor, character) {
  let saved;
  try {
    saved = await apiRequest(`character-snapshot.php?character_id=${character.id}`);
  } catch (err) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    return false;
  }
  const snap = saved.snapshot;
  if (snap.type !== actor.type) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.ActorSheet.RestoreWrongType', { saved: snap.type, actual: actor.type }));
    return false;
  }
  try {
    await actor.importFromJSON(JSON.stringify(snap));
  } catch (err) {
    console.warn(`${MODULE_ID} | importFromJSON refused, replacing the actor's data and items by hand`, err);
    try {
      const { items, ...rest } = snap;
      await actor.update(rest, { diff: false, recursive: false });
      await actor.deleteEmbeddedDocuments('Item', actor.items.map((i) => i.id));
      await actor.createEmbeddedDocuments('Item', items, { keepId: true });
    } catch (err2) {
      ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err2.message }));
      return false;
    }
  }
  // the import replaces flags too, so the link to the vault entry has to be set again
  await actor.setFlag(MODULE_ID, 'characterId', character.id);
  await actor.setFlag(MODULE_ID, 'characterName', character.name);
  ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.Restored', { name: character.name, items: actor.items.size }));
  return true;
}

function extractBasicCharacterFromActor(actor) {
  const abilities = actor.system?.abilities || {};
  // Character Vault stores a raw ability score, not a modifier — this
  // is the inverse of buildBasicPf2eUpdate()'s abilityMod(), so a
  // round-trip (pull, then push back unedited) doesn't drift the score.
  const scoreFromMod = (mod) => (Number(mod) || 0) * 2 + 10;

  return {
    name: actor.name,
    level: actor.system?.details?.level?.value ?? 1,
    str: scoreFromMod(abilities.str?.mod),
    dex: scoreFromMod(abilities.dex?.mod),
    con: scoreFromMod(abilities.con?.mod),
    intel: scoreFromMod(abilities.int?.mod),
    wis: scoreFromMod(abilities.wis?.mod),
    cha: scoreFromMod(abilities.cha?.mod),
    hp_current: actor.system?.attributes?.hp?.value ?? null,
    hp_max: actor.system?.attributes?.hp?.max ?? null,
    armor_class: actor.system?.attributes?.ac?.value ?? null,
    // pf2e stores class/ancestry/background as embedded Items, not
    // plain text fields — actor.class/.ancestry/.background are the
    // system's own convenience getters for them, undefined if the
    // actor doesn't have one of those Items yet.
    class: actor.class?.name ?? null,
    race: actor.ancestry?.name ?? null,
    background: actor.background?.name ?? null,
  };
}

/**
 * Creating the vault entry, with no pop-ups: links the actor to it and, with { withToken }, also
 * pushes the portrait. Returns { ok, id, name, tokenError, snapshotLine, snapshotSaved, error }.
 */
async function createCharacterCore(actor, { withToken = false } = {}) {
  const myUserId = getMyUserId();
  if (!myUserId) return { ok: false, error: game.i18n.localize('DNDAMIGOS.ActorSheet.NoIdentityWarning') };

  const journalId = game.settings.get(MODULE_ID, 'journalId');
  const snap = buildActorSnapshot(actor);
  const payload = { journal_id: journalId, user_id: myUserId, ...extractBasicCharacterFromActor(actor), ...snapshotPayloadFrom(snap) };

  let character;
  let snapshotResult = null;
  try {
    const data = await apiRequest('create-character.php', { method: 'POST', body: payload });
    character = data.character;
    snapshotResult = data.snapshot || null;
  } catch (err) {
    return { ok: false, error: err.message, status: err.status ?? null };
  }

  await actor.setFlag(MODULE_ID, 'characterId', character.id);
  await actor.setFlag(MODULE_ID, 'characterName', character.name);
  const tokenResult = withToken ? await pushActorTokenToVault(actor, character.id, myUserId) : { status: 'skipped' };
  return {
    ok: true,
    id: character.id,
    name: character.name,
    tokenError: tokenResult.status === 'error' ? tokenResult.error : null,
    snapshotLine: snap.error || describeSnapshotResult(actor, snapshotResult),
    snapshotSaved: !snap.error && !!snapshotResult?.saved,
  };
}

async function createCharacterFromActor(actor) {
  if (!getMyUserId()) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NoIdentityWarning'));
    return;
  }
  const r = await createCharacterCore(actor);
  if (!r.ok) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: r.error }));
    return;
  }
  ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.CreatedOnSite', { name: r.name }));
  if (r.snapshotLine) {
    (r.snapshotSaved ? ui.notifications.info : ui.notifications.warn).call(ui.notifications, r.snapshotLine);
  }
}

/**
 * End of Session Sync's character step: push a linked actor; create the vault entry for one that
 * isn't linked yet, or whose entry was deleted on the site (the dead link is cleared first).
 * Returns { ok, action: 'pushed'|'created', name, tokenError, snapshotLine, error }.
 */
async function syncCharacterCore(actor) {
  const linkedId = actor.getFlag(MODULE_ID, 'characterId');
  if (linkedId) {
    const r = await pushCharacterCore(actor, linkedId);
    if (r.ok || r.status !== 404) return { ...r, action: 'pushed' };
    await actor.unsetFlag(MODULE_ID, 'characterId');
    await actor.unsetFlag(MODULE_ID, 'characterName');
  }
  return { ...(await createCharacterCore(actor, { withToken: true })), action: 'created' };
}

/**
 * Maps what the Character Vault actually stores onto a PF2e character
 * actor's *basic* fields only — name, level, current HP, and ability
 * modifiers computed from the vault's raw scores. Deliberately does
 * NOT attempt to attach ancestry/background/class Items, skills,
 * proficiency ranks, feats, or spells: pf2e actors build those from
 * real compendium Items with their own rule elements, and guessing at
 * that mapping here would be far less reliable than the pf2e system's
 * own "Import from Pathbuilder" tool, which already solves it — see
 * applyCharacterToActor()'s clipboard-copy of the raw Pathbuilder JSON
 * for that path. If the pf2e system changes these basic field paths in
 * a future update, this is the one function to fix.
 */
function buildBasicPf2eUpdate(character) {
  const abilityMod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);

  const update = {
    name: character.name,
    system: {
      details: {
        level: { value: Number(character.level) || 1 },
      },
      abilities: {
        str: { mod: abilityMod(character.str) },
        dex: { mod: abilityMod(character.dex) },
        con: { mod: abilityMod(character.con) },
        int: { mod: abilityMod(character.intel) },
        wis: { mod: abilityMod(character.wis) },
        cha: { mod: abilityMod(character.cha) },
      },
    },
  };

  if (character.hp_current !== null && character.hp_current !== undefined) {
    update.system.attributes = { hp: { value: Number(character.hp_current) } };
  }

  return update;
}

/* --------------------------------------------------------------------
   The "D&D Amigos" journal directory button: opens the same menu as the
   & button on the game screen (End of Session Sync, Post Session Update,
   Manage Loot, NPCs & Places, Ask Nethys, and the GM-only items).
-------------------------------------------------------------------- */

/**
 * Builds one toolbar button and wires its click handler — used by
 * renderJournalDirectory below so each button (GM-only or open to
 * everyone) is a one-liner.
 */
function addDirectoryButton(container, { className, icon, labelKey, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${game.i18n.localize(labelKey)}`;
  btn.addEventListener('click', onClick);
  container.appendChild(btn);
  return btn;
}

/**
 * The single "D&D Amigos" journal directory button opens this menu
 * instead of running an action directly — a plain vertical list of
 * Dialog buttons rather than a Foundry ContextMenu, since that's the
 * same well-established API the rest of this module already leans on
 * (NPCs & Places, Manage Loot, etc.), with no positioning quirks to worry
 * about across Foundry versions. Post Session Update, Manage Loot, and
 * NPCs & Places are open to every player; Import from D&D Amigos and Push
 * NPCs & Places to Site stay GM-only, since they create or send the
 * campaign's lore (real JournalEntry world documents, which players can't
 * by default).
 */
function openAmigosMenu() {
  const entries = [
    { action: 'help', icon: 'fa-circle-question', labelKey: 'DNDAMIGOS.JournalDirectory.HelpButton', onClick: openHelpDialog, help: true },
    { action: 'session-sync', icon: 'fa-flag-checkered', labelKey: 'DNDAMIGOS.JournalDirectory.SessionSync', onClick: openSessionSync, gold: true },
    { action: 'post-event', icon: 'fa-paper-plane', labelKey: 'DNDAMIGOS.JournalDirectory.PostEvent', onClick: openPostEventDialog },
    { action: 'manage-loot', icon: 'fa-sack-dollar', labelKey: 'DNDAMIGOS.JournalDirectory.ManageLoot', onClick: openStashWindow, gold: true },
    { action: 'lookup', icon: 'fa-users', labelKey: 'DNDAMIGOS.JournalDirectory.Lookup', onClick: openLoreDialog },
    { action: 'nethys', icon: 'fa-hat-wizard', labelKey: 'DNDAMIGOS.JournalDirectory.AskNethys', onClick: openNethysWindow },
  ];
  if (game.user.isGM) {
    entries.push({ action: 'import-info', icon: 'fa-download', labelKey: 'DNDAMIGOS.JournalDirectory.ImportInfo', onClick: importCampaignInfo });
    entries.push({ action: 'push-lore', icon: 'fa-upload', labelKey: 'DNDAMIGOS.JournalDirectory.PushLore', onClick: pushLore });
  }

  const dialog = openDialog({
    title: game.i18n.localize('DNDAMIGOS.Menu.Title'),
    content: `
      <div class="dnd-amigos-menu-list">
        ${entries.map((e) => `
          <button type="button" class="dnd-amigos-menu-item${e.gold ? ' dnd-amigos-menu-item-gold' : ''}${e.help ? ' dnd-amigos-menu-item-help' : ''}" data-action="${e.action}">
            <i class="fa-solid ${e.icon}"></i>${game.i18n.localize(e.labelKey)}
          </button>
        `).join('')}
      </div>
    `,
    buttons: { close: { label: game.i18n.localize('Close') } },
    render: (html) => {
      entries.forEach((e) => {
        html.find(`[data-action="${e.action}"]`).on('click', () => {
          dialog.close();
          e.onClick();
        });
      });
    },
    width: 320,
  });
}

/**
 * A plain-language reference for every feature this module has, opened
 * from the top of the D&D Amigos menu — added after real players
 * reported confusion about what individual buttons actually do (e.g.
 * the actor sheet's sync button, before it was renamed to be
 * direction-neutral). Static content, no API calls — just localized
 * title/body pairs rendered as a scrollable list of sections.
 */
function openHelpDialog() {
  const sections = [
    ['DNDAMIGOS.Help.Menu.Title', 'DNDAMIGOS.Help.Menu.Body'],
    ['DNDAMIGOS.Help.SessionSync.Title', 'DNDAMIGOS.Help.SessionSync.Body'],
    ['DNDAMIGOS.Help.Sync.Title', 'DNDAMIGOS.Help.Sync.Body'],
    ['DNDAMIGOS.Help.PostEvent.Title', 'DNDAMIGOS.Help.PostEvent.Body'],
    ['DNDAMIGOS.Help.ManageLoot.Title', 'DNDAMIGOS.Help.ManageLoot.Body'],
    ['DNDAMIGOS.Help.Lookup.Title', 'DNDAMIGOS.Help.Lookup.Body'],
    ['DNDAMIGOS.Help.Nethys.Title', 'DNDAMIGOS.Help.Nethys.Body'],
    ['DNDAMIGOS.Help.PushLore.Title', 'DNDAMIGOS.Help.PushLore.Body'],
    ['DNDAMIGOS.Help.ImportInfo.Title', 'DNDAMIGOS.Help.ImportInfo.Body'],
    ['DNDAMIGOS.Help.Identity.Title', 'DNDAMIGOS.Help.Identity.Body'],
  ];

  openDialog({
    title: game.i18n.localize('DNDAMIGOS.Help.Title'),
    content: `
      <div class="dnd-amigos-help">
        ${sections.map(([titleKey, bodyKey]) => `
          <div class="dnd-amigos-help-section">
            <h3>${game.i18n.localize(titleKey)}</h3>
            <p>${game.i18n.localize(bodyKey)}</p>
          </div>
        `).join('')}
      </div>
    `,
    buttons: { close: { label: game.i18n.localize('Close') } },
    width: 480,
  });
}

Hooks.on('renderJournalDirectory', (app, html) => {
  try {
    // Foundry v13+ moved the core sidebar tabs to ApplicationV2, which
    // hands render hooks a plain HTMLElement instead of the jQuery
    // object older versions used — html.find() would throw on that
    // (silently, since Foundry wraps each hook callback so one failing
    // hook doesn't break the others, which is exactly why this went
    // unnoticed rather than erroring visibly). Normalize to a real
    // element and use native DOM methods throughout so this works on
    // either kind of value.
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) {
      console.warn(`${MODULE_ID} | renderJournalDirectory fired but no usable root element was found`, html);
      return;
    }

    // Try known container class names across several Foundry versions
    // before falling back to the tab's own root element — the
    // sidebar's internal markup has moved more than once.
    const container =
      root.querySelector('.directory-header .header-actions') ||
      root.querySelector('.directory-header') ||
      root.querySelector('.directory-footer') ||
      root;

    // A single entry point instead of five separate buttons — saves
    // sidebar space and gives the feature set room to grow without the
    // directory header turning into a wall of icons. Every action still
    // opens from a deliberate click; this just adds one extra click
    // (open the menu, then pick) to reach any one of them.
    addDirectoryButton(container, {
      className: 'dnd-amigos-menu-button',
      icon: 'fa-dice-d20',
      labelKey: 'DNDAMIGOS.JournalDirectory.MenuButton',
      onClick: openAmigosMenu,
    });

  } catch (err) {
    // Never let this hook throw silently again — log loudly so a
    // future "no journal buttons" report comes with a real stack trace
    // in the console instead of nothing at all.
    console.error(`${MODULE_ID} | renderJournalDirectory handler failed`, err);
  }
});

/* --------------------------------------------------------------------
   The "&" button: a small black square with a red ampersand in the
   bottom-right corner of the game screen, beside the chat box (the top
   right is where PF2e shows conditions and effects), opening the same D&D Amigos menu
   as the journal sidebar button. Players rarely open the Journal tab, so
   this puts the menu where they already look. Where it goes depends on
   Foundry's layout, which changed between versions:
     - v14 (checked in the group's live world): #ui-right is a row of
       #ui-right-column-1 (300px: chat pop-ups, PF2e's effects panel at its
       top right) then the sidebar. The button is pinned to that column's
       bottom-right corner (14px up), 16px from the sidebar, level with the
       chat box. With the sidebar collapsed, v14 floats the chat box over
       that column, so CSS moves the button just left of it (module.css).
     - other v13/v14 layouts with a #ui-right row but no such column: first
       in that row, at the bottom.
     - v12: #ui-middle spans the whole gap between the left controls and
       the sidebar, so the button sits in that column's bottom-right corner.
     - neither found: a fixed bottom-right corner.
   Each player can hide it (Configure Settings: "Show the D&D Amigos button").
-------------------------------------------------------------------- */

const CANVAS_BUTTON_ID = 'dnd-amigos-canvas-button';

function placeCanvasButton() {
  document.getElementById(CANVAS_BUTTON_ID)?.remove();
  if (!game.settings.get(MODULE_ID, 'canvasButton')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = CANVAS_BUTTON_ID;
  btn.textContent = '&';
  const label = game.i18n.localize('DNDAMIGOS.CanvasButton.Tooltip');
  btn.setAttribute('aria-label', label);
  btn.dataset.tooltip = label;
  btn.dataset.tooltipDirection = 'LEFT';
  btn.addEventListener('click', openAmigosMenu);

  const column = document.getElementById('ui-right-column-1');
  const right = document.getElementById('ui-right');
  const rightStyle = right ? getComputedStyle(right) : null;
  const middle = document.getElementById('ui-middle');
  if (column) {
    btn.classList.add('in-column');
    column.classList.add('dnd-amigos-has-canvas-button');
    column.appendChild(btn);
  } else if (rightStyle && rightStyle.display.includes('flex') && !rightStyle.flexDirection.startsWith('column')) {
    btn.classList.add('in-right');
    right.prepend(btn);
  } else if (middle) {
    btn.classList.add('in-middle');
    middle.classList.add('dnd-amigos-has-canvas-button');
    middle.appendChild(btn);
  } else {
    btn.classList.add('is-fixed');
    document.body.appendChild(btn);
  }
}

Hooks.once('ready', () => {
  try {
    placeCanvasButton();
  } catch (err) {
    console.error(`${MODULE_ID} | could not place the & button`, err);
  }
});

/* --------------------------------------------------------------------
   "Post Session Update" — D&D Amigos menu item, open to everyone. A
   small dialog to message the campaign's Discord, optionally also
   logging it as a real entry in the site's session log.
-------------------------------------------------------------------- */

function openPostEventDialog() {
  if (!isConfigured()) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }

  openDialog({
    title: game.i18n.localize('DNDAMIGOS.PostEvent.Title'),
    content: `
      <div class="form-group">
        <label>${game.i18n.localize('DNDAMIGOS.PostEvent.MessageLabel')}</label>
        <textarea name="message" rows="4" style="width:100%;"></textarea>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="log-to-journal" checked>
          ${game.i18n.localize('DNDAMIGOS.PostEvent.LogToJournalLabel')}
        </label>
      </div>
    `,
    buttons: {
      send: {
        label: game.i18n.localize('DNDAMIGOS.PostEvent.Send'),
        callback: async (html) => {
          const message = html.find('[name="message"]').val().trim();
          const logToJournal = html.find('[name="log-to-journal"]').is(':checked');
          if (!message) return;

          try {
            const journalId = game.settings.get(MODULE_ID, 'journalId');
            const data = await apiRequest('post-event.php', {
              method: 'POST',
              body: { journal_id: journalId, message, log_to_journal: logToJournal, user_id: getMyUserId() },
            });
            ui.notifications.info(
              data.logged_to_journal
                ? game.i18n.localize('DNDAMIGOS.PostEvent.Success')
                : game.i18n.localize('DNDAMIGOS.PostEvent.SuccessNoLog')
            );
          } catch (err) {
            ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
          }
        },
      },
      cancel: { label: game.i18n.localize('Cancel') },
    },
    default: 'send',
  });
}

/* --------------------------------------------------------------------
   "Import from D&D Amigos" — D&D Amigos menu item, GM only (creates
   real JournalEntry world documents, which players can't by default).
   Pulls Places/NPCs in as Journal Entries and shows the current
   user's E.Y.F.F.O. mini-game stats, if any. (Loot isn't imported: it
   lives in the PF2e Party actor's inventory; see scripts/stash.js.)
-------------------------------------------------------------------- */

async function importCampaignInfo() {
  if (!isConfigured()) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }

  const journalId = game.settings.get(MODULE_ID, 'journalId');
  ui.notifications.info(game.i18n.localize('DNDAMIGOS.Import.Working'));

  let info;
  try {
    info = await apiRequest(`campaign-info.php?journal_id=${journalId}`);
  } catch (err) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  // NPCs and Places: add what is new, refresh what you have not touched, never overwrite your own work.
  try {
    ui.notifications.info(describePull(await pullLore(info)));
  } catch (err) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
  }

  // E.Y.F.F.O. stats for the current user, shown directly rather than
  // written into a journal entry — it's a personal snapshot, not
  // shared campaign lore. Needs the site's numeric user id, not
  // game.user.id (Foundry's own internal id for the current user,
  // which persona.php has no way to make sense of) — that's what the
  // "My D&D Amigos Identity" client setting is for.
  const myUserId = getMyUserId();
  if (!myUserId) {
    ui.notifications.info(game.i18n.localize('DNDAMIGOS.Import.NoIdentity'));
  } else {
    try {
      const personaData = await apiRequest(`persona.php?user_id=${myUserId}`);
      if (personaData.has_persona) {
        const p = personaData.persona;
        openDialog({
          title: game.i18n.localize('DNDAMIGOS.Import.Title'),
          content: `
            <p><strong>${attr(p.name)}</strong> — ${game.i18n.format('DNDAMIGOS.Import.PersonaLevel', { level: p.level })}</p>
            <p>${game.i18n.format('DNDAMIGOS.Import.PersonaStats1', { hp: `${p.hp_current}/${p.hp_max}`, gold: p.gold, turns: p.turns_remaining })}</p>
            <p>${game.i18n.format('DNDAMIGOS.Import.PersonaStats2', { attack: p.attack, defense: p.defense, cargo: p.cargo_capacity })}</p>
          `,
          buttons: { ok: { label: game.i18n.localize('DNDAMIGOS.Common.Ok') } },
        });
      } else {
        ui.notifications.info(game.i18n.localize('DNDAMIGOS.Import.PersonaNone'));
      }
    } catch (err) {
      // Non-fatal — the journal-entry import above already succeeded.
      ui.notifications.warn(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    }
  }

  ui.notifications.info(game.i18n.localize('DNDAMIGOS.Import.Done'));
}
