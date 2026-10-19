// D&D Amigos Connector — scripts/lore.js
//
// NPCs and Places, kept in step with the website. The DM WRITES them in
// Foundry (one journal page each, in the two "D&D Amigos: NPCs / Places"
// journals) and pushes them up; the website then shows them and is where
// everyone's NOTES live. Everything here is a button you click — nothing runs
// by itself.
//
//   pullLore(info)    site -> Foundry. Adds pages for NPCs/places that are not here
//                     yet and refreshes pages you have not changed. It NEVER
//                     overwrites or deletes a page you edited or made in Foundry.
//   pushLore()        Foundry -> site (GM only). Sends every page in those two
//                     journals up; a page remembers its site entry, so pushing
//                     again updates it instead of duplicating it. Portraits go too.
//   openLoreDialog()  the "NPCs & Places" window: search, read, and add notes.
//
// main.js hands over the pieces of itself this file needs through
// configureLore() (its API helpers and settings), so the two files never
// import each other.

import { openDialog } from './windows.js';
import { esc, t } from './util.js';

let deps = null;

export function configureLore(d) {
  deps = d;
}

const KINDS = {
  npc: { title: 'D&D Amigos: NPCs', label: 'NPC', plural: 'NPCs', uploads: 'npcs', infoKey: 'npcs', newName: 'New NPC' },
  place: { title: 'D&D Amigos: Places', label: 'Place', plural: 'Places', uploads: 'places', infoKey: 'places', newName: 'New Place' },
};



/* --------------------------------------------------------------------
   Page content <-> lore fields.
   A page reads: a first paragraph in italics (the tagline), then the
   description. Anything else (images, headings, lists) is flattened to plain
   text for the website, which shows plain text.
-------------------------------------------------------------------- */

function htmlToLore(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  root.querySelectorAll('img, figure, script, style').forEach((n) => n.remove());

  const blockText = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    if (/^(UL|OL)$/.test(c.tagName)) {
      return [...c.querySelectorAll('li')].map((li) => `- ${li.textContent.trim()}`).join('\n');
    }
    return c.textContent.trim();
  };

  // A portrait sits in its own paragraph; once the image is removed that paragraph is empty and must not hide the tagline.
  const blocks = [...root.children].filter((b) => b.textContent.trim() !== '');
  let tagline = '';
  const first = blocks[0];
  if (
    first && first.tagName === 'P' && first.children.length === 1 &&
    ['EM', 'I'].includes(first.firstElementChild.tagName) &&
    first.textContent.trim() === first.firstElementChild.textContent.trim()
  ) {
    tagline = first.textContent.trim();
    blocks.shift();
  }
  const description = blocks.length
    ? blocks.map(blockText).filter(Boolean).join('\n\n')
    : (tagline ? '' : root.textContent.trim());
  return { tagline, description };
}

