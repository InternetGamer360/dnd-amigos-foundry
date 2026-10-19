// D&D Amigos Connector — scripts/recap.js
//
// Session Recap (GM only): Nethys drafts a session-log entry from tonight's chat plus the GM's
// story notes, the GM reviews it section by section, then it's posted to the site's Session
// Log and saved as a page in this world's "Session Recaps" journal.
//
//   1. Pick the session: chat since the last recap (or since the last 4+ hour quiet gap the
//      first time), with start/end the GM can adjust.
//   2. Story notes: four optional boxes (where, who, what happened, where we stopped). Chat is
//      mostly dice, so this is where the story comes from.
//   3. The module condenses the chat into a compact transcript and computes "By the dice"
//      exactly from the dice results (never by the AI), then asks the site
//      (engine/api/foundry/recap-draft.php) for the title, story, highlights and worth noting.
//   4. Review: every section is editable; each AI section has Rewrite (optionally with an
//      instruction such as "shorter"). By the dice is editable but never rewritten.
//   5. Post (engine/api/foundry/recap-post.php) + the journal page; that moment becomes
//      "the last recap" for next time.
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
  const notesBox = (key, rows) => `
    <label class="dnd-amigos-recap-label">${esc(t(`DNDAMIGOS.Recap.Notes.${key}`))}</label>
    <textarea data-note="${key}" rows="${rows}" placeholder="${esc(t(`DNDAMIGOS.Recap.Notes.${key}Hint`))}"></textarea>`;

  const dialog = openDialog({
    title: t('DNDAMIGOS.Recap.Title'),
    width: 500,
    content: `
      <div class="dnd-amigos-recap">
        <p class="dnd-amigos-recap-intro">${esc(t('DNDAMIGOS.Recap.Intro'))}</p>
        <div class="dnd-amigos-recap-range">
          <label>${esc(t('DNDAMIGOS.Recap.From'))} <input type="datetime-local" data-role="start" value="${toLocalInput(range.start)}"></label>
          <label>${esc(t('DNDAMIGOS.Recap.To'))} <input type="datetime-local" data-role="end" value="${toLocalInput(range.end)}"></label>
        </div>
        <p class="dnd-amigos-recap-count" data-role="count"></p>
        ${notesBox('where', 1)}${notesBox('who', 1)}${notesBox('what', 3)}${notesBox('stop', 1)}
        <button type="button" data-action="write" class="dnd-amigos-menu-item-gold"><i class="fa-solid fa-feather"></i> ${esc(t('DNDAMIGOS.Recap.Write'))}</button>
        <p class="dnd-amigos-recap-status" data-role="status"></p>
      </div>`,
    buttons: { close: { label: game.i18n.localize('Close') } },
    render: (html) => {
      const root = html[0];
      const startEl = root.querySelector('[data-role="start"]');
      const endEl = root.querySelector('[data-role="end"]');
      const countEl = root.querySelector('[data-role="count"]');
      const statusEl = root.querySelector('[data-role="status"]');
      const inRange = () => {
        const s = fromLocalInput(startEl.value);
        const e = fromLocalInput(endEl.value) + 59999; // the whole end minute
        return messages.filter((m) => m.timestamp >= s && m.timestamp <= e);
      };
      const updateCount = () => {
        const list = inRange();
        const rolls = list.reduce((n, m) => n + (m.rolls?.length ? 1 : 0), 0);
        countEl.textContent = t('DNDAMIGOS.Recap.Count', { messages: list.length, rolls });
      };
      startEl.addEventListener('change', updateCount);
      endEl.addEventListener('change', updateCount);
      updateCount();

      root.querySelector('[data-action="write"]').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const list = inRange();
        const notes = Object.fromEntries([...root.querySelectorAll('[data-note]')].map((el) => [el.dataset.note, el.value.trim()]));
        if (!list.length && !Object.values(notes).some(Boolean)) {
          statusEl.textContent = t('DNDAMIGOS.Recap.Nothing');
          return;
        }
        const start = fromLocalInput(startEl.value);
        const end = fromLocalInput(endEl.value);
        const session = readSession(list);
        const dice = diceBullets(session);
        const request = {
          journal_id: game.settings.get(deps.MODULE_ID, 'journalId'),
          user_id: deps.getMyUserId(),
          campaign: game.world.title,
          session_label: sessionLabel(start, end),
          transcript: session.transcript,
          dice_summary: dice.join('\n'),
          notes,
        };
        btn.disabled = true;
        statusEl.textContent = t('DNDAMIGOS.Recap.Writing');
        try {
          const { recap } = await deps.apiRequest('recap-draft.php', { method: 'POST', body: request });
          dialog.close?.();
          openReviewWindow({ request, recap, dice, start, end });
        } catch (err) {
          statusEl.textContent = t('DNDAMIGOS.Recap.Failed', { error: err.message });
          btn.disabled = false;
        }
      });
    },
  });
}

const listToText = (items) => (items ?? []).map((x) => `- ${x}`).join('\n');
const textToList = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);

