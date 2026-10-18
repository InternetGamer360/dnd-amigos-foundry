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

const MODULE_ID = 'dnd-amigos-connector';

// NPCs & Places (scripts/lore.js) gets the pieces of this file it needs handed to it,
// so the two files never import each other. These are all function declarations or
// settings read at call time, so wiring them up here is safe.
configureLore({ MODULE_ID, apiRequest, apiUploadFile, isConfigured, getMyUserId });
configureNethys({ MODULE_ID, apiRequest, isConfigured });

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

  // The world's shared party stash — a PF2e "Loot" actor everyone
  // treats as the collective "closet of things found adventuring,"
  // not owned by any one PC. Optional: if unset, adding loot through
  // Manage Loot still posts to the site, it just skips the Foundry side.
  game.settings.register(MODULE_ID, 'lootActorId', {
    name: 'DNDAMIGOS.Settings.LootActorId.Name',
    hint: 'DNDAMIGOS.Settings.LootActorId.Hint',
    scope: 'world',
    config: false,
    type: String,
    default: '',
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
  // Manage Loot's add action / Post Session Update credit the right
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
    title: 'D&D Amigos Connector — Setup Needed',
    content: `
      <p>This module isn't connected to the D&D Amigos website yet. To finish setup:</p>
      <ol style="padding-left: 20px; margin: 0 0 10px;">
        <li>On the website, an admin sets <code>FOUNDRY_API_KEY</code> and
          <code>FOUNDRY_ORIGIN</code> in <code>engine/config.php</code> —
          one-time, done once for the whole group.</li>
        <li>Here, open <strong>Configure Settings &rarr; D&D Amigos
          Connection</strong> and fill in the Site URL, that same API Key,
          and the numeric Journal ID for this campaign (visible in the
          site's URL, e.g. <code>journal.php?id=5</code> &rarr;
          <code>5</code>).</li>
        <li>Click <strong>Test Connection</strong> before saving to
          confirm it's working.</li>
      </ol>
      <p>Once that's done, every player (not just the GM) should also open
        <strong>Configure Settings &rarr; My D&D Amigos Identity</strong>
        once on each of their devices and pick their own name — that's
        what credits loot and session posts to the right person.</p>
    `,
    buttons: {
      open: {
        label: 'Open Connection Settings',
        icon: '<i class="fa-solid fa-link"></i>',
        callback: () => openConnectionSettings(),
      },
      later: { label: 'Later' },
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
function getApiConfig() {
  const baseUrl = String(game.settings.get(MODULE_ID, 'siteUrl') || '').replace(/\/+$/, '');
  const apiKey = game.settings.get(MODULE_ID, 'apiKey');
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

async function apiRequest(path, { method = 'GET', body = null } = {}) {
  const { baseUrl, apiKey } = getApiConfig();

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

const attr = (value) => foundry.utils.escapeHTML(String(value ?? ''));

function openConnectionSettings() {
  const t = (key) => game.i18n.localize(key);
  // game.actors is already loaded locally — no fetch needed to list this
  // world's Loot-type actors, unlike everything else here, which reads from the site.
  const lootActorId = game.settings.get(MODULE_ID, 'lootActorId');
  const lootOptions = game.actors
    .filter((a) => a.type === 'loot')
    .map((a) => `<option value="${attr(a.id)}"${a.id === lootActorId ? ' selected' : ''}>${attr(a.name)}</option>`)
    .join('');

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
        <label>${t('DNDAMIGOS.Settings.LootActorId.Name')}</label>
        <select name="lootActorId" style="width:100%;">
          <option value="">&mdash; None &mdash;</option>
          ${lootOptions}
        </select>
        <p class="notes">${t('DNDAMIGOS.Settings.LootActorId.Hint')}</p>
      </div>
      <div class="form-group">
        <button type="button" data-action="test-connection"><i class="fa-solid fa-plug"></i> Test Connection</button>
        <p class="dnd-amigos-test-result notes"></p>
      </div>
    `,
    buttons: {
      save: {
        label: 'Save',
        icon: '<i class="fa-solid fa-save"></i>',
        callback: async (html) => {
          await game.settings.set(MODULE_ID, 'siteUrl', String(html.find('[name="siteUrl"]').val() || '').replace(/\/+$/, ''));
          await game.settings.set(MODULE_ID, 'apiKey', html.find('[name="apiKey"]').val() || '');
          await game.settings.set(MODULE_ID, 'journalId', Number(html.find('[name="journalId"]').val()) || 0);
          await game.settings.set(MODULE_ID, 'lootActorId', html.find('[name="lootActorId"]').val() || '');
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

        // Test with whatever's currently typed, not necessarily saved yet.
        await game.settings.set(MODULE_ID, 'siteUrl', siteUrl);
        await game.settings.set(MODULE_ID, 'apiKey', apiKey);
        await game.settings.set(MODULE_ID, 'journalId', journalId);

        try {
          const data = await apiRequest(`campaign-info.php?journal_id=${journalId}`);
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
          label: 'Save',
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
 * set, same as Manage Loot's add action/Create New — and the site
 * itself only allows the push through if that identity is the
 * character's actual owner there (api/foundry/update-character.php's
 * own check), so this module doesn't need to guess or duplicate that
 * rule.
 */
async function pushActorToVault(actor, characterId) {
  const myUserId = getMyUserId();
  if (!myUserId) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NoIdentityWarning'));
    return;
  }

  const payload = { character_id: characterId, user_id: myUserId, ...extractBasicCharacterFromActor(actor), ...snapshotPayload(actor) };

  let character;
  let snapshotResult = null;
  try {
    const data = await apiRequest('update-character.php', { method: 'POST', body: payload });
    character = data.character;
    snapshotResult = data.snapshot || null;
  } catch (err) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  await actor.setFlag(MODULE_ID, 'characterName', character.name);

  const tokenResult = await pushActorTokenToVault(actor, characterId, myUserId);
  if (tokenResult.status === 'error') {
    ui.notifications.warn(game.i18n.format('DNDAMIGOS.ActorSheet.PushedStatsTokenFailed', { name: character.name, error: tokenResult.error }));
  } else {
    ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.PushedToSite', { name: character.name }));
  }
  const snapshotLine = describeSnapshotResult(actor, snapshotResult);
  if (snapshotLine) {
    (snapshotResult.saved ? ui.notifications.info : ui.notifications.warn).call(ui.notifications, snapshotLine);
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
  if (snap.error) {
    ui.notifications.warn(snap.error);
    return {};
  }
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

async function createCharacterFromActor(actor) {
  const myUserId = getMyUserId();
  if (!myUserId) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NoIdentityWarning'));
    return;
  }

  const journalId = game.settings.get(MODULE_ID, 'journalId');
  const payload = { journal_id: journalId, user_id: myUserId, ...extractBasicCharacterFromActor(actor), ...snapshotPayload(actor) };

  let character;
  let snapshotResult = null;
  try {
    const data = await apiRequest('create-character.php', { method: 'POST', body: payload });
    character = data.character;
    snapshotResult = data.snapshot || null;
  } catch (err) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  await actor.setFlag(MODULE_ID, 'characterId', character.id);
  await actor.setFlag(MODULE_ID, 'characterName', character.name);
  ui.notifications.info(game.i18n.format('DNDAMIGOS.ActorSheet.CreatedOnSite', { name: character.name }));
  const snapshotLine = describeSnapshotResult(actor, snapshotResult);
  if (snapshotLine) {
    (snapshotResult.saved ? ui.notifications.info : ui.notifications.warn).call(ui.notifications, snapshotLine);
  }
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
   A single "D&D Amigos" journal directory button opening a menu of
   every journal-adjacent action — Post Session Update, Manage Loot,
   Look Up, and (GM-only) Import from D&D Amigos.
-------------------------------------------------------------------- */

console.log(`${MODULE_ID} | main.js loaded, registering renderJournalDirectory`);

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
    { action: 'post-event', icon: 'fa-paper-plane', labelKey: 'DNDAMIGOS.JournalDirectory.PostEvent', onClick: openPostEventDialog },
    { action: 'manage-loot', icon: 'fa-sack-dollar', labelKey: 'DNDAMIGOS.JournalDirectory.ManageLoot', onClick: openManageLootDialog, gold: true },
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

    console.log(`${MODULE_ID} | journal directory button injected into`, container);
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
     - v13/v14: #ui-right is a row (its first column, then the sidebar)
       pinned to the right edge, so the button goes first in that row, at
       the bottom: just left of the sidebar's chat box, moving with it.
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

  const right = document.getElementById('ui-right');
  const rightStyle = right ? getComputedStyle(right) : null;
  const middle = document.getElementById('ui-middle');
  if (rightStyle && rightStyle.display.includes('flex') && !rightStyle.flexDirection.startsWith('column')) {
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
   Foundry-side loot sync — the three functions below back Manage
   Loot's add/edit/delete actions, dropping/updating/removing a plain
   PF2e Item on this world's configured Loot actor (Configure Settings
   → D&D Amigos Connection → Loot Actor), the shared "closet of things
   found adventuring," not owned by any one PC. Optional: if no Loot
   actor is configured, Manage Loot's site-side actions still work, they
   just skip this part.
-------------------------------------------------------------------- */

/**
 * Shared by all three functions below: resolves this world's
 * configured Loot actor, or the specific reason it couldn't
 * ({status: 'no-actor-configured'} if the setting is empty,
 * {status: 'actor-missing'} if it points at an actor that's since been
 * deleted). Callers check `result.status` — if unset, `result.lootActor`
 * is ready to use.
 */
function getConfiguredLootActor() {
  const lootActorId = game.settings.get(MODULE_ID, 'lootActorId');
  if (!lootActorId) {
    return { status: 'no-actor-configured' };
  }
  const lootActor = game.actors.get(lootActorId);
  if (!lootActor) {
    return { status: 'actor-missing' };
  }
  return { lootActor };
}

/**
 * The pf2e `system` data shared by creating and updating a Loot actor's
 * Item in the three functions below — `equipment` is pf2e's generic
 * catch-all physical-item type, reasonable for a free-typed name with
 * no real item data behind it. If a future pf2e update renames
 * quantity/price/description, this is the one place to fix.
 */
function buildLootItemSystemData(quantity, valueGp, notes) {
  return {
    quantity,
    price: { value: valueGp ? { gp: valueGp } : {} },
    description: { value: notes ? `<p>${foundry.utils.escapeHTML(notes)}</p>` : '' },
  };
}

async function addLootItemToFoundryActor(name, quantity, valueGp, notes) {
  const found = getConfiguredLootActor();
  if (found.status) return found;

  try {
    const created = await found.lootActor.createEmbeddedDocuments('Item', [{
      name,
      type: 'equipment',
      img: 'icons/svg/chest.svg',
      system: buildLootItemSystemData(quantity, valueGp, notes),
    }]);
    return { status: 'added', foundryItemId: created?.[0]?.id ?? null };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

/**
 * After a loot line is created on both the site and this world's Loot
 * actor, records the Foundry Item's id back on the site row
 * (loot_items.foundry_item_id) so a later edit/delete via "Manage Loot"
 * knows which embedded Item to keep in sync. Best-effort and silent —
 * both halves of the add already succeeded independently by this
 * point, so a failure here just means this one item won't sync on
 * future edits, not that anything needs to be undone.
 */
async function linkFoundryItemToSiteLoot(siteItemId, foundryItemId) {
  if (!siteItemId || !foundryItemId) {
    return;
  }
  try {
    await apiRequest('update-loot.php', {
      method: 'POST',
      body: { id: siteItemId, foundry_item_id: foundryItemId },
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | failed to link Foundry item ${foundryItemId} to site loot item ${siteItemId}`, err);
  }
}

/**
 * The Foundry-side half of a "Manage Loot" edit: updates the matching
 * Item on the configured Loot actor by its stored foundry_item_id.
 * Returns 'item-missing' rather than throwing if that Item was deleted
 * directly in Foundry since — the site's own update still stands
 * either way, this just couldn't also mirror it here.
 */
async function updateLootItemOnFoundryActor(foundryItemId, name, quantity, valueGp, notes) {
  const found = getConfiguredLootActor();
  if (found.status) return found;
  if (!found.lootActor.items.get(foundryItemId)) {
    return { status: 'item-missing' };
  }
  try {
    await found.lootActor.updateEmbeddedDocuments('Item', [{
      _id: foundryItemId,
      name,
      system: buildLootItemSystemData(quantity, valueGp, notes),
    }]);
    return { status: 'updated' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

/**
 * The Foundry-side half of a "Manage Loot" delete: removes the
 * matching Item from the configured Loot actor by its stored
 * foundry_item_id. Same tolerant-of-drift behavior as the update
 * helper above.
 */
async function deleteLootItemFromFoundryActor(foundryItemId) {
  const found = getConfiguredLootActor();
  if (found.status) return found;
  if (!found.lootActor.items.get(foundryItemId)) {
    return { status: 'item-missing' };
  }
  try {
    await found.lootActor.deleteEmbeddedDocuments('Item', [foundryItemId]);
    return { status: 'deleted' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

/* --------------------------------------------------------------------
   "Manage Loot" — D&D Amigos menu item, open to everyone. A full view
   of the site's Party Loot ledger in one popup,
   styled and laid out like its counterpart on the website itself: a
   real table (Description/Qty/Value/Notes), a running Total Party
   Wealth line, and a "+ Add Loot" button that opens an editable row at
   the top rather than a separate form — matching pages/loot.js's own
   interaction exactly, and covering both adding and managing loot in
   one place now, so there's no separate Add Loot dialog anymore. Any
   line linked to this world's shared Loot actor stays in sync on
   add/edit/delete too.
-------------------------------------------------------------------- */

/**
 * Both the edit and delete branches below report their Foundry-actor
 * sync result the same four-way way (success / the specific item was
 * missing / an error / nothing to sync) — this just maps that one
 * shared shape onto whichever set of message keys the caller passes,
 * instead of repeating the same if/else chain twice.
 */
function notifyLootActorSyncResult(result, messages) {
  if (result.status === 'updated' || result.status === 'deleted') {
    ui.notifications.info(game.i18n.localize(messages.success));
  } else if (result.status === 'item-missing') {
    ui.notifications.info(game.i18n.localize(messages.itemMissing));
  } else if (result.status === 'error') {
    ui.notifications.warn(game.i18n.format(messages.failed, { error: result.error }));
  } else {
    ui.notifications.info(game.i18n.localize(messages.siteOnly));
  }
}

let lootFontsLoaded = false;

/**
 * Injects the Cinzel/EB Garamond Google Fonts stylesheet Manage Loot's
 * CSS references — lazily, on first open, rather than an @import in
 * module.css that would fetch it on every session load whether or not
 * anyone ever opens this dialog. Idempotent: safe to call every time
 * openManageLootDialog() runs, only actually does anything once.
 */
function ensureLootFontsLoaded() {
  if (lootFontsLoaded) return;
  lootFontsLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap';
  document.head.appendChild(link);
}

async function openManageLootDialog() {
  if (!isConfigured()) {
    ui.notifications.warn(game.i18n.localize('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  ensureLootFontsLoaded();

  const journalId = game.settings.get(MODULE_ID, 'journalId');
  let info;
  try {
    info = await apiRequest(`campaign-info.php?journal_id=${journalId}`);
  } catch (err) {
    ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  const items = info.loot.slice();
  // An item id, or 'new' for an unsaved row inserted at the top by the
  // "+ Add Loot" button — mirrors pages/loot.js's own editingId model.
  let editingId = null;

  const esc = (s) => foundry.utils.escapeHTML(s ?? '');

  // Matches api/loot/list.php's total_value exactly: a straight sum of
  // each line's value_gp, not value_gp × quantity, so the number here
  // always agrees with what the site shows.
  const computeTotal = () => items.reduce((sum, i) => sum + (Number(i.value_gp) || 0), 0);

  const renderEditRow = (item) => `
    <tr class="dnd-amigos-loot-row" data-id="${item ? item.id : ''}">
      <td><input type="text" class="ml-edit-description" placeholder="${game.i18n.localize('DNDAMIGOS.ManageLoot.DescriptionPlaceholder')}" value="${item ? esc(item.description) : ''}"></td>
      <td><input type="number" class="ml-edit-quantity" min="1" max="999" value="${item ? item.quantity : 1}"></td>
      <td><input type="number" class="ml-edit-value" min="0" placeholder="—" value="${item && item.value_gp !== null && item.value_gp !== undefined ? item.value_gp : ''}"></td>
      <td><input type="text" class="ml-edit-notes" placeholder="optional" value="${item && item.notes ? esc(item.notes) : ''}"></td>
      <td class="dnd-amigos-loot-actions">
        <button type="button" class="dnd-amigos-loot-save-btn">${game.i18n.localize('DNDAMIGOS.ManageLoot.Save')}</button>
        <button type="button" class="dnd-amigos-loot-cancel-btn">${game.i18n.localize('Cancel')}</button>
      </td>
    </tr>
  `;

  const renderDisplayRow = (item) => {
    const valueStr = item.value_gp !== null && item.value_gp !== undefined ? item.value_gp : '—';
    return `
      <tr class="dnd-amigos-loot-row" data-id="${item.id}">
        <td>${esc(item.description)}</td>
        <td>${item.quantity}</td>
        <td>${valueStr}</td>
        <td class="dnd-amigos-loot-notes">${item.notes ? esc(item.notes) : ''}</td>
        <td class="dnd-amigos-loot-actions">
          <button type="button" class="dnd-amigos-loot-edit-btn">${game.i18n.localize('DNDAMIGOS.ManageLoot.Edit')}</button>
          <button type="button" class="dnd-amigos-loot-delete-btn">${game.i18n.localize('DNDAMIGOS.ManageLoot.Delete')}</button>
        </td>
      </tr>
    `;
  };

  openDialog({
    title: game.i18n.localize('DNDAMIGOS.ManageLoot.Title'),
    content: `
      <div class="dnd-amigos-loot-scroll">
        <p class="dnd-amigos-loot-total">${game.i18n.localize('DNDAMIGOS.ManageLoot.TotalWealth')} <strong class="dnd-amigos-loot-total-value"></strong></p>
        <div class="dnd-amigos-loot-table-wrap">
          <table class="dnd-amigos-loot-table">
            <thead>
              <tr>
                <th>${game.i18n.localize('DNDAMIGOS.ManageLoot.DescriptionHeader')}</th>
                <th>${game.i18n.localize('DNDAMIGOS.ManageLoot.QtyHeader')}</th>
                <th>${game.i18n.localize('DNDAMIGOS.ManageLoot.ValueHeader')}</th>
                <th>${game.i18n.localize('DNDAMIGOS.ManageLoot.NotesHeader')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody class="dnd-amigos-manage-loot-list"></tbody>
          </table>
        </div>
        <button type="button" class="dnd-amigos-loot-add-btn">${game.i18n.localize('DNDAMIGOS.ManageLoot.AddButton')}</button>
      </div>
    `,
    buttons: { close: { label: game.i18n.localize('Close') } },
    render: (html) => {
      const listEl = html.find('.dnd-amigos-manage-loot-list');
      const totalEl = html.find('.dnd-amigos-loot-total-value');

      const renderList = () => {
        totalEl.text(`${computeTotal()} gp`);
        if (items.length === 0 && editingId !== 'new') {
          listEl.html(`<tr class="dnd-amigos-loot-empty-row"><td colspan="5"><em>${game.i18n.localize('DNDAMIGOS.ManageLoot.Empty')}</em></td></tr>`);
          return;
        }
        const rows = items.map((item) => (item.id === editingId ? renderEditRow(item) : renderDisplayRow(item)));
        if (editingId === 'new') rows.unshift(renderEditRow(null));
        listEl.html(rows.join(''));
      };
      renderList();

      // Matches the site's own "+ Add Loot" behavior exactly: insert an
      // editable row at the top of the table instead of opening a
      // separate form.
      html.find('.dnd-amigos-loot-add-btn').on('click', () => {
        if (editingId === 'new') return;
        editingId = 'new';
        renderList();
        listEl.find('.ml-edit-description').first().trigger('focus');
      });

      listEl.on('click', async (ev) => {
        const row = ev.target.closest('.dnd-amigos-loot-row');
        if (!row) return;
        const rawId = row.dataset.id;
        const item = rawId ? items.find((i) => i.id === Number(rawId)) : null;

        if (ev.target.classList.contains('dnd-amigos-loot-edit-btn')) {
          editingId = item.id;
          renderList();
        } else if (ev.target.classList.contains('dnd-amigos-loot-cancel-btn')) {
          editingId = null;
          renderList();
        } else if (ev.target.classList.contains('dnd-amigos-loot-delete-btn')) {
          const confirmed = await confirmDialog({
            title: game.i18n.localize('DNDAMIGOS.ManageLoot.ConfirmDeleteTitle'),
            content: `<p>${game.i18n.format('DNDAMIGOS.ManageLoot.ConfirmDeleteBody', { description: attr(item.description) })}</p>`,
          });
          if (!confirmed) return;

          let foundryItemId;
          try {
            const res = await apiRequest('delete-loot.php', { method: 'POST', body: { id: item.id } });
            foundryItemId = res.foundry_item_id;
          } catch (err) {
            ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
            return;
          }

          items.splice(items.indexOf(item), 1);
          renderList();

          const deleteMessages = {
            success: 'DNDAMIGOS.ManageLoot.DeletedBoth',
            itemMissing: 'DNDAMIGOS.ManageLoot.DeletedFoundryItemMissing',
            failed: 'DNDAMIGOS.ManageLoot.DeletedFoundryFailed',
            siteOnly: 'DNDAMIGOS.ManageLoot.DeletedSiteOnly',
          };
          if (foundryItemId) {
            notifyLootActorSyncResult(await deleteLootItemFromFoundryActor(foundryItemId), deleteMessages);
          } else {
            ui.notifications.info(game.i18n.localize(deleteMessages.siteOnly));
          }
        } else if (ev.target.classList.contains('dnd-amigos-loot-save-btn')) {
          const description = row.querySelector('.ml-edit-description').value.trim();
          if (!description) return;
          const quantity = Number(row.querySelector('.ml-edit-quantity').value) || 1;
          const valueRaw = row.querySelector('.ml-edit-value').value;
          const valueGp = valueRaw ? Number(valueRaw) : null;
          const notes = row.querySelector('.ml-edit-notes').value.trim();

          if (!item) {
            // The unsaved "new" row — same identity requirement as the
            // standalone Add Loot dialog, since this also credits a member.
            const myUserId = getMyUserId();
            if (!myUserId) {
              ui.notifications.warn(game.i18n.localize('DNDAMIGOS.AddLoot.NoIdentityWarning'));
              return;
            }

            let siteItem;
            try {
              const res = await apiRequest('add-loot.php', {
                method: 'POST',
                body: { journal_id: journalId, user_id: myUserId, description, quantity, value_gp: valueGp, notes: notes || null },
              });
              siteItem = res.item;
            } catch (err) {
              ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
              return;
            }

            editingId = null;
            items.unshift(siteItem);
            renderList();

            const foundryResult = await addLootItemToFoundryActor(description, quantity, valueGp, notes);
            if (foundryResult.status === 'added') {
              ui.notifications.info(game.i18n.format('DNDAMIGOS.AddLoot.SuccessBoth', { description }));
              await linkFoundryItemToSiteLoot(siteItem?.id, foundryResult.foundryItemId);
              siteItem.foundry_item_id = foundryResult.foundryItemId;
            } else if (foundryResult.status === 'no-actor-configured') {
              ui.notifications.info(game.i18n.format('DNDAMIGOS.AddLoot.Success', { description }));
            } else if (foundryResult.status === 'actor-missing') {
              ui.notifications.warn(game.i18n.format('DNDAMIGOS.AddLoot.SuccessSiteOnlyMissingActor', { description }));
            } else {
              ui.notifications.warn(game.i18n.format('DNDAMIGOS.AddLoot.SuccessSiteOnlyFoundryFailed', { description, error: foundryResult.error }));
            }
            return;
          }

          try {
            const res = await apiRequest('update-loot.php', {
              method: 'POST',
              body: { id: item.id, description, quantity, value_gp: valueGp, notes: notes || null },
            });
            Object.assign(item, res.item);
          } catch (err) {
            ui.notifications.error(game.i18n.format('DNDAMIGOS.Error.Generic', { error: err.message }));
            return;
          }

          editingId = null;
          renderList();

          const updateMessages = {
            success: 'DNDAMIGOS.ManageLoot.UpdatedBoth',
            itemMissing: 'DNDAMIGOS.ManageLoot.UpdatedFoundryItemMissing',
            failed: 'DNDAMIGOS.ManageLoot.UpdatedFoundryFailed',
            siteOnly: 'DNDAMIGOS.ManageLoot.UpdatedSiteOnly',
          };
          if (item.foundry_item_id) {
            notifyLootActorSyncResult(
              await updateLootItemOnFoundryActor(item.foundry_item_id, description, quantity, valueGp, notes),
              updateMessages
            );
          } else {
            ui.notifications.info(game.i18n.localize(updateMessages.siteOnly));
          }
        }
      });
    },
    width: 560,
  });
}

/* --------------------------------------------------------------------
   "Import from D&D Amigos" — D&D Amigos menu item, GM only (creates
   real JournalEntry world documents, which players can't by default).
   Pulls Places/NPCs/Loot in as Journal Entries and shows the current
   user's E.Y.F.F.O. mini-game stats, if any.
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

  await upsertJournalFromList('D&D Amigos: Loot', info.loot, (item) => ({
    name: `${item.description} ${item.quantity > 1 ? `x${item.quantity}` : ''}`.trim(),
    text: { content: `<p>${item.value_gp ? `Value: ${item.value_gp} gp<br>` : ''}${foundry.utils.escapeHTML(item.notes || '')}</p>` },
  }));

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
            <p><strong>${foundry.utils.escapeHTML(p.name)}</strong> — Level ${p.level}</p>
            <p>HP ${p.hp_current}/${p.hp_max} · Gold ${p.gold} · Turns ${p.turns_remaining}</p>
            <p>Attack ${p.attack} · Defense ${p.defense} · Cargo ${p.cargo_capacity}</p>
          `,
          buttons: { ok: { label: 'OK' } },
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

/**
 * Creates (or replaces the pages of) one Journal Entry named `title`,
 * with one Journal Entry Page per item in `items`, using `toPage` to
 * turn a site record into a page's {name, text} shape.
 */
async function upsertJournalFromList(title, items, toPage) {
  if (!items.length) return;

  const pages = items.map((item) => {
    const page = toPage(item);
    return { name: page.name, type: 'text', text: page.text };
  });

  const existing = game.journal.find((j) => j.name === title);
  if (existing) {
    await existing.deleteEmbeddedDocuments('JournalEntryPage', existing.pages.map((p) => p.id));
    await existing.createEmbeddedDocuments('JournalEntryPage', pages);
  } else {
    await JournalEntry.create({ name: title, pages });
  }
}