function loreToHtml({ tagline, description, imageUrl }) {
  const paragraphs = String(description || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return (
    (imageUrl ? `<p><img src="${esc(imageUrl)}" alt=""></p>` : '') +
    (tagline ? `<p><em>${esc(tagline)}</em></p>` : '') +
    paragraphs
  );
}

/** A small stable hash of a page's text, to tell "unchanged since we wrote it" from "edited in Foundry". */
function hashText(s) {
  let h = 2166136261;
  const str = String(s || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** The first image in a page's HTML (its portrait), or ''. */
function firstImageSrc(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
  return m ? m[1] : '';
}

function portraitUrl(kind, item) {
  if (!item.image_path) return '';
  const base = String(game.settings.get(deps.MODULE_ID, 'siteUrl') || '').replace(/\/+$/, '');
  return `${base}/engine/uploads/${KINDS[kind].uploads}/${item.image_path}`;
}

const flagsOf = (page) => page.flags?.[deps.MODULE_ID] || {};

function findLoreJournal(kind) {
  return game.journal.find((j) => j.name === KINDS[kind].title) || null;
}

async function ensureLoreJournal(kind) {
  return findLoreJournal(kind) || JournalEntry.create({ name: KINDS[kind].title });
}

/* --------------------------------------------------------------------
   Pull: site -> Foundry (GM only; the caller checks)
-------------------------------------------------------------------- */

/**
 * Brings the site's NPCs and places into the two lore journals without ever
 * overwriting work done here. Returns { npc: {...}, place: {...} } counts of
 * added / updated / kept (changed in Foundry, so left alone) / linked.
 */
export async function pullLore(info) {
  const summary = {};
  for (const kind of Object.keys(KINDS)) {
    const items = info[KINDS[kind].infoKey] || [];
    const counts = { added: 0, updated: 0, kept: 0, linked: 0 };
    summary[kind] = counts;
    if (!items.length && !findLoreJournal(kind)) continue;

    const journal = await ensureLoreJournal(kind);
    const pages = [...journal.pages];
    const bySiteId = new Map(pages.filter((p) => flagsOf(p).siteId).map((p) => [Number(flagsOf(p).siteId), p]));
    const byName = new Map(pages.filter((p) => !flagsOf(p).siteId).map((p) => [p.name.trim().toLowerCase(), p]));

    const toCreate = [];
    for (const item of items) {
      const html = loreToHtml({ tagline: item.tagline, description: item.description, imageUrl: portraitUrl(kind, item) });
      const flags = { [deps.MODULE_ID]: { siteId: item.id, kind, syncHash: hashText(html), imageSrc: portraitUrl(kind, item) } };
      let page = bySiteId.get(Number(item.id));

      if (!page) {
        const sameName = byName.get(item.name.trim().toLowerCase());
        if (sameName) {
          // A page you already made here: link it, keep your text (Foundry is where lore is written).
          await sameName.update({ flags: { [deps.MODULE_ID]: { siteId: item.id, kind, syncHash: '' } } });
          counts.linked++;
          continue;
        }
        toCreate.push({ name: item.name, type: 'text', text: { content: html }, flags });
        counts.added++;
        continue;
      }

      const fl = flagsOf(page);
      const editedHere = hashText(page.text?.content) !== fl.syncHash;
      if (editedHere) {
        counts.kept++;
        continue;
      }
      if (page.name !== item.name || hashText(page.text?.content) !== hashText(html)) {
        await page.update({ name: item.name, text: { content: html }, flags });
        counts.updated++;
      }
    }
    if (toCreate.length) await journal.createEmbeddedDocuments('JournalEntryPage', toCreate);
  }
  return summary;
}

export function describePull(summary) {
  const bits = [];
  for (const [kind, c] of Object.entries(summary)) {
    const parts = [];
    if (c.added) parts.push(`${c.added} added`);
    if (c.updated) parts.push(`${c.updated} updated`);
    if (c.linked) parts.push(`${c.linked} matched to pages you already had`);
    if (c.kept) parts.push(`${c.kept} left alone (you changed them here; push to update the site)`);
    if (parts.length) bits.push(`${KINDS[kind].plural}: ${parts.join(', ')}`);
  }
  return bits.join('. ') || 'NPCs and places are already up to date.';
}

/* --------------------------------------------------------------------
   Push: Foundry -> site (GM only)
-------------------------------------------------------------------- */

/** How many NPC/Place pages a push would send (End of Session Sync's checklist shows this). */
export function countLorePages() {
  return Object.keys(KINDS).reduce((n, kind) => {
    const journal = findLoreJournal(kind);
    return n + (journal ? [...journal.pages].filter((p) => p.type === 'text' && p.name.trim()).length : 0);
  }, 0);
}

export async function pushLore() {
  if (!game.user.isGM) {
    ui.notifications.warn(t('DNDAMIGOS.Lore.GmOnly'));
    return;
  }
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  if (!deps.getMyUserId()) {
    ui.notifications.warn(t('DNDAMIGOS.Lore.NeedIdentity'));
    return;
  }
  ui.notifications.info(t('DNDAMIGOS.Lore.Pushing'));
  const { lines, problems } = await pushLoreCore();
  if (!lines.length && !problems.length) {
    ui.notifications.info(t('DNDAMIGOS.Lore.NothingToPush'));
    return;
  }
  if (lines.length) ui.notifications.info(`${t('DNDAMIGOS.Lore.Pushed')} ${lines.join('. ')}.`);
  problems.forEach((p) => ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: p })));
}

/**
 * The push itself, with no pop-ups (GM, identity set, connection configured: the caller checks).
 * Returns { lines: ["NPCs: 1 new, 2 updated, 9 unchanged", ...], problems: [...] }.
 */
