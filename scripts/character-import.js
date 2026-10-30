// D&D Amigos Connector — scripts/character-import.js
//
// Import a character from another campaign: bring a Part 1 character into Part 2. The window
// lists the characters in the site's OTHER campaigns that have a full sheet saved; picking one
// makes a separate copy in this world's campaign on the site (the original is left exactly as
// it was, nothing links the two) and builds a new actor here from the copy's full saved sheet,
// linked to it so Pull and Push work as usual.
//
// Still click-to-run like the rest of the module. main.js hands over its API helpers through
// configureCharacterImport(), so the two files never import each other.

import { openDialog } from './windows.js';
import { esc, t } from './util.js';

let deps = null;

export function configureCharacterImport(d) {
  deps = d;
}

const label = (c) => `${c.name} — ${t('DNDAMIGOS.CharImport.Level', { level: c.level })}${[c.race, c.class].filter(Boolean).length ? ' ' + [c.race, c.class].filter(Boolean).join(' ') : ''}${c.player_display ? ` (${c.player_display})` : ''}`;

export async function openCharacterImport() {
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  if (!game.user.can('ACTOR_CREATE')) {
    ui.notifications.warn(t('DNDAMIGOS.CharImport.NoPermission'));
    return;
  }
  const journalId = game.settings.get(deps.MODULE_ID, 'journalId');
  let characters;
  try {
    characters = (await deps.apiRequest(`characters-elsewhere.php?journal_id=${journalId}`)).characters;
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }
  // Only sheets saved from this game system can become an actor here.
  const usable = characters.filter((c) => !c.system_id || c.system_id === game.system.id);
  if (!usable.length) {
    ui.notifications.info(t('DNDAMIGOS.CharImport.None'));
    return;
  }

  const byCampaign = new Map();
  usable.forEach((c) => {
    if (!byCampaign.has(c.campaign_name)) byCampaign.set(c.campaign_name, []);
    byCampaign.get(c.campaign_name).push(c);
  });
  const options = [...byCampaign.entries()].map(([campaign, list]) => `
    <optgroup label="${esc(campaign)}">
      ${list.map((c) => `<option value="${esc(c.id)}">${esc(label(c))}</option>`).join('')}
    </optgroup>`).join('');

  openDialog({
    title: t('DNDAMIGOS.CharImport.Title'),
    width: 480,
    content: `
      <p>${t('DNDAMIGOS.CharImport.Body')}</p>
      <div class="form-group">
        <label>${t('DNDAMIGOS.CharImport.Pick')}</label>
        <select name="source" style="width:100%;">${options}</select>
      </div>`,
    buttons: {
      import: {
        label: t('DNDAMIGOS.CharImport.Import'),
        icon: '<i class="fa-solid fa-file-import"></i>',
        callback: (html) => importCharacter(Number(html.find('[name="source"]').val())),
      },
      cancel: { label: t('Cancel') },
    },
    default: 'import',
  });
}

async function importCharacter(sourceId) {
  const journalId = game.settings.get(deps.MODULE_ID, 'journalId');

  let copy;
  try {
    copy = (await deps.apiRequest('copy-character.php', {
      method: 'POST',
      body: { character_id: sourceId, journal_id: journalId, user_id: deps.getMyUserId() },
    })).character;
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  let snapshot;
  try {
    snapshot = (await deps.apiRequest(`character-snapshot.php?character_id=${copy.id}`)).snapshot;
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.CharImport.ActorFailed', { name: copy.name, error: err.message }));
    return;
  }

  // The saved sheet is the actor as Foundry exported it. Take what belongs to the old world
  // (its id, folder, sort order, who owned it) off, make this user the owner, and link it to the
  // copy that now exists in this campaign (the saved flags still point at the original).
  const data = foundry.utils.deepClone(snapshot);
  for (const key of ['_id', 'folder', 'sort', '_stats', 'ownership']) delete data[key];
  data.ownership = { default: 0, [game.user.id]: 3 };
  data.flags = { ...(data.flags || {}), [deps.MODULE_ID]: { ...(data.flags?.[deps.MODULE_ID] || {}), characterId: copy.id, characterName: copy.name } };

  let actor;
  try {
    const ActorClass = globalThis.getDocumentClass?.('Actor') ?? Actor;
    actor = await ActorClass.create(data);
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.CharImport.ActorFailed', { name: copy.name, error: err.message }));
    return;
  }
  ui.notifications.info(t('DNDAMIGOS.CharImport.Done', { name: copy.name, items: actor.items?.size ?? 0 }));
  actor.sheet?.render(true);
}
