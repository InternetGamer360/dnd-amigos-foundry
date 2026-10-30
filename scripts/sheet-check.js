// D&D Amigos Connector — scripts/sheet-check.js
//
// "Check sheet": a troubleshooting window on a character sheet (Pathfinder 2e / Starfinder 2e).
// It looks for the usual reasons a sheet misbehaves after items move between actors, says what it
// found in plain words, and can put a single item back the way the site's saved copy has it, so
// a bad weapon doesn't mean pulling the whole sheet again. Nothing changes until a Restore or Add
// button is pressed and confirmed.
//
// What it checks, all on this client with no changes:
//   - items Foundry flagged as invalid when the actor loaded;
//   - items made under a different Foundry or system version than this world runs (a weapon
//     dragged over from an older world keeps its old data layout until something migrates it);
//   - references to things that are not on this actor: a container, or the item that granted it;
//   - rule elements the system doesn't recognise (an unknown or missing key);
//   - carry-state conflicts: "held" with no hands or hands without "held", more than two armors
//     worn, more hands in use than a character has, more invested items than the usual limit;
//   - weapons that are carried but have no Strike on the sheet;
//   - when the actor is linked to the site: items that are missing, extra or different compared
//     with the site's last saved copy.
// "Copy report" puts all of it, plus the versions and active modules, on the clipboard.
//
// main.js hands over its API helpers through configureSheetCheck(); the sheet buttons are added
// here with the same two header hooks the Sync button uses.

import { MODULE_ID, esc, t, addHeaderButton } from './util.js';
import { openDialog, confirmDialog } from './windows.js';

let deps = null;

export function configureSheetCheck(d) {
  deps = d;
}

const SUPPORTED = ['pf2e', 'sf2e'];
const IGNORED_ITEM_KEYS = ['_id', '_stats', 'sort', 'ownership', 'folder'];
// Bookkeeping the system rewrites on every item when it updates; never a real difference.
const IGNORED_DIFF_KEYS = ['system._migration', 'flags.core'];

const major = (v) => String(v ?? '').split('.')[0];
// The site stores a sheet through PHP, which turns every empty object {} into an empty array [], so
// the two are treated as the same thing here; otherwise every empty field would show as "changed".
const stable = (v) => JSON.stringify(v, (k, val) => {
  if (Array.isArray(val)) return val.length ? val : {};
  return val && typeof val === 'object'
    ? Object.fromEntries(Object.keys(val).sort().map((x) => [x, val[x]]))
    : val;
});

/** `site` with each empty array put back as an empty object wherever `local` has an object there. */
function reshape(site, local) {
  if (Array.isArray(site)) {
    if (!site.length && local && typeof local === 'object' && !Array.isArray(local)) return {};
    return site.map((v, i) => reshape(v, Array.isArray(local) ? local[i] : undefined));
  }
  if (site && typeof site === 'object') {
    return Object.fromEntries(Object.entries(site).map(([k, v]) => [k, reshape(v, local?.[k])]));
  }
  return site;
}

/** The system's own flag namespace on an item (pf2e items keep theirs under "pf2e"). */
const systemFlags = (item) => item.flags?.[game.system.id] ?? item.flags?.pf2e ?? {};

/** Top-level fields that differ between this item's data and the site's copy. */
function changedKeys(local, site) {
  const out = [];
  for (const k of ['name', 'type', 'img']) if (local[k] !== site[k]) out.push(k);
  for (const root of ['system', 'flags']) {
    const a = local[root] ?? {};
    const b = site[root] ?? {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (root === 'flags' && k === MODULE_ID) continue;
      if (IGNORED_DIFF_KEYS.includes(`${root}.${k}`)) continue;
      if (stable(a[k]) !== stable(b[k])) out.push(`${root}.${k}`);
    }
  }
  return out;
}

/** Rule elements with a key the system doesn't know (or none). Rules the system merely isn't applying right now (an unworn item's, say) are normal and not reported. */
function ruleFindings(actor, add) {
  const registry = game.pf2e?.RuleElements?.all ?? game[game.system.id]?.RuleElements?.all ?? null;
  for (const item of actor.items) {
    const raw = Array.isArray(item.system?.rules) ? item.system.rules : [];
    if (!raw.length) continue;
    const unknown = raw
      .map((r) => (typeof r?.key === 'string' ? r.key : null))
      .filter((key, i) => key === null || (registry && !registry[key.replace(/^PF2E\.RuleElement\./, '')]))
      .map((key) => key ?? '(no key)');
    if (unknown.length) add('problem', t('DNDAMIGOS.Check.RuleUnknown', { name: item.name, keys: [...new Set(unknown)].join(', ') }));
  }
}