export async function pushLoreCore() {
  const userId = deps.getMyUserId();
  const journalId = game.settings.get(deps.MODULE_ID, 'journalId');

  const lines = [];
  const problems = [];
  for (const kind of Object.keys(KINDS)) {
    const journal = findLoreJournal(kind);
    const pages = journal ? [...journal.pages].filter((p) => p.type === 'text' && p.name.trim()) : [];
    if (!pages.length) continue;

    const items = pages.map((p) => {
      const { tagline, description } = htmlToLore(p.text?.content);
      return { foundry_uuid: p.uuid, site_id: flagsOf(p).siteId || null, name: p.name.trim(), tagline, description };
    });

    let results;
    try {
      const data = await deps.apiRequest('lore-push.php', { method: 'POST', body: { journal_id: journalId, user_id: userId, kind, items } });
      results = data.results;
    } catch (err) {
      problems.push(`${KINDS[kind].plural}: ${err.message}`);
      continue;
    }

    const tally = { created: 0, updated: 0, unchanged: 0 };
    for (const r of results) {
      tally[r.action] = (tally[r.action] || 0) + 1;
      const page = pages.find((p) => p.uuid === r.foundry_uuid);
      if (!page) continue;
      const html = page.text?.content;
      const fl = flagsOf(page);
      await page.update({ flags: { [deps.MODULE_ID]: { ...fl, siteId: r.site_id, kind, syncHash: hashText(html) } } });

      // Portrait: a picture that lives in this Foundry world goes up to the site once.
      const src = firstImageSrc(html);
      const siteBase = String(game.settings.get(deps.MODULE_ID, 'siteUrl') || '').replace(/\/+$/, '');
      if (src && !src.startsWith(siteBase) && src !== fl.imageSrc) {
        try {
          const blob = await (await fetch(src)).blob();
          const form = new FormData();
          form.append('journal_id', journalId);
          form.append('user_id', userId);
          form.append('kind', kind);
          form.append('site_id', r.site_id);
          form.append('image', blob, src.split('/').pop().split('?')[0] || 'portrait');
          await deps.apiUploadFile('upload-lore-image.php', form);
          await page.update({ flags: { [deps.MODULE_ID]: { imageSrc: src } } });
        } catch (err) {
          problems.push(`${page.name}'s portrait: ${err.message}`);
        }
      }
    }
    lines.push(`${KINDS[kind].plural}: ${tally.created} new, ${tally.updated} updated, ${tally.unchanged} unchanged`);
  }
  return { lines, problems };
}

/**
 * GM: a blank page in the right journal. Opens the whole JOURNAL at that page (a
 * large, resizable window with the page list and the pencil to edit) rather than the
 * bare page sheet, which is a tiny window that is hard to resize.
 */
async function createLorePage(kind) {
  if (!game.user.isGM) return;
  const journal = await ensureLoreJournal(kind);
  const [page] = await journal.createEmbeddedDocuments('JournalEntryPage', [
    { name: KINDS[kind].newName, type: 'text', text: { content: '<p><em>A short tagline</em></p><p>What the party knows about them.</p>' } },
  ]);
  const size = { width: 820, height: 720 };
  const sheet = journal.sheet;
  try {
    if ((game.release?.generation ?? 12) >= 13) {
      // Foundry v13+: ApplicationV2 takes one options object (pageId is passed along
      // for versions that read it; goToPage below is the documented way).
      await sheet.render({ force: true, pageId: page.id, position: size });
    } else {
      // Foundry v12: the classic (force, options) form.
      await sheet.render(true, { pageId: page.id, ...size });
    }
    // Belt and braces: turn to the page and size the window explicitly, whichever version this is.
    if (typeof sheet.goToPage === 'function') sheet.goToPage(page.id);
    if (typeof sheet.setPosition === 'function') sheet.setPosition(size);
  } catch (err) {
    console.warn(`${deps.MODULE_ID} | could not open the journal at the new page`, err);
    try { sheet?.render(true); } catch (e) { /* the page exists in the journal either way */ }
  }
  ui.notifications.info(t('DNDAMIGOS.Lore.PageCreated', { name: KINDS[kind].newName }));
}