function openReviewWindow({ request, recap, dice, start, end }) {
  const section = (key, label, value, { rows = 4, rewrite = true, input = false } = {}) => `
    <div class="dnd-amigos-recap-section" data-section="${key}">
      <div class="dnd-amigos-recap-section-head">
        <strong>${esc(label)}</strong>
        ${rewrite ? `<button type="button" data-rewrite="${key}"><i class="fa-solid fa-rotate"></i> ${esc(t('DNDAMIGOS.Recap.Rewrite'))}</button>` : ''}
      </div>
      ${input ? `<input type="text" data-field="${key}" value="${esc(value)}">` : `<textarea data-field="${key}" rows="${rows}">${esc(value)}</textarea>`}
    </div>`;

  const dialog = openDialog({
    title: t('DNDAMIGOS.Recap.ReviewTitle', { session: request.session_label }),
    width: 620,
    content: `
      <div class="dnd-amigos-recap dnd-amigos-recap-review">
        <p class="dnd-amigos-recap-intro">${esc(t('DNDAMIGOS.Recap.ReviewIntro'))}</p>
        <label class="dnd-amigos-recap-label">${esc(t('DNDAMIGOS.Recap.Instruction'))}</label>
        <input type="text" data-role="instruction" placeholder="${esc(t('DNDAMIGOS.Recap.InstructionHint'))}">
        ${section('title', t('DNDAMIGOS.Recap.Section.title'), recap.title, { input: true })}
        ${section('story', t('DNDAMIGOS.Recap.Section.story'), recap.story, { rows: 6 })}
        ${section('highlights', t('DNDAMIGOS.Recap.Section.highlights'), listToText(recap.highlights), { rows: 5 })}
        ${section('dice', t('DNDAMIGOS.Recap.Section.dice'), listToText(dice), { rows: 4, rewrite: false })}
        ${section('worth_noting', t('DNDAMIGOS.Recap.Section.worth_noting'), listToText(recap.worth_noting), { rows: 3 })}
        <button type="button" data-action="post" class="dnd-amigos-menu-item-gold"><i class="fa-solid fa-paper-plane"></i> ${esc(t('DNDAMIGOS.Recap.Post'))}</button>
        <p class="dnd-amigos-recap-status" data-role="status"></p>
      </div>`,
    buttons: { close: { label: game.i18n.localize('Close') } },
    render: (html) => {
      const root = html[0];
      const field = (key) => root.querySelector(`[data-field="${key}"]`);
      const statusEl = root.querySelector('[data-role="status"]');
      const current = () => ({
        title: field('title').value.trim(),
        story: field('story').value.trim(),
        highlights: textToList(field('highlights').value),
        worth_noting: textToList(field('worth_noting').value),
      });

      root.querySelectorAll('[data-rewrite]').forEach((btn) => btn.addEventListener('click', async () => {
        const key = btn.dataset.rewrite;
        btn.disabled = true;
        statusEl.textContent = t('DNDAMIGOS.Recap.Rewriting');
        try {
          const { recap: fresh } = await deps.apiRequest('recap-draft.php', {
            method: 'POST',
            body: { ...request, section: key, current: current(), instruction: root.querySelector('[data-role="instruction"]').value.trim() },
          });
          field(key).value = Array.isArray(fresh[key]) ? listToText(fresh[key]) : (fresh[key] || field(key).value);
          statusEl.textContent = '';
        } catch (err) {
          statusEl.textContent = t('DNDAMIGOS.Recap.Failed', { error: err.message });
        } finally {
          btn.disabled = false;
        }
      }));

      root.querySelector('[data-action="post"]').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const c = current();
        const dicelist = textToList(field('dice').value);
        const parts = [];
        if (c.story) parts.push(`**${t('DNDAMIGOS.Recap.PreviouslyOn')}**\n${c.story}`);
        if (c.highlights.length) parts.push(`**${t('DNDAMIGOS.Recap.Section.highlights')}**\n${listToText(c.highlights)}`);
        if (dicelist.length) parts.push(`**${t('DNDAMIGOS.Recap.Section.dice')}**\n${listToText(dicelist)}`);
        if (c.worth_noting.length) parts.push(`**${t('DNDAMIGOS.Recap.Section.worth_noting')}**\n${listToText(c.worth_noting)}`);
        if (!parts.length) {
          statusEl.textContent = t('DNDAMIGOS.Recap.Empty');
          return;
        }
        btn.disabled = true;
        statusEl.textContent = t('DNDAMIGOS.Recap.Posting');
        const body = parts.join('\n\n');
        try {
          await deps.apiRequest('recap-post.php', {
            method: 'POST',
            body: { journal_id: request.journal_id, user_id: request.user_id, title: c.title, body, session_date: sessionDate(start) },
          });
        } catch (err) {
          statusEl.textContent = t('DNDAMIGOS.Recap.Failed', { error: err.message });
          btn.disabled = false;
          return;
        }
        let journalNote = '';
        try {
          await saveJournalPage(`${sessionDate(start)} — ${c.title || t('DNDAMIGOS.Recap.Title')}`, body);
        } catch (err) {
          journalNote = ` ${t('DNDAMIGOS.Recap.JournalFailed', { error: err.message })}`;
        }
        await game.settings.set(deps.MODULE_ID, 'lastRecapAt', end + 59999);
        ui.notifications.info(t('DNDAMIGOS.Recap.Posted') + journalNote);
        dialog.close?.();
      });
    },
  });
}

/** The recap as a page in this world's "Session Recaps" journal (Markdown-ish -> simple HTML). */
async function saveJournalPage(name, body) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const html = body.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const head = lines[0].startsWith('**') ? `<h3>${inline(lines.shift()).replace(/<\/?strong>/g, '')}</h3>` : '';
    const items = lines.filter((l) => l.startsWith('- '));
    const rest = lines.filter((l) => !l.startsWith('- '));
    return head + (rest.length ? `<p>${rest.map(inline).join('<br>')}</p>` : '') + (items.length ? `<ul>${items.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>` : '');
  }).join('');
  const page = { name, type: 'text', text: { content: html } };
  const journal = game.journal.find((j) => j.name === RECAP_JOURNAL);
  if (journal) await journal.createEmbeddedDocuments('JournalEntryPage', [page]);
  else await JournalEntry.create({ name: RECAP_JOURNAL, pages: [page] });
}

// Exposed for tests (pure helpers, no Foundry state).
export const _test = { defaultRange, readSession, diceBullets, textToList, listToText };