/** Contradictory or over-the-limit carrying: hands, worn armor, invested items. */
function carryFindings(actor, add) {
  let hands = 0;
  const wornArmor = [];
  const invested = [];
  const stale = [];
  for (const item of actor.items) {
    const e = item.system?.equipped;
    if (!e) continue;
    const held = e.carryType === 'held';
    const handsHeld = Number(e.handsHeld ?? 0);
    if (held !== (handsHeld > 0)) {
      add('problem', t(held ? 'DNDAMIGOS.Check.HeldNoHands' : 'DNDAMIGOS.Check.HandsNotHeld', { name: item.name, carry: e.carryType ?? '?', hands: handsHeld }));
    }
    if (held) hands += handsHeld;
    if (item.type === 'armor') {
      if (e.carryType === 'worn' && e.inSlot) wornArmor.push(item.name);
      if (held) add('note', t('DNDAMIGOS.Check.ArmorHeld', { name: item.name }));
    }
    if (e.invested === true) {
      if (item.system?.traits?.value?.includes?.('invested')) invested.push(item.name);
      else stale.push(item.name);
    }
  }
  if (wornArmor.length > 1) add('problem', t('DNDAMIGOS.Check.TwoArmors', { names: wornArmor.join(', ') }));
  if (hands > 2) add('note', t('DNDAMIGOS.Check.TooManyHands', { hands }));
  if (invested.length > 10) add('note', t('DNDAMIGOS.Check.OverInvested', { count: invested.length }));
  if (stale.length) add('note', t('DNDAMIGOS.Check.StaleInvested', { count: stale.length, examples: stale.slice(0, 3).join(', ') }));
}

/** The checks that need nothing but the actor. Returns [{ level: 'problem' | 'note', text }]. */
function localFindings(actor) {
  const found = [];
  const add = (level, text) => found.push({ level, text });
  const ids = new Set(actor.items.map((i) => i.id));
  const sysMajor = major(game.system.version);
  const coreMajor = major(game.version);

  const invalid = actor.items.invalidDocumentIds ? [...actor.items.invalidDocumentIds] : [];
  for (const id of invalid) {
    add('problem', t('DNDAMIGOS.Check.Invalid', { name: actor.items.getInvalid?.(id, { strict: false })?.name ?? id }));
  }

  for (const item of actor.items) {
    const stats = item._stats ?? {};
    if (stats.systemVersion && major(stats.systemVersion) !== sysMajor) {
      add('problem', t('DNDAMIGOS.Check.OldSystem', { name: item.name, made: stats.systemVersion, now: game.system.version }));
    } else if (stats.coreVersion && major(stats.coreVersion) !== coreMajor) {
      add('note', t('DNDAMIGOS.Check.OldCore', { name: item.name, made: stats.coreVersion, now: game.version }));
    }

    const containerId = item.system?.containerId;
    if (containerId && !ids.has(containerId)) add('problem', t('DNDAMIGOS.Check.NoContainer', { name: item.name }));

    const flags = systemFlags(item);
    const grantedBy = flags.grantedBy?.id;
    if (grantedBy && !ids.has(grantedBy)) add('problem', t('DNDAMIGOS.Check.NoGranter', { name: item.name }));
    for (const [slug, grant] of Object.entries(flags.itemGrants ?? {})) {
      if (grant?.id && !ids.has(grant.id)) add('problem', t('DNDAMIGOS.Check.NoGrant', { name: item.name, slug }));
    }
  }

  ruleFindings(actor, add);
  carryFindings(actor, add);

  // A carried weapon with no Strike. Stowed or dropped weapons are not supposed to have one.
  const strikes = Array.isArray(actor.system?.actions) ? actor.system.actions : null;
  if (strikes) {
    const withStrike = new Set(strikes.map((a) => a?.item?.id).filter(Boolean));
    for (const w of actor.items.filter((i) => i.type === 'weapon')) {
      const carry = w.system?.equipped?.carryType;
      if (['stowed', 'dropped'].includes(carry) || withStrike.has(w.id)) continue;
      add('problem', t('DNDAMIGOS.Check.NoStrike', {
        name: w.name,
        carry: carry ?? '?',
        hands: w.system?.equipped?.handsHeld ?? 0,
        qty: w.system?.quantity ?? '?',
      }));
    }
  }
  return found;
}