/* --------------------------------------------------------------------
   The "NPCs & Places" window: search, read, and add notes
-------------------------------------------------------------------- */

export async function openLoreDialog() {
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  const journalId = game.settings.get(deps.MODULE_ID, 'journalId');
  let info;
  try {
    info = await deps.apiRequest(`campaign-info.php?journal_id=${journalId}`);
  } catch (err) {
    ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: err.message }));
    return;
  }

  const myUserId = deps.getMyUserId();
  const counts = info.note_counts || { npc: {}, place: {} };
  const entries = [
    ...info.npcs.map((n) => ({ kind: 'npc', item: n })),
    ...info.places.map((p) => ({ kind: 'place', item: p })),
  ].sort((a, b) => a.item.name.localeCompare(b.item.name));

  const buttons = { close: { label: t('Close') } };
  if (game.user.isGM) {
    buttons.newNpc = { label: t('DNDAMIGOS.Lore.NewNpc'), callback: () => createLorePage('npc') };
    buttons.newPlace = { label: t('DNDAMIGOS.Lore.NewPlace'), callback: () => createLorePage('place') };
    buttons.push = { label: t('DNDAMIGOS.Lore.PushButton'), callback: () => pushLore() };
  }

  openDialog({
    title: t('DNDAMIGOS.Lore.Title'),
    content: `
      <div class="dnd-amigos-lore">
        <div class="dnd-amigos-lore-list-view">
          <input type="text" name="lore-search" placeholder="${esc(t('DNDAMIGOS.Lookup.SearchPlaceholder'))}" style="width:100%;">
          <div class="dnd-amigos-lore-results"></div>
        </div>
        <div class="dnd-amigos-lore-detail-view" hidden></div>
      </div>`,
    buttons,
    render: (html) => {
      const listView = html.find('.dnd-amigos-lore-list-view');
      const detailView = html.find('.dnd-amigos-lore-detail-view');
      const results = html.find('.dnd-amigos-lore-results');
      const input = html.find('[name="lore-search"]');

      const drawList = (query) => {
        const q = query.trim().toLowerCase();
        const matches = q ? entries.filter((e) => e.item.name.toLowerCase().includes(q)) : entries;
        results.html(
          matches.length
            ? matches.map((e, i) => {
                const n = counts[e.kind]?.[e.item.id] || 0;
                return `
                  <div class="dnd-amigos-lookup-entry dnd-amigos-lore-entry" data-index="${entries.indexOf(e)}">
                    <strong>${esc(e.item.name)}</strong>
                    <span class="dnd-amigos-lookup-kind">${KINDS[e.kind].label}</span>
                    ${n ? `<span class="dnd-amigos-lore-count"><i class="fa-solid fa-comment"></i> ${n}</span>` : ''}
                    ${e.item.tagline ? `<p><em>${esc(e.item.tagline)}</em></p>` : ''}
                  </div>`;
              }).join('')
            : `<p><em>${t('DNDAMIGOS.Lookup.NoMatches')}</em></p>`
        );
        results.find('.dnd-amigos-lore-entry').on('click', (ev) => showDetail(entries[Number(ev.currentTarget.dataset.index)]));
      };

      const showDetail = async (entry) => {
        const { kind, item } = entry;
        const img = portraitUrl(kind, item);
        listView.prop('hidden', true);
        detailView.prop('hidden', false).html(`
          <button type="button" class="dnd-amigos-lore-back"><i class="fa-solid fa-arrow-left"></i> ${t('DNDAMIGOS.Lore.Back')}</button>
          ${img ? `<img class="dnd-amigos-lore-portrait" src="${esc(img)}" alt="">` : ''}
          <h3>${esc(item.name)} <span class="dnd-amigos-lookup-kind">${KINDS[kind].label}</span></h3>
          ${item.tagline ? `<p><em>${esc(item.tagline)}</em></p>` : ''}
          <p class="dnd-amigos-lore-desc">${esc(item.description || '')}</p>
          <hr>
          <h4>${t('DNDAMIGOS.Lore.Notes')}</h4>
          <div class="dnd-amigos-lore-notes"></div>
          ${myUserId
            ? `<textarea class="dnd-amigos-lore-new" rows="2" maxlength="2000" placeholder="${esc(t('DNDAMIGOS.Lore.NotePlaceholder'))}"></textarea>
               <button type="button" class="dnd-amigos-lore-add">${t('DNDAMIGOS.Lore.AddNote')}</button>`
            : `<p><em>${t('DNDAMIGOS.Lore.NeedIdentityToNote')}</em></p>`}
        `);
        detailView.find('.dnd-amigos-lore-back').on('click', () => {
          detailView.prop('hidden', true).empty();
          listView.prop('hidden', false);
          drawList(input.val());
        });

        const notesEl = detailView.find('.dnd-amigos-lore-notes');
        const fail = (err) => ui.notifications.error(t('DNDAMIGOS.Error.Generic', { error: err.message }));

        const loadNotes = async () => {
          let data;
          try {
            data = await deps.apiRequest(`lore-notes-list.php?kind=${kind}&item_id=${item.id}&user_id=${myUserId || 0}`);
          } catch (err) {
            notesEl.html(`<p><em>${esc(err.message)}</em></p>`);
            return;
          }
          counts[kind] = counts[kind] || {};
          counts[kind][item.id] = data.notes.length;
          notesEl.html(
            data.notes.length
              ? data.notes.map((n) => `
                  <div class="dnd-amigos-note" data-id="${n.id}">
                    <div class="dnd-amigos-note-meta"><strong>${esc(n.author)}</strong> · ${esc(String(n.created_at).slice(0, 10))}${n.updated_at ? ' (edited)' : ''}</div>
                    <div class="dnd-amigos-note-body">${esc(n.body)}</div>
                    <div class="dnd-amigos-note-tools">
                      ${n.can_edit ? `<a class="dnd-amigos-note-edit">${t('DNDAMIGOS.Lore.Edit')}</a>` : ''}
                      ${n.can_delete ? `<a class="dnd-amigos-note-delete">${t('DNDAMIGOS.Lore.Delete')}</a>` : ''}
                    </div>
                  </div>`).join('')
              : `<p><em>${t('DNDAMIGOS.Lore.NoNotes')}</em></p>`
          );
          notesEl.find('.dnd-amigos-note-delete').on('click', async (ev) => {
            if (!window.confirm(t('DNDAMIGOS.Lore.ConfirmDelete'))) return;
            try {
              const id = Number(ev.currentTarget.closest('.dnd-amigos-note').dataset.id);
              await deps.apiRequest('delete-lore-note.php', { method: 'POST', body: { id, user_id: myUserId } });
              await loadNotes();
            } catch (err) { fail(err); }
          });
          notesEl.find('.dnd-amigos-note-edit').on('click', (ev) => {
            const noteId = Number(ev.currentTarget.closest('.dnd-amigos-note').dataset.id);
            const row = html.find(`.dnd-amigos-note[data-id="${noteId}"]`);
            const note = data.notes.find((n) => n.id === noteId);
            row.html(`
              <textarea rows="3" maxlength="2000"></textarea>
              <button type="button" class="dnd-amigos-note-save">${t('DNDAMIGOS.Lore.Save')}</button>
              <button type="button" class="dnd-amigos-note-cancel">${t('DNDAMIGOS.Lore.Cancel')}</button>`);
            row.find('textarea').val(note.body);
            row.find('.dnd-amigos-note-cancel').on('click', loadNotes);
            row.find('.dnd-amigos-note-save').on('click', async () => {
              try {
                await deps.apiRequest('update-lore-note.php', { method: 'POST', body: { id: note.id, user_id: myUserId, body: row.find('textarea').val() } });
                await loadNotes();
              } catch (err) { fail(err); }
            });
          });
        };

        detailView.find('.dnd-amigos-lore-add').on('click', async () => {
          const box = detailView.find('.dnd-amigos-lore-new');
          const body = String(box.val() || '').trim();
          if (!body) return;
          try {
            await deps.apiRequest('add-lore-note.php', { method: 'POST', body: { kind, item_id: item.id, user_id: myUserId, body } });
            box.val('');
            await loadNotes();
          } catch (err) { fail(err); }
        });

        await loadNotes();
      };

      drawList('');
      input.on('input', () => drawList(input.val()));
      input.trigger('focus');
    },
    width: 560,
  });
}
