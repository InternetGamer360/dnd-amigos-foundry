// D&D Amigos Connector — scripts/recap.js
//
// Session Recap (GM only): Nethys drafts a session-log entry from tonight's chat; the GM reads
// one preview and posts it. Built to be light on the GM: no form to fill in first.
//
//   1. Opening the window starts the draft at once, from chat since the last recap (or since
//      the last 4+ hour quiet gap the first time). The range shows in one line, with Change.
//   2. The module condenses the chat into a compact transcript and computes "By the dice"
//      exactly from the dice results (never by the AI); the site
//      (engine/api/foundry/recap-draft.php) has Nethys write title, story, highlights and
//      worth noting.
//   3. One preview, as the Session Log will show it: Post (most nights), Edit (the whole entry
//      in one box), or Rewrite with an optional line from the GM ("they found the vault key",
//      "shorter"), which redraws the whole recap and keeps the dice exact.
//   4. Post (engine/api/foundry/recap-post.php) + a page in the "Session Recaps" journal; that
//      moment becomes "the last recap" for next time.
//
// Click-to-run like the rest of the module. main.js hands over its API helpers through
// configureRecap(), so the two files never import each other.

import { openDialog } from './windows.js';
import { esc, t } from './util.js';

let deps = null;

export function configureRecap(d) {
  deps = d;
}

const SESSION_GAP_MS = 4 * 3600 * 1000;
const RECAP_JOURNAL = 'Session Recaps';

/* --------------------------------------------------------------------
   Reading the chat
-------------------------------------------------------------------- */

function plainText(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  template.content.querySelectorAll('br, p, div, li, h1, h2, h3, h4, tr').forEach((el) => el.append(' '));
  return template.content.textContent.replace(/\s+/g, ' ').trim();
}

const sortedMessages = () => [...game.messages.contents].filter((m) => m.timestamp).sort((a, b) => a.timestamp - b.timestamp);

/** Default range: after the last recap, else after the last long quiet gap; ends at the newest message. */
function defaultRange(messages) {
  if (!messages.length) return { start: Date.now() - SESSION_GAP_MS, end: Date.now() };
  const end = messages.at(-1).timestamp;
  const last = Number(game.settings.get(deps.MODULE_ID, 'lastRecapAt')) || 0;
  let start = messages[0].timestamp;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].timestamp - messages[i - 1].timestamp > SESSION_GAP_MS) start = messages[i].timestamp;
  }
  if (last && last < end) {
    const firstAfter = messages.find((m) => m.timestamp > last);
    if (firstAfter) start = Math.max(start, firstAfter.timestamp);
  }
  return { start, end };
}

/** The player characters behind a message: its speaker actor, if it's a player-owned character. */
function pcName(message) {
  const actor = game.actors.get(message.speaker?.actor ?? '');
  return actor && actor.type === 'character' && actor.hasPlayerOwner ? actor.name : null;
}

const isDamageRoll = (roll, flavor) => roll?.constructor?.name === 'DamageRoll' || /damage/i.test(flavor);

/** Compact transcript lines plus exact dice stats for the messages in range. */
function readSession(messages) {
  const lines = [];
  const pcs = {};
  let rollCount = 0;
  let biggest = null;
  for (const m of messages) {
    const who = m.speaker?.alias || m.author?.name || '?';
    const player = m.author?.name || '?';
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const flavor = plainText(m.flavor).slice(0, 140);
    const rolls = m.rolls ?? [];
    const pc = pcName(m);
    let rollText = '';
    if (rolls.length) {
      rollText = rolls.map((r) => `${r.formula} = ${r.total}`).join('; ');
      rollCount += rolls.length;
      for (const r of rolls) {
        if (pc) {
          const s = (pcs[pc] ||= { rolls: 0, nat20: 0, nat1: 0, best: null });
          s.rolls++;
          for (const die of r.dice ?? []) {
            if (die.faces !== 20) continue;
            for (const res of die.results ?? []) {
              if (res.active === false || res.discarded) continue;
              if (res.result === 20) s.nat20++;
              if (res.result === 1) s.nat1++;
            }
          }
          if (isDamageRoll(r, flavor) && (!s.best || r.total > s.best.total)) s.best = { total: r.total, what: flavor };
        }
        if (isDamageRoll(r, flavor) && (!biggest || r.total > biggest.total)) biggest = { total: r.total, who, what: flavor };
      }
    }
    const content = rolls.length ? '' : plainText(m.content).slice(0, 300);
    const whisper = m.whisper?.length ? ' [whisper]' : '';
    lines.push(`[${time}] ${who}${who !== player ? ` (${player})` : ''}${whisper}${flavor ? ` {${flavor}}` : ''}${rollText ? ` ROLL ${rollText}` : ''}${content ? `: ${content}` : ''}`);
  }
  return { transcript: lines.join('\n'), pcs, rollCount, biggest };
}

