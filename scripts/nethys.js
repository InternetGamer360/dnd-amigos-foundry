// D&D Amigos Connector — scripts/nethys.js
//
// Ask Nethys, the group's rules helper (the same one as the Discord bot and the
// website's Ask Nethys page), without leaving Foundry. Answers come from the
// website (engine/api/foundry/nethys-ask.php), which looks rules up on Archives
// of Nethys; nothing here holds an AI key.
//
//   /nethys <question>    in the chat box: a private answer card, whispered to you,
//                         with a "Share with table" button.
//   /nethys! <question>   the same, but posted for everyone.
//   openNethysWindow()    the "Ask Nethys" window from the D&D Amigos menu: a small
//                         chat you can keep open beside the map; follow-up questions
//                         remember the conversation until you close Foundry or start
//                         a new chat.
//
// Still click/type-to-run like the rest of the module: Nethys only ever answers a
// question someone asked. main.js hands over its API helpers through
// configureNethys(), so the two files never import each other.

import { openDialog } from './windows.js';

let deps = null;

export function configureNethys(d) {
  deps = d;
}

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const HISTORY_TURNS = 12;
const COMMAND = /^\/nethys(!?)(?:\s+([\s\S]*))?$/i;

/** Just enough Markdown for Nethys' replies: paragraphs, bullet lists, bold/italic, links. */
function renderReply(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return String(text).split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

/** messages: [{ role: 'user'|'assistant', content }], ending with the question. Resolves to the reply text. */
async function askSite(messages) {
  const data = await deps.apiRequest('nethys-ask.php', {
    method: 'POST',
    body: { messages: messages.slice(-HISTORY_TURNS), asker: game.user.name },
  });
  return data.reply;
}

/* --------------------------------------------------------------------
   Chat cards
-------------------------------------------------------------------- */

function cardHtml({ question, answer, pending = false, error = null, shareable = false }) {
  let body;
  if (pending) body = `<p class="dnd-amigos-nethys-pending"><i class="fa-solid fa-hat-wizard"></i> ${esc(t('DNDAMIGOS.Nethys.Thinking'))}</p>`;
  else if (error) body = `<p class="dnd-amigos-nethys-error">${esc(error)}</p>`;
  else body = renderReply(answer);
  return `
    <div class="dnd-amigos-nethys-card">
      <div class="dnd-amigos-nethys-q"><i class="fa-solid fa-circle-question"></i> ${esc(question)}</div>
      <div class="dnd-amigos-nethys-a">${body}</div>
      ${shareable ? `<button type="button" class="dnd-amigos-nethys-share" data-action="nethys-share"><i class="fa-solid fa-share"></i> ${esc(t('DNDAMIGOS.Nethys.Share'))}</button>` : ''}
    </div>`;
}

const SPEAKER = () => ({ alias: 'Nethys' });

/** Post a finished question + answer for the whole table. */
export async function postPublicCard(question, answer) {
  return ChatMessage.create({
    speaker: SPEAKER(),
    content: cardHtml({ question, answer }),
    flags: { [deps.MODULE_ID]: { nethys: { question, answer, shared: true } } },
  });
}

/** Ask from the chat box. Shows a "consulting the Archives" card right away, then fills it in. */
async function askFromChat(question, isPublic) {
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  const whisper = isPublic ? [] : [game.user.id];
  const message = await ChatMessage.create({
    speaker: SPEAKER(),
    whisper,
    content: cardHtml({ question, pending: true }),
    flags: { [deps.MODULE_ID]: { nethys: { question, pending: true } } },
  });
  try {
    const answer = await askSite([{ role: 'user', content: question }]);
    await message.update({
      content: cardHtml({ question, answer, shareable: !isPublic }),
      [`flags.${deps.MODULE_ID}.nethys`]: { question, answer, pending: false },
    });
  } catch (err) {
    await message.update({
      content: cardHtml({ question, error: t('DNDAMIGOS.Nethys.Failed', { error: err.message }) }),
      [`flags.${deps.MODULE_ID}.nethys`]: { question, pending: false, failed: true },
    });
  }
}

// "/nethys question" and "/nethys! question" — handled here and kept out of the normal chat.
Hooks.on('chatMessage', (chatLog, text) => {
  const match = COMMAND.exec(String(text ?? '').trim());
  if (!match) return true;
  const question = (match[2] || '').trim();
  if (!question) {
    ui.notifications.info(t('DNDAMIGOS.Nethys.Usage'));
    return false;
  }
  askFromChat(question, match[1] === '!');
  return false;
});

// The "Share with table" button on a private answer. Foundry v13+ hands this hook a plain
// element (renderChatMessageHTML); v12 a jQuery object (renderChatMessage).
function bindShareButton(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const button = root?.querySelector?.('[data-action="nethys-share"]');
  if (!button || button.dataset.bound) return;
  button.dataset.bound = '1';
  const info = message.getFlag?.(deps.MODULE_ID, 'nethys');
  if (!info?.answer) {
    button.remove();
    return;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await postPublicCard(info.question, info.answer);
      ui.notifications.info(t('DNDAMIGOS.Nethys.Shared'));
    } catch (err) {
      button.disabled = false;
      ui.notifications.error(err.message);
    }
  });
}
Hooks.on('renderChatMessageHTML', bindShareButton);
Hooks.on('renderChatMessage', bindShareButton);

