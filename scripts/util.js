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