/** "By the dice" as bullet lines, from the exact numbers. */
function diceBullets({ pcs, rollCount, biggest }) {
  const entries = Object.entries(pcs);
  if (!entries.length) return [];
  const out = [];
  const top = (key) => entries.filter(([, s]) => s[key] > 0).sort((a, b) => b[1][key] - a[1][key]);
  const n20 = top('nat20');
  const n1 = top('nat1');
  out.push(`${rollCount} rolls in all.`);
  if (n20.length) out.push(`Natural 20s: ${n20.map(([n, s]) => `${n} ${s.nat20}`).join(', ')}.`);
  if (n1.length) out.push(`Natural 1s: ${n1.map(([n, s]) => `${n} ${s.nat1}`).join(', ')}.`);
  const hitters = entries.filter(([, s]) => s.best).sort((a, b) => b[1].best.total - a[1].best.total);
  if (hitters.length) out.push(`Party's biggest hit: ${hitters[0][0]}, ${hitters[0][1].best.total} damage.`);
  if (biggest && !hitters.some(([n]) => n === biggest.who)) out.push(`Biggest hit of the night: ${biggest.who}, ${biggest.total} damage.`);
  const busiest = entries.sort((a, b) => b[1].rolls - a[1].rolls)[0];
  if (busiest) out.push(`Most rolls: ${busiest[0]} (${busiest[1].rolls}).`);
  return out;
}

/* --------------------------------------------------------------------
   Windows
-------------------------------------------------------------------- */

const toLocalInput = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).getTime() : NaN);
const sessionLabel = (start, end) => `${new Date(start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} – ${new Date(end).toLocaleTimeString([], { timeStyle: 'short' })}`;
const sessionDate = (start) => toLocalInput(start).slice(0, 10);

const listToText = (items) => (items ?? []).map((x) => `- ${x}`).join('\n');
const textToList = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);

/** The Session Log entry body: story, highlights, the exact dice lines, worth noting. */
function composeBody(recap, dice) {
  const parts = [];
  if (recap.story) parts.push(`**${t('DNDAMIGOS.Recap.PreviouslyOn')}**\n${recap.story}`);
  if (recap.highlights?.length) parts.push(`**${t('DNDAMIGOS.Recap.Section.highlights')}**\n${listToText(recap.highlights)}`);
  if (dice.length) parts.push(`**${t('DNDAMIGOS.Recap.Section.dice')}**\n${listToText(dice)}`);
  if (recap.worth_noting?.length) parts.push(`**${t('DNDAMIGOS.Recap.Section.worth_noting')}**\n${listToText(recap.worth_noting)}`);
  return parts.join('\n\n');
}

/** The body's light Markdown (**bold** headings, "- " lists) as HTML, as the Session Log shows it. */
function bodyToHtml(body) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return String(body).split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const head = /^\*\*.+\*\*$/.test(lines[0]) ? `<h3>${esc(lines.shift().replace(/^\*\*|\*\*$/g, ''))}</h3>` : '';
    const items = lines.filter((l) => l.startsWith('- '));
    const rest = lines.filter((l) => !l.startsWith('- '));
    return head + (rest.length ? `<p>${rest.map(inline).join('<br>')}</p>` : '') + (items.length ? `<ul>${items.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>` : '');
  }).join('');
}

/**
 * Session Recap: Nethys starts writing as soon as the window opens; the GM sees one preview of
 * the finished entry. Most nights that's read it and Post. Edit turns the preview into one
 * editable box; Rewrite takes an optional line ("they found the vault key", "shorter") and
 * redraws the whole thing. The time range sits in one line with a Change link.
 */