/** Items that differ from the site's saved copy: [{ kind: 'changed' | 'missing' | 'extra', ... }]. */
function compareWithSite(actor, snap) {
  const siteItems = Array.isArray(snap.items) ? snap.items : [];
  const local = actor.items.map((i) => i.toObject());
  const usedLocal = new Set();
  const out = [];

  for (const s of siteItems) {
    let match = local.find((l) => l._id === s._id && !usedLocal.has(l._id));
    if (!match) match = local.find((l) => l.name === s.name && l.type === s.type && !usedLocal.has(l._id));
    if (!match) {
      out.push({ kind: 'missing', name: s.name, type: s.type, site: s });
      continue;
    }
    usedLocal.add(match._id);
    const keys = changedKeys(match, s);
    if (keys.length) out.push({ kind: 'changed', name: s.name, type: s.type, id: match._id, keys, site: s });
  }
  for (const l of local) {
    if (!usedLocal.has(l._id)) out.push({ kind: 'extra', name: l.name, type: l.type, id: l._id });
  }
  return out;
}

async function gather(actor) {
  const result = { findings: localFindings(actor), diffs: [], site: null, siteNote: '' };
  const linkedId = actor.getFlag(MODULE_ID, 'characterId');
  if (!linkedId) {
    result.siteNote = t('DNDAMIGOS.Check.NotLinked');
  } else if (!deps.isConfigured()) {
    result.siteNote = t('DNDAMIGOS.ActorSheet.NotConfigured');
  } else {
    try {
      const saved = await deps.apiRequest(`character-snapshot.php?character_id=${linkedId}`);
      result.site = { takenAt: saved.taken_at, foundry: saved.foundry_version };
      result.diffs = compareWithSite(actor, saved.snapshot);
    } catch (err) {
      result.siteNote = t('DNDAMIGOS.Check.SiteFailed', { error: err.message });
    }
  }
  return result;
}

function reportText(actor, r) {
  const lines = [
    `${actor.name} — ${game.system.id} ${game.system.version}, Foundry ${game.version}, connector ${game.modules.get(MODULE_ID)?.version}`,
    `Active modules: ${game.modules.filter((m) => m.active).map((m) => `${m.id} ${m.version}`).join(', ')}`,
    '',
    ...(r.findings.length ? r.findings.map((f) => `[${f.level}] ${f.text}`) : ['No problems found on this sheet.']),
    '',
  ];
  if (r.site) {
    lines.push(`Site copy taken ${r.site.takenAt} (Foundry ${r.site.foundry || '?'})`);
    lines.push(...(r.diffs.length ? r.diffs.map((d) => `[${d.kind}] ${d.name} (${d.type})${d.keys ? `: ${d.keys.join(', ')}` : ''}`) : ['Items match the site copy.']));
  } else {
    lines.push(r.siteNote);
  }
  return lines.join('\n');
}

