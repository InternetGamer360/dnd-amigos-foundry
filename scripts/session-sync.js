// D&D Amigos Connector — scripts/session-sync.js
//
// End of Session Sync: one window that brings the website up to date with this world,
// so between sessions the site is a current read-only record. A checklist first (every
// part ticked), then Sync runs each part in turn and reports how it went, line by line.
//
//   GM:      the Party stash, every character in The Party (each pushed to its Character
//            Vault entry, or created there if it isn't linked yet), and NPCs & Places.
//   Player:  the Party stash and their own character(s) in The Party.
//
// Still click-to-run like the rest of the module: nothing happens until Sync is pressed.
// The pieces are the same ones the separate buttons use (stash.js, lore.js, and the
// character push in main.js, handed over through configureSessionSync()).

import { openDialog } from './windows.js';
import { syncLootToSite } from './stash.js';
import { pushLoreCore, countLorePages } from './lore.js';

let deps = null;

export function configureSessionSync(d) {
  deps = d;
}

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

function getParty() {
  return game.actors?.party ?? game.actors?.find?.((a) => a.type === 'party') ?? null;
}

/** The characters this user syncs: every character in The Party for the GM, their own for a player. */
function characterTargets(party) {
  const members = (party?.members ?? []).filter((a) => a.type === 'character');
  return game.user.isGM ? members : members.filter((a) => a.isOwner);
}

