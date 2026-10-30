// D&D Amigos Connector — scripts/character-import.js
//
// Import a character from another campaign: bring a Part 1 character into Part 2. The window
// lists the characters in the site's OTHER campaigns that have a full sheet saved; picking one
// makes a separate copy in this world's campaign on the site (the original is left exactly as
// it was, nothing links the two) and builds a new actor here from the copy's full saved sheet,
// linked to it so Pull and Push work as usual.
//
// The copy can be renamed in the same window. When this world already has an actor by that
// name, or this campaign already has a character by it, the name box is filled with a
// suggestion ("Cheese (Stolen Fate - Part 1)") and says why; typing another name checks it again.
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

/**
 * Opens the picker. `prefill` ({ sourceId, name }) reopens it on a character with its name
 * already typed, after the site refused a name as already taken.
 */
export async function openCharacterImport(prefill = null) {
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
  let here = [];
  try {
    characters = (await deps.apiRequest(`characters-elsewhere.php?journal_id=${journalId}`)).characters;
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }
  try {
    here = (await deps.apiRequest(`characters-list.php?journal_id=${journalId}`)).characters;
  } catch (err) {
    // the name check is a convenience; without it the site still refuses a true duplicate
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
      ${list.map((c) => `<option value="${esc(c.id)}" data-name="${esc(c.name)}" data-campaign="${esc(campaign)}"${prefill?.sourceId === c.id ? ' selected' : ''}>${esc(label(c))}</option>`).join('')}
    </optgroup>`).join('');

  const lower = (s) => String(s || '').trim().toLowerCase();
  const campaignNames = new Set(here.map((c) => lower(c.name)));
  const taken = (name) => !!lower(name) && (campaignNames.has(lower(name)) || game.actors.some((a) => lower(a.name) === lower(name)));
  /** "Cheese", else "Cheese (Stolen Fate - Part 1)", else that with " 2", " 3"... */
  const suggest = (name, campaign) => {
    let candidate = `${name} (${campaign})`;
    for (let n = 2; taken(candidate); n += 1) candidate = `${name} (${campaign}) ${n}`;
    return candidate;
  };

  openDialog({
    title: t('DNDAMIGOS.CharImport.Title'),
    width: 480,
    content: `
      <p>${t('DNDAMIGOS.CharImport.Body')}</p>
      <div class="form-group">
        <label>${t('DNDAMIGOS.CharImport.Pick')}</label>
        <select name="source" style="width:100%;">${options}</select>
      </div>
      <div class="form-group">
        <label>${t('DNDAMIGOS.CharImport.NameLabel')}</label>
        <input type="text" name="newname" maxlength="120" style="width:100%;">
        <p class="notes dab-name-note" style="margin:4px 0 0;color:#b8860b;" hidden></p>
      </div>`,
    buttons: {
      import: {
        label: t('DNDAMIGOS.CharImport.Import'),
        icon: '<i class="fa-solid fa-file-import"></i>',
        callback: (html) => {
          const select = html.find('[name="source"]')[0];
          const original = select.selectedOptions[0]?.dataset.name || '';
          const name = String(html.find('[name="newname"]').val() || '').trim() || original;
          return importCharacter(Number(select.value), name, original);
        },
      },
      cancel: { label: t('Cancel') },
    },
    default: 'import',
    render: (html) => {
      const select = html.find('[name="source"]')[0];
      const input = html.find('[name="newname"]')[0];
      const note = html.find('.dab-name-note')[0];
      const say = (text) => { note.textContent = text; note.hidden = !text; };
      const picked = () => select.selectedOptions[0]?.dataset || {};

      const onPick = (typedName) => {
        const { name = '', campaign = '' } = picked();
        if (typedName !== undefined) {
          input.value = typedName;
          say(taken(typedName) ? t('DNDAMIGOS.CharImport.NameTaken', { name: typedName }) : '');
        } else if (taken(name)) {
          input.value = suggest(name, campaign);
          say(t('DNDAMIGOS.CharImport.NameRenamed', { name, suggestion: input.value }));
        } else {
          input.value = name;
          say('');
        }
      };
      select.addEventListener('change', () => onPick());
      input.addEventListener('input', () => say(taken(input.value) ? t('DNDAMIGOS.CharImport.NameTaken', { name: input.value.trim() }) : ''));
      onPick(prefill?.sourceId === Number(select.value) ? prefill.name : undefined);
      if (prefill?.name) input.focus();
    },
  });
}

async function importCharacter(sourceId, name, original) {
  const journalId = game.settings.get(deps.MODULE_ID, 'journalId');

  let copy;
  try {
    copy = (await deps.apiRequest('copy-character.php', {
      method: 'POST',
      body: { character_id: sourceId, journal_id: journalId, user_id: deps.getMyUserId(), name },
    })).character;
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: err.message }));
    // "this campaign already has that name": bring the window straight back to rename it
    if (err.status === 409) openCharacterImport({ sourceId, name });
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
  data.name = copy.name;
  data.ownership = { default: 0, [game.user.id]: 3 };
  data.flags = { ...(data.flags || {}), [deps.MODULE_ID]: { ...(data.flags?.[deps.MODULE_ID] || {}), characterId: copy.id, characterName: copy.name } };

  let actor;
  try {
    actor = await buildActor(data, snapshot._stats);
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.CharImport.ActorFailed', { name: copy.name, error: err.message }));
    return;
  }
  ui.notifications.info(t('DNDAMIGOS.CharImport.Done', { name: copy.name, items: actor.items?.size ?? 0 }));
  actor.sheet?.render(true);
}

/**
 * Makes the actor from the saved sheet. The way that matches Pull and Restore is used first: an
 * empty actor, then Foundry's own "Import Data" on it, which cleans and migrates the whole sheet
 * the way a re-pull does (a sheet made straight from old saved data once ignored weapons dragged
 * onto it until it was re-pulled). If that is refused, the actor is made directly from the data.
 */
async function buildActor(data, stats) {
  const ActorClass = globalThis.getDocumentClass?.('Actor') ?? Actor;
  const ownership = data.ownership;
  let actor = null;
  try {
    actor = await ActorClass.create({ name: data.name, type: data.type, ownership });
    const { ownership: ignored, ...importable } = data;
    if (stats) importable._stats = stats; // Pull and Restore import the sheet whole, version stamp included
    await actor.importFromJSON(JSON.stringify(importable));
    // the import replaces the actor's flags and may reset who owns it; put both back
    await actor.update({ ownership, [`flags.${deps.MODULE_ID}`]: data.flags?.[deps.MODULE_ID] ?? {} });
    return actor;
  } catch (err) {
    console.warn(`${deps.MODULE_ID} | Import Data refused, creating the actor directly`, err);
    if (actor) await actor.delete().catch(() => {});
  }
  return ActorClass.create(data);
}
