// D&D Amigos Connector — scripts/stash.js
//
// Party loot lives in Foundry: the PF2e Party actor's inventory IS the party stash
// (drag items in from compendiums or character sheets, split coins, and so on, all
// standard PF2e). The website only shows a read-only snapshot of it, refreshed when
// someone clicks Sync. Everything here is a button you click — nothing runs by itself.
//
//   openStashWindow()   "Manage Loot" in the D&D Amigos menu: the stash at a glance,
//                       when it was last synced, and the buttons below.
//   openPartyInventory  opens PF2e's own Party sheet on its Inventory tab.
//   syncLootToSite()    sends the stash (items + coins) to the site
//                       (engine/api/foundry/loot-sync.php). Anyone can sync.
//   importSiteLoot()    GM, one time: copies the old site-side loot ledger into the
//                       Party stash as treasure items, then syncs.
//
// main.js hands over its API helpers through configureStash(), so the two files never
// import each other.

import { openDialog, confirmDialog } from './windows.js';
import { esc, t, getParty, formatCp } from './util.js';

let deps = null;

export function configureStash(d) {
  deps = d;
}


const TYPE_LABELS = {
  weapon: 'Weapon',
  armor: 'Armor',
  shield: 'Shield',
  consumable: 'Consumable',
  ammo: 'Consumable',
  equipment: 'Equipment',
  treasure: 'Treasure',
  backpack: 'Container',
  book: 'Book',
};

const copperOf = (coins) => Number(coins?.copperValue ?? 0);

function formatCoins(coins) {
  const parts = ['pp', 'gp', 'sp', 'cp'].filter((d) => Number(coins?.[d])).map((d) => `${Number(coins[d]).toLocaleString()} ${d}`);
  return parts.length ? parts.join(' · ') : t('DNDAMIGOS.Stash.NoCoins');
}

