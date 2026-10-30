// D&D Amigos Connector — scripts/util.js
//
// The few small helpers every part of the module uses, in one place. No Foundry state is
// touched at import time, so any script can import this without ordering worries.

export const MODULE_ID = 'dnd-amigos-connector';

/** Text made safe to put into HTML. */
export const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

/** A localized string, with {placeholders} filled in when data is given. */
export const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** The world's PF2e Party actor (PF2e's own "active party", else the first party), or null. */
export function getParty() {
  return game.actors?.party ?? game.actors?.find?.((a) => a.type === 'party') ?? null;
}

/** 12345 (copper) -> "123 gp 4 sp 5 cp"; zero parts dropped, "0 gp" for nothing. */
export function formatCp(cp) {
  cp = Math.max(0, Math.round(Number(cp) || 0));
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  const parts = [];
  if (gp) parts.push(`${gp.toLocaleString()} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (c) parts.push(`${c} cp`);
  return parts.length ? parts.join(' ') : '0 gp';
}

/**
 * The chat box's message as plain text. Foundry v14's chat input hands the chatMessage hook
 * HTML ("<p>/nethys ...</p>", "&amp;" for "&", <br> for new lines), and earlier versions plain
 * text; this reads either the way Foundry's own command parser does.
 */
export function chatText(message) {
  const raw = String(message ?? '');
  if (!/[<&]/.test(raw)) return raw.trim();
  const template = document.createElement('template');
  template.innerHTML = raw;
  template.content.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  template.content.querySelectorAll('p').forEach((p) => p.append('\n'));
  return template.content.textContent.trim();
}

/**
 * Our sheet-header buttons show only an icon (the sheet header is crowded with other modules'
 * buttons), so the name goes in a hover tooltip. Foundry's old-style window headers have no
 * tooltip of their own for a button, so this adds one after the sheet draws.
 */
const HEADER_TIPS = {
  'dnd-amigos-sync': 'DNDAMIGOS.ActorSheet.HeaderButton',
  'dnd-amigos-check': 'DNDAMIGOS.Check.HeaderButton',
};

export function tipHeaderButtons(app) {
  const root = app?.element?.[0] ?? app?.element;
  if (!root?.querySelectorAll) return;
  for (const [cls, key] of Object.entries(HEADER_TIPS)) {
    root.querySelectorAll(`.window-header .${cls}`).forEach((el) => {
      const text = game.i18n.localize(key);
      el.title = text;
      el.dataset.tooltip = text;
      el.setAttribute('aria-label', text);
    });
  }
}