export async function openSheetCheck(actor) {
  if (!SUPPORTED.includes(game.system.id)) {
    ui.notifications.info(t('DNDAMIGOS.Check.WrongSystem'));
    return;
  }
  const r = await gather(actor);
  const problems = r.findings.filter((f) => f.level === 'problem');
  const notes = r.findings.filter((f) => f.level === 'note');

  const list = (items) => `<ul class="dac-list">${items.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>`;
  const diffRow = (d, i) => {
    const what = d.kind === 'changed'
      ? t('DNDAMIGOS.Check.Changed', { fields: d.keys.slice(0, 6).join(', ') + (d.keys.length > 6 ? ', …' : '') })
      : (d.kind === 'missing' ? t('DNDAMIGOS.Check.Missing') : t('DNDAMIGOS.Check.Extra'));
    const button = d.kind === 'changed'
      ? `<button type="button" data-fix="${i}">${t('DNDAMIGOS.Check.Restore')}</button>`
      : (d.kind === 'missing' ? `<button type="button" data-fix="${i}">${t('DNDAMIGOS.Check.Add')}</button>` : '');
    return `<li><span><strong>${esc(d.name)}</strong> <em>${esc(d.type)}</em><br>${esc(what)}</span>${button}</li>`;
  };
  const rowsOf = (kinds) => r.diffs.map((d, i) => (kinds.includes(d.kind) ? diffRow(d, i) : '')).join('');
  const extraCount = r.diffs.filter((d) => d.kind === 'extra').length;
  const mainRows = rowsOf(['changed', 'missing']);
  const diffBlock = (mainRows ? `<ul class="dac-list dac-diffs">${mainRows}</ul>` : '')
    + (extraCount ? `<details><summary>${t('DNDAMIGOS.Check.ExtraGroup', { count: extraCount })}</summary><ul class="dac-list dac-diffs">${rowsOf(['extra'])}</ul></details>` : '');
  const olderCopy = r.site && r.site.foundry && major(r.site.foundry) !== major(game.version);

  const content = `
    <div class="dac" style="max-height:60vh;overflow:auto;">
      <h3>${t('DNDAMIGOS.Check.Sheet')}</h3>
      ${problems.length ? list(problems) : `<p>${t('DNDAMIGOS.Check.NoProblems')}</p>`}
      ${notes.length ? `<h4>${t('DNDAMIGOS.Check.Notes')}</h4>${list(notes)}` : ''}
      <h3>${t('DNDAMIGOS.Check.SiteCopy')}</h3>
      ${r.site
        ? `<p class="notes">${t('DNDAMIGOS.Check.SiteTaken', { when: esc(r.site.takenAt) })}</p>
           ${olderCopy ? `<p class="notes">${t('DNDAMIGOS.Check.SiteOlder', { made: esc(r.site.foundry), now: esc(game.version) })}</p>` : ''}
           ${r.diffs.length ? diffBlock : `<p>${t('DNDAMIGOS.Check.Matches')}</p>`}`
        : `<p>${esc(r.siteNote)}</p>`}
      <p><button type="button" data-copy>${t('DNDAMIGOS.Check.Copy')}</button></p>
    </div>`;

  const dialog = openDialog({
    title: t('DNDAMIGOS.Check.Title', { name: actor.name }),
    width: 560,
    content,
    buttons: { close: { label: t('DNDAMIGOS.Check.Close') } },
    default: 'close',
    render: (html) => {
      html.find('[data-copy]').on('click', async () => {
        const text = reportText(actor, r);
        try {
          if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
          else await navigator.clipboard.writeText(text);
          ui.notifications.info(t('DNDAMIGOS.Check.Copied'));
        } catch (err) {
          ui.notifications.warn(t('DNDAMIGOS.Check.CopyFailed'));
        }
      });
      html.find('[data-fix]').on('click', async (ev) => {
        const d = r.diffs[Number(ev.currentTarget.dataset.fix)];
        if (!d) return;
        if (await applyFix(actor, d)) {
          dialog.close();
          openSheetCheck(actor);
        }
      });
    },
  });
}

/** Puts one item back the way the site's copy has it (Restore), or brings back one that is missing (Add). */
async function applyFix(actor, d) {
  const adding = d.kind === 'missing';
  const ok = await confirmDialog({
    title: t(adding ? 'DNDAMIGOS.Check.AddTitle' : 'DNDAMIGOS.Check.RestoreTitle'),
    content: `<p>${t(adding ? 'DNDAMIGOS.Check.AddBody' : 'DNDAMIGOS.Check.RestoreBody', { name: esc(d.name) })}</p>`,
  });
  if (!ok) return false;
  const localItem = d.id ? actor.items.get(d.id)?.toObject() : null;
  const data = reshape(foundry.utils.deepClone(d.site), localItem);
  try {
    if (adding) {
      await actor.createEmbeddedDocuments('Item', [data], { keepId: true });
    } else {
      // take the whole item from the site's copy, not a merge: a merge is how stale fields survive
      const update = { _id: d.id };
      for (const [k, v] of Object.entries(data)) if (!IGNORED_ITEM_KEYS.includes(k)) update[k] = v;
      await actor.updateEmbeddedDocuments('Item', [update], { diff: false, recursive: false });
    }
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: err.message }));
    return false;
  }
  ui.notifications.info(t('DNDAMIGOS.Check.Fixed', { name: d.name }));
  return true;
}

/* --------------------------------------------------------------------
   Sheet buttons (the same two header hooks the Sync button uses)
-------------------------------------------------------------------- */

Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
  if (sheet.actor?.type !== 'character' || !SUPPORTED.includes(game.system.id)) return;
  addHeaderButton(buttons, {
    label: '', // icon only: the name is the hover tooltip (see tipHeaderButtons in util.js)
    class: 'dnd-amigos-check',
    icon: 'fa-solid fa-stethoscope',
    onclick: () => openSheetCheck(sheet.actor),
  });
});

Hooks.on('getHeaderControlsActorSheetV2', (sheet, controls) => {
  if (sheet.actor?.type !== 'character' || !SUPPORTED.includes(game.system.id)) return;
  if (controls.some((c) => c.action === 'dndAmigosCheck')) return;
  controls.push({
    action: 'dndAmigosCheck',
    label: 'DNDAMIGOS.Check.HeaderButton',
    icon: 'fa-solid fa-stethoscope',
    onClick: () => openSheetCheck(sheet.actor),
  });
});