function formatWhen(utc) {
  if (!utc) return t('DNDAMIGOS.Stash.NeverSynced');
  const d = new Date(String(utc).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? utc : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The stash's physical items, minus coins (those are sent separately as the coin totals). */
function stashItems(party) {
  return party.inventory.filter((item) => !(item.type === 'treasure' && item.isCurrency));
}

/**
 * One item as the site stores it. An unidentified item goes up under the name the table
 * sees, with no level, value or link, so the site can't give away what it is.
 */
function itemSnapshot(item) {
  const identified = item.isIdentified !== false;
  const qty = Math.max(1, Number(item.quantity) || 1);
  const valueCp = copperOf(item.assetValue);
  const fromPf2e = String(item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? '').startsWith('Compendium.pf2e.');
  return {
    name: item.name,
    qty,
    level: identified ? Number(item.level ?? 0) : null,
    type: TYPE_LABELS[item.type] ?? (item.type ? item.type[0].toUpperCase() + item.type.slice(1) : ''),
    rarity: identified ? String(item.rarity ?? '') : '',
    unit_cp: identified ? Math.round(valueCp / qty) : null,
    value_cp: identified ? valueCp : null,
    identified,
    // Archives of Nethys has no page id to match a compendium item to, so link its search.
    link: identified && fromPf2e ? `https://2e.aonprd.com/Search.aspx?q=${encodeURIComponent(item.name)}` : '',
  };
}

/** What the window shows: worth of what this user can see (PF2e's own rule hides unidentified values from players). */
function stashSummary(party) {
  const coins = party.inventory.coins;
  return {
    coins,
    itemCount: stashItems(party).length,
    totalCp: copperOf(party.inventory.totalWealth),
  };
}

function openPartyInventory() {
  const party = getParty();
  if (!party) {
    ui.notifications.warn(t('DNDAMIGOS.Stash.NoParty'));
    return;
  }
  if (!party.testUserPermission(game.user, 'OBSERVER')) {
    ui.notifications.warn(t('DNDAMIGOS.Stash.NoPermission', { party: party.name }));
    return;
  }
  party.sheet.render(true, { tab: 'inventory' });
}

/** Sends the stash to the site. Returns the site's answer, or null after showing what went wrong. */
export async function syncLootToSite({ quiet = false } = {}) {
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return null;
  }
  const party = getParty();
  if (!party) {
    ui.notifications.warn(t('DNDAMIGOS.Stash.NoParty'));
    return null;
  }
  const coins = party.inventory.coins;
  try {
    const result = await deps.apiRequest('loot-sync.php', {
      method: 'POST',
      body: {
        journal_id: game.settings.get(deps.MODULE_ID, 'journalId'),
        synced_by: game.user.name,
        party_name: party.name,
        coins: { pp: coins.pp ?? 0, gp: coins.gp ?? 0, sp: coins.sp ?? 0, cp: coins.cp ?? 0 },
        items: stashItems(party).map(itemSnapshot),
      },
    });
    if (!quiet) ui.notifications.info(t('DNDAMIGOS.Stash.Synced', { count: result.item_count }));
    return result;
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Stash.SyncFailed', { error: err.message }));
    return null;
  }
}

/** cp -> { gp, sp, cp } for a PF2e price. */
function cpToPrice(cp) {
  cp = Math.max(0, Math.round(cp));
  const price = {};
  if (Math.floor(cp / 100)) price.gp = Math.floor(cp / 100);
  if (Math.floor((cp % 100) / 10)) price.sp = Math.floor((cp % 100) / 10);
  if (cp % 10) price.cp = cp % 10;
  return price;
}

/**
 * GM, one time: the old site ledger's lines become treasure items in the Party stash
 * (name, quantity, value split per item, notes as the description), then the site is
 * told the import happened and the stash is synced, which switches the site's loot page
 * over to the Foundry snapshot. Returns true if it ran.
 */
async function importSiteLoot() {
  if (!game.user.isGM) return false;
  const party = getParty();
  if (!party) {
    ui.notifications.warn(t('DNDAMIGOS.Stash.NoParty'));
    return false;
  }
  const journalId = game.settings.get(deps.MODULE_ID, 'journalId');
  let legacy;
  try {
    legacy = await deps.apiRequest(`loot-legacy.php?journal_id=${journalId}`);
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Stash.SyncFailed', { error: err.message }));
    return false;
  }
  if (!legacy.items.length) {
    ui.notifications.info(t('DNDAMIGOS.Stash.ImportNothing'));
    return false;
  }
  const ok = await confirmDialog({
    title: t('DNDAMIGOS.Stash.ImportTitle'),
    content: `<p>${esc(t('DNDAMIGOS.Stash.ImportConfirm', { count: legacy.items.length, party: party.name }))}</p>
      <ul>${legacy.items.slice(0, 12).map((i) => `<li>${esc(i.description)}${i.quantity > 1 ? ` ×${i.quantity}` : ''}${i.value_gp ? ` (${i.value_gp} gp)` : ''}</li>`).join('')}${legacy.items.length > 12 ? '<li>…</li>' : ''}</ul>`,
  });
  if (!ok) return false;

  const data = legacy.items.map((line) => {
    const qty = Math.max(1, Number(line.quantity) || 1);
    // The ledger's value was for the whole line; PF2e prices are per item.
    const unitCp = line.value_gp ? (Number(line.value_gp) * 100) / qty : 0;
    return {
      name: line.description,
      type: 'treasure',
      system: {
        quantity: qty,
        price: { value: cpToPrice(unitCp) },
        description: { value: line.notes ? `<p>${esc(line.notes)}</p>` : '' },
      },
    };
  });
  try {
    await party.createEmbeddedDocuments('Item', data);
    await deps.apiRequest('loot-legacy.php', { method: 'POST', body: { journal_id: journalId, imported_by: game.user.name } });
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Stash.SyncFailed', { error: err.message }));
    return false;
  }
  ui.notifications.info(t('DNDAMIGOS.Stash.Imported', { count: data.length, party: party.name }));
  await syncLootToSite();
  return true;
}

/* --------------------------------------------------------------------
   The Party Stash window ("Manage Loot" in the D&D Amigos menu)
-------------------------------------------------------------------- */

let stashWindow = null;

export async function openStashWindow() {
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  const party = getParty();
  if (!party) {
    openDialog({
      title: t('DNDAMIGOS.Stash.Title'),
      content: `<p>${esc(t('DNDAMIGOS.Stash.NoParty'))}</p>`,
      buttons: { close: { label: game.i18n.localize('Close') } },
      width: 380,
    });
    return;
  }
  if (stashWindow?.rendered) {
    stashWindow.bringToFront?.();
    return;
  }

  let status = null;
  try {
    status = await deps.apiRequest(`loot-sync.php?journal_id=${game.settings.get(deps.MODULE_ID, 'journalId')}`);
  } catch (err) {
    ui.notifications.warn(t('DNDAMIGOS.Stash.SyncFailed', { error: err.message }));
  }
  const offerImport = game.user.isGM && status && status.legacy.count > 0 && !status.legacy.imported_at;
  const summary = stashSummary(party);

  stashWindow = openDialog({
    title: t('DNDAMIGOS.Stash.Title'),
    content: `
      <div class="dnd-amigos-stash">
        <p class="dnd-amigos-stash-party"><i class="fa-solid fa-users"></i> ${esc(party.name)}</p>
        <p class="dnd-amigos-stash-coins" data-role="coins">${esc(formatCoins(summary.coins))}</p>
        <p class="dnd-amigos-stash-meta" data-role="meta">${esc(t('DNDAMIGOS.Stash.Summary', { count: summary.itemCount, total: formatCp(summary.totalCp) }))}</p>
        <p class="dnd-amigos-stash-meta" data-role="synced">${esc(t('DNDAMIGOS.Stash.LastSynced', { when: formatWhen(status?.synced_at) }))}</p>
        <div class="dnd-amigos-stash-actions">
          <button type="button" data-action="open"><i class="fa-solid fa-box-open"></i> ${esc(t('DNDAMIGOS.Stash.OpenInventory'))}</button>
          <button type="button" data-action="sync" class="dnd-amigos-menu-item-gold"><i class="fa-solid fa-cloud-arrow-up"></i> ${esc(t('DNDAMIGOS.Stash.Sync'))}</button>
          ${offerImport ? `<button type="button" data-action="import"><i class="fa-solid fa-file-import"></i> ${esc(t('DNDAMIGOS.Stash.Import', { count: status.legacy.count }))}</button>` : ''}
        </div>
        <p class="dnd-amigos-stash-hint">${esc(t('DNDAMIGOS.Stash.Hint'))}</p>
      </div>
    `,
    buttons: { close: { label: game.i18n.localize('Close') } },
    width: 380,
    render: (html) => {
      const refresh = (syncedAt) => {
        const s = stashSummary(party);
        html.find('[data-role="coins"]').text(formatCoins(s.coins));
        html.find('[data-role="meta"]').text(t('DNDAMIGOS.Stash.Summary', { count: s.itemCount, total: formatCp(s.totalCp) }));
        if (syncedAt) html.find('[data-role="synced"]').text(t('DNDAMIGOS.Stash.LastSynced', { when: formatWhen(syncedAt) }));
      };
      html.find('[data-action="open"]').on('click', () => openPartyInventory());
      html.find('[data-action="sync"]').on('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        const result = await syncLootToSite();
        btn.disabled = false;
        if (result) refresh(result.synced_at);
      });
      html.find('[data-action="import"]').on('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        const ran = await importSiteLoot();
        if (ran) {
          btn.remove();
          refresh(new Date().toISOString().slice(0, 19).replace('T', ' '));
        } else {
          btn.disabled = false;
        }
      });
    },
    close: () => { stashWindow = null; },
  });
}