export function openRecapWindow() {
  if (!game.user.isGM) {
    ui.notifications.warn(t('DNDAMIGOS.Recap.GmOnly'));
    return;
  }
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  const messages = sortedMessages();
  const range = defaultRange(messages);

  const dialog = openDialog({
    title: t('DNDAMIGOS.Recap.Title'),
    width: 600,
    content: `
      <div class="dnd-amigos-recap">
        <p class="dnd-amigos-recap-count"><span data-role="range"></span> · <a data-action="change-range">${esc(t('DNDAMIGOS.Recap.ChangeRange'))}</a></p>
        <div class="dnd-amigos-recap-range" data-role="range-editor" hidden>
          <label>${esc(t('DNDAMIGOS.Recap.From'))} <input type="datetime-local" data-role="start" value="${toLocalInput(range.start)}"></label>
          <label>${esc(t('DNDAMIGOS.Recap.To'))} <input type="datetime-local" data-role="end" value="${toLocalInput(range.end)}"></label>
          <button type="button" data-action="apply-range">${esc(t('DNDAMIGOS.Recap.ApplyRange'))}</button>
        </div>
        <div class="dnd-amigos-recap-preview" data-role="preview"></div>
        <div data-role="editor" hidden>
          <input type="text" data-role="edit-title">
          <textarea data-role="edit-body" rows="14"></textarea>
        </div>
        <div class="dnd-amigos-recap-rewrite" data-role="rewrite-row" hidden>
          <input type="text" data-role="instruction" placeholder="${esc(t('DNDAMIGOS.Recap.InstructionHint'))}">
          <button type="button" data-action="rewrite-go"><i class="fa-solid fa-rotate"></i> ${esc(t('DNDAMIGOS.Recap.Rewrite'))}</button>
        </div>
        <div class="dnd-amigos-recap-actions">
          <button type="button" data-action="post" class="dnd-amigos-menu-item-gold" disabled><i class="fa-solid fa-paper-plane"></i> ${esc(t('DNDAMIGOS.Recap.Post'))}</button>
          <button type="button" data-action="edit" disabled><i class="fa-solid fa-pen"></i> ${esc(t('DNDAMIGOS.Recap.Edit'))}</button>
          <button type="button" data-action="rewrite" disabled><i class="fa-solid fa-rotate"></i> ${esc(t('DNDAMIGOS.Recap.RewriteEllipsis'))}</button>
        </div>
        <p class="dnd-amigos-recap-status" data-role="status"></p>
      </div>`,
    buttons: { close: { label: game.i18n.localize('Close') } },
    render: (html) => {
      const root = html[0];
      const $ = (sel) => root.querySelector(sel);
      const state = { start: range.start, end: range.end, request: null, recap: null, dice: [], edited: null };
      const setStatus = (text) => { $('[data-role="status"]').textContent = text || ''; };
      const setBusy = (busy) => root.querySelectorAll('.dnd-amigos-recap-actions button, [data-action="rewrite-go"]').forEach((b) => { b.disabled = busy || !state.recap; });

      const inRange = () => messages.filter((m) => m.timestamp >= state.start && m.timestamp <= state.end + 59999);
      const showRange = () => {
        const list = inRange();
        const rolls = list.reduce((n, m) => n + (m.rolls?.length ? 1 : 0), 0);
        $('[data-role="range"]').textContent = `${sessionLabel(state.start, state.end)} · ${t('DNDAMIGOS.Recap.Count', { messages: list.length, rolls })}`;
      };
      const showPreview = () => {
        $('[data-role="editor"]').hidden = true;
        $('[data-role="preview"]').hidden = false;
        $('[data-role="preview"]').innerHTML = `<h2>${esc(state.recap.title || t('DNDAMIGOS.Recap.Title'))}</h2>${bodyToHtml(composeBody(state.recap, state.dice))}`;
        $('[data-action="edit"]').innerHTML = `<i class="fa-solid fa-pen"></i> ${esc(t('DNDAMIGOS.Recap.Edit'))}`;
      };

      // Draft (or redraw) the whole recap. `instruction` is the GM's optional line.
      const write = async (instruction = '') => {
        const list = inRange();
        if (!list.length && !instruction) {
          setStatus(t('DNDAMIGOS.Recap.Nothing'));
          return;
        }
        const session = readSession(list);
        state.dice = diceBullets(session);
        state.request = {
          journal_id: game.settings.get(deps.MODULE_ID, 'journalId'),
          user_id: deps.getMyUserId(),
          campaign: game.world.title,
          session_label: sessionLabel(state.start, state.end),
          transcript: session.transcript,
          dice_summary: state.dice.join('\n'),
          notes: '',
        };
        const body = state.recap && instruction !== null ? { ...state.request, current: state.recap, instruction } : state.request;
        setBusy(true);
        setStatus(t(state.recap ? 'DNDAMIGOS.Recap.Rewriting' : 'DNDAMIGOS.Recap.Writing'));
        if (!state.recap) $('[data-role="preview"]').innerHTML = `<p class="dnd-amigos-recap-status">${esc(t('DNDAMIGOS.Recap.Writing'))}</p>`;
        try {
          const { recap } = await deps.apiRequest('recap-draft.php', { method: 'POST', body });
          state.recap = recap;
          state.edited = null;
          showPreview();
          setStatus('');
        } catch (err) {
          setStatus(t('DNDAMIGOS.Recap.Failed', { error: err.message }));
        } finally {
          setBusy(false);
        }
      };

      $('[data-action="change-range"]').addEventListener('click', () => { $('[data-role="range-editor"]').hidden = !$('[data-role="range-editor"]').hidden; });
      $('[data-action="apply-range"]').addEventListener('click', () => {
        state.start = fromLocalInput($('[data-role="start"]').value);
        state.end = fromLocalInput($('[data-role="end"]').value);
        state.recap = null;
        $('[data-role="range-editor"]').hidden = true;
        showRange();
        write();
      });

      $('[data-action="edit"]').addEventListener('click', () => {
        const editing = !$('[data-role="editor"]').hidden;
        if (editing) {
          // Back to the preview, keeping the edits.
          state.edited = { title: $('[data-role="edit-title"]').value.trim(), body: $('[data-role="edit-body"]').value.trim() };
          $('[data-role="preview"]').innerHTML = `<h2>${esc(state.edited.title || t('DNDAMIGOS.Recap.Title'))}</h2>${bodyToHtml(state.edited.body)}`;
          $('[data-role="editor"]').hidden = true;
          $('[data-role="preview"]').hidden = false;
          $('[data-action="edit"]').innerHTML = `<i class="fa-solid fa-pen"></i> ${esc(t('DNDAMIGOS.Recap.Edit'))}`;
          return;
        }
        $('[data-role="edit-title"]').value = state.edited?.title ?? state.recap.title;
        $('[data-role="edit-body"]').value = state.edited?.body ?? composeBody(state.recap, state.dice);
        $('[data-role="preview"]').hidden = true;
        $('[data-role="editor"]').hidden = false;
        $('[data-action="edit"]').innerHTML = `<i class="fa-solid fa-eye"></i> ${esc(t('DNDAMIGOS.Recap.Preview'))}`;
      });

      $('[data-action="rewrite"]').addEventListener('click', () => {
        $('[data-role="rewrite-row"]').hidden = !$('[data-role="rewrite-row"]').hidden;
        if (!$('[data-role="rewrite-row"]').hidden) $('[data-role="instruction"]').focus();
      });
      const rewrite = () => {
        if (state.edited && !window.confirm(t('DNDAMIGOS.Recap.RewriteLosesEdits'))) return;
        write($('[data-role="instruction"]').value.trim());
      };
      $('[data-action="rewrite-go"]').addEventListener('click', rewrite);
      $('[data-role="instruction"]').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); rewrite(); }
      });

      $('[data-action="post"]').addEventListener('click', async () => {
        const editing = !$('[data-role="editor"]').hidden;
        const title = editing ? $('[data-role="edit-title"]').value.trim() : (state.edited?.title ?? state.recap.title);
        const body = editing ? $('[data-role="edit-body"]').value.trim() : (state.edited?.body ?? composeBody(state.recap, state.dice));
        if (!body) {
          setStatus(t('DNDAMIGOS.Recap.Empty'));
          return;
        }
        setBusy(true);
        setStatus(t('DNDAMIGOS.Recap.Posting'));
        try {
          await deps.apiRequest('recap-post.php', {
            method: 'POST',
            body: { journal_id: state.request.journal_id, user_id: state.request.user_id, title, body, session_date: sessionDate(state.start) },
          });
        } catch (err) {
          setStatus(t('DNDAMIGOS.Recap.Failed', { error: err.message }));
          setBusy(false);
          return;
        }
        let journalNote = '';
        try {
          await saveJournalPage(`${sessionDate(state.start)} — ${title || t('DNDAMIGOS.Recap.Title')}`, body);
        } catch (err) {
          journalNote = ` ${t('DNDAMIGOS.Recap.JournalFailed', { error: err.message })}`;
        }
        await game.settings.set(deps.MODULE_ID, 'lastRecapAt', state.end + 59999);
        ui.notifications.info(t('DNDAMIGOS.Recap.Posted') + journalNote);
        dialog.close?.();
      });

      showRange();
      write();
    },
  });
}

/** The recap as a page in this world's "Session Recaps" journal. */
async function saveJournalPage(name, body) {
  const page = { name, type: 'text', text: { content: bodyToHtml(body) } };
  const journal = game.journal.find((j) => j.name === RECAP_JOURNAL);
  if (journal) await journal.createEmbeddedDocuments('JournalEntryPage', [page]);
  else await JournalEntry.create({ name: RECAP_JOURNAL, pages: [page] });
}

// Exposed for tests (pure helpers, no Foundry state).
export const _test = { defaultRange, readSession, diceBullets, textToList, listToText, composeBody, bodyToHtml };