function formatCp(cp) {
  cp = Math.max(0, Math.round(cp));
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  const parts = [];
  if (gp) parts.push(`${gp.toLocaleString()} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (c) parts.push(`${c} cp`);
  return parts.length ? parts.join(' ') : '0 gp';
}

let syncWindow = null;

export function openSessionSync() {
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  if (syncWindow?.rendered) {
    syncWindow.bringToFront?.();
    return;
  }

  const isGM = game.user.isGM;
  const party = getParty();
  const hasIdentity = !!deps.getMyUserId();
  const characters = characterTargets(party);
  const lorePages = isGM ? countLorePages() : 0;

  const stashDetail = party
    ? t('DNDAMIGOS.SessionSync.StashDetail', {
      party: party.name,
      count: party.inventory.filter((i) => !(i.type === 'treasure' && i.isCurrency)).length,
      total: formatCp(Number(party.inventory.totalWealth?.copperValue ?? 0)),
    })
    : t('DNDAMIGOS.Stash.NoParty');

  const charRows = characters.map((a) => {
    const linked = !!a.getFlag(deps.MODULE_ID, 'characterId');
    return `<li data-actor="${esc(a.id)}"><span class="dnd-amigos-ss-name">${esc(a.name)}</span>
      <span class="dnd-amigos-ss-plan">${esc(t(linked ? 'DNDAMIGOS.SessionSync.WillUpdate' : 'DNDAMIGOS.SessionSync.WillCreate'))}</span>
      <span class="dnd-amigos-ss-status" data-role="char-status"></span></li>`;
  }).join('');

  const part = (key, label, detail, { enabled = true, extra = '' } = {}) => `
    <div class="dnd-amigos-ss-part${enabled ? '' : ' is-disabled'}" data-part="${key}">
      <label><input type="checkbox" data-role="tick" ${enabled ? 'checked' : 'disabled'}> <strong>${esc(label)}</strong></label>
      <span class="dnd-amigos-ss-status" data-role="status"></span>
      <p class="dnd-amigos-ss-detail">${esc(detail)}</p>
      ${extra}
    </div>`;

  const charDetail = !hasIdentity ? t('DNDAMIGOS.SessionSync.NeedIdentity')
    : !characters.length ? t(isGM ? 'DNDAMIGOS.SessionSync.NoMembers' : 'DNDAMIGOS.SessionSync.NoOwnCharacter')
      : t(isGM ? 'DNDAMIGOS.SessionSync.CharsDetailGm' : 'DNDAMIGOS.SessionSync.CharsDetailPlayer', { count: characters.length });

  const content = `
    <div class="dnd-amigos-session-sync">
      <p class="dnd-amigos-ss-intro">${esc(t(isGM ? 'DNDAMIGOS.SessionSync.IntroGm' : 'DNDAMIGOS.SessionSync.IntroPlayer'))}</p>
      ${part('stash', t('DNDAMIGOS.SessionSync.Stash'), stashDetail, { enabled: !!party })}
      ${part('characters', t(isGM ? 'DNDAMIGOS.SessionSync.CharactersGm' : 'DNDAMIGOS.SessionSync.CharactersPlayer'), charDetail, {
        enabled: hasIdentity && characters.length > 0,
        extra: characters.length ? `<ul class="dnd-amigos-ss-chars">${charRows}</ul>` : '',
      })}
      ${isGM ? part('lore', t('DNDAMIGOS.SessionSync.Lore'), hasIdentity ? t('DNDAMIGOS.SessionSync.LoreDetail', { count: lorePages }) : t('DNDAMIGOS.SessionSync.NeedIdentity'), { enabled: hasIdentity && lorePages > 0 }) : ''}
      <button type="button" data-action="run" class="dnd-amigos-menu-item-gold"><i class="fa-solid fa-cloud-arrow-up"></i> ${esc(t('DNDAMIGOS.SessionSync.Run'))}</button>
      <p class="dnd-amigos-ss-summary" data-role="summary"></p>
    </div>`;

  syncWindow = openDialog({
    title: t('DNDAMIGOS.SessionSync.Title'),
    content,
    buttons: { close: { label: game.i18n.localize('Close') } },
    width: 460,
    render: (html) => {
      const root = html[0];
      const runBtn = root.querySelector('[data-action="run"]');
      const partEl = (key) => root.querySelector(`[data-part="${key}"]`);
      const ticked = (key) => !!partEl(key)?.querySelector('[data-role="tick"]')?.checked;
      const setStatus = (el, text, kind) => {
        if (!el) return;
        el.textContent = text;
        el.className = `dnd-amigos-ss-status${kind ? ` is-${kind}` : ''}`;
      };

      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        root.querySelectorAll('[data-role="tick"]').forEach((c) => { c.disabled = true; });
        let failures = 0;
        let ran = 0;

        if (ticked('stash')) {
          ran++;
          const status = partEl('stash').querySelector('[data-role="status"]');
          setStatus(status, t('DNDAMIGOS.SessionSync.Working'), 'working');
          const r = await syncLootToSite({ quiet: true });
          if (r) setStatus(status, t('DNDAMIGOS.SessionSync.StashDone', { count: r.item_count }), 'ok');
          else { failures++; setStatus(status, t('DNDAMIGOS.SessionSync.Failed'), 'error'); }
        }

        if (ticked('characters')) {
          ran++;
          const status = partEl('characters').querySelector('[data-role="status"]');
          setStatus(status, t('DNDAMIGOS.SessionSync.Working'), 'working');
          let ok = 0;
          for (const actor of characters) {
            const row = root.querySelector(`li[data-actor="${CSS.escape(actor.id)}"] [data-role="char-status"]`);
            setStatus(row, '…', 'working');
            let r;
            try {
              r = await deps.syncCharacterCore(actor);
            } catch (err) {
              r = { ok: false, error: err.message };
            }
            if (r.ok) {
              ok++;
              const extra = [r.tokenError ? t('DNDAMIGOS.SessionSync.TokenFailed') : '', r.snapshotSaved ? '' : r.snapshotLine].filter(Boolean).join(' · ');
              setStatus(row, `${t(r.action === 'created' ? 'DNDAMIGOS.SessionSync.Created' : 'DNDAMIGOS.SessionSync.Updated')}${extra ? ` (${extra})` : ''}`, extra ? 'warn' : 'ok');
            } else {
              failures++;
              setStatus(row, r.error, 'error');
            }
          }
          setStatus(status, t('DNDAMIGOS.SessionSync.CharsDone', { ok, count: characters.length }), ok === characters.length ? 'ok' : 'error');
        }

        if (ticked('lore')) {
          ran++;
          const status = partEl('lore').querySelector('[data-role="status"]');
          setStatus(status, t('DNDAMIGOS.SessionSync.Working'), 'working');
          let r;
          try {
            r = await pushLoreCore();
          } catch (err) {
            r = { lines: [], problems: [err.message] };
          }
          if (r.problems.length) failures += r.problems.length;
          setStatus(status, [...r.lines, ...r.problems].join(' · ') || t('DNDAMIGOS.Lore.NothingToPush'), r.problems.length ? 'error' : 'ok');
        }

        const summary = root.querySelector('[data-role="summary"]');
        summary.textContent = !ran ? t('DNDAMIGOS.SessionSync.NothingTicked')
          : failures ? t('DNDAMIGOS.SessionSync.DoneWithProblems', { count: failures }) : t('DNDAMIGOS.SessionSync.AllDone');
        summary.className = `dnd-amigos-ss-summary ${failures ? 'is-error' : 'is-ok'}`;
        if (!failures && ran) ui.notifications.info(t('DNDAMIGOS.SessionSync.AllDone'));
      });
    },
    close: () => { syncWindow = null; },
  });
}