/* --------------------------------------------------------------------
   The Ask Nethys window
-------------------------------------------------------------------- */

// Kept for as long as this browser has Foundry open, so closing and reopening the window
// (or asking a follow-up) keeps the conversation.
const windowHistory = [];
let openWindow = null;

export function openNethysWindow() {
  if (!deps.isConfigured()) {
    ui.notifications.warn(t('DNDAMIGOS.ActorSheet.NotConfigured'));
    return;
  }
  if (openWindow?.rendered) {
    openWindow.bringToFront?.();
    return;
  }

  openWindow = openDialog({
    title: t('DNDAMIGOS.Nethys.WindowTitle'),
    content: `
      <div class="dnd-amigos-nethys-window">
        <div class="dnd-amigos-nethys-log" data-role="log"></div>
        <textarea data-role="question" rows="2" placeholder="${esc(t('DNDAMIGOS.Nethys.Placeholder'))}"></textarea>
        <div class="dnd-amigos-nethys-row">
          <button type="button" data-action="ask"><i class="fa-solid fa-hat-wizard"></i> ${esc(t('DNDAMIGOS.Nethys.Ask'))}</button>
          <button type="button" data-action="new"><i class="fa-solid fa-rotate-left"></i> ${esc(t('DNDAMIGOS.Nethys.NewChat'))}</button>
        </div>
        <p class="dnd-amigos-nethys-hint">${esc(t('DNDAMIGOS.Nethys.WindowHint'))}</p>
      </div>
    `,
    buttons: { close: { label: game.i18n.localize('Close') } },
    width: 440,
    render: (html) => {
      const log = html.find('[data-role="log"]')[0];
      const box = html.find('[data-role="question"]')[0];
      const askBtn = html.find('[data-action="ask"]')[0];
      if (!log || !box || !askBtn) return;

      const scrollDown = () => { log.scrollTop = log.scrollHeight; };

      const addEntry = (role, text, { pending = false, error = false } = {}) => {
        const div = document.createElement('div');
        div.className = `dnd-amigos-nethys-msg ${role === 'user' ? 'is-you' : 'is-nethys'}${error ? ' is-error' : ''}`;
        if (role === 'user') div.textContent = text;
        else if (pending) div.innerHTML = `<p class="dnd-amigos-nethys-pending"><i class="fa-solid fa-hat-wizard"></i> ${esc(t('DNDAMIGOS.Nethys.Thinking'))}</p>`;
        else if (error) div.textContent = text;
        else div.innerHTML = renderReply(text);
        log.appendChild(div);
        scrollDown();
        return div;
      };

      // A "Share to chat" link under an answer posts that question + answer for the table.
      const addShareLink = (div, question, answer) => {
        const link = document.createElement('a');
        link.className = 'dnd-amigos-nethys-share-link';
        link.innerHTML = `<i class="fa-solid fa-share"></i> ${esc(t('DNDAMIGOS.Nethys.ShareToChat'))}`;
        link.addEventListener('click', async () => {
          if (link.dataset.done) return;
          link.dataset.done = '1';
          try {
            await postPublicCard(question, answer);
            link.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(t('DNDAMIGOS.Nethys.Shared'))}`;
          } catch (err) {
            delete link.dataset.done;
            ui.notifications.error(err.message);
          }
        });
        div.appendChild(link);
      };

      const showAll = () => {
        log.replaceChildren();
        if (!windowHistory.length) {
          const p = document.createElement('p');
          p.className = 'dnd-amigos-nethys-empty';
          p.textContent = t('DNDAMIGOS.Nethys.Empty');
          log.appendChild(p);
        }
        windowHistory.forEach((m, i) => {
          const div = addEntry(m.role, m.content);
          if (m.role === 'assistant' && windowHistory[i - 1]?.role === 'user') addShareLink(div, windowHistory[i - 1].content, m.content);
        });
      };

      const ask = async () => {
        const question = box.value.trim();
        if (!question || askBtn.disabled) return;
        box.value = '';
        log.querySelector('.dnd-amigos-nethys-empty')?.remove();
        windowHistory.push({ role: 'user', content: question });
        addEntry('user', question);
        const pending = addEntry('assistant', '', { pending: true });
        askBtn.disabled = true;
        try {
          const answer = await askSite(windowHistory);
          windowHistory.push({ role: 'assistant', content: answer });
          while (windowHistory.length > 40) windowHistory.shift();
          pending.innerHTML = renderReply(answer);
          addShareLink(pending, question, answer);
        } catch (err) {
          windowHistory.pop();
          pending.classList.add('is-error');
          pending.textContent = t('DNDAMIGOS.Nethys.Failed', { error: err.message });
        } finally {
          askBtn.disabled = false;
          scrollDown();
          box.focus();
        }
      };

      askBtn.addEventListener('click', ask);
      // Enter asks, Shift+Enter is a new line (and stop the window's form from "pressing" Close).
      box.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          ev.stopPropagation();
          ask();
        }
      });
      html.find('[data-action="new"]').on('click', () => {
        windowHistory.length = 0;
        showAll();
        box.focus();
      });

      showAll();
      box.focus();
    },
    close: () => { openWindow = null; },
  });
}
