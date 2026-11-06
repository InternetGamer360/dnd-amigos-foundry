// D&D Amigos Connector — scripts/hero-points.js
//
// House rule: spending a hero point on a check does not reroll it, it raises the result by one
// degree of success (failure becomes success, success becomes critical success, and so on). Pathfinder
// 2e / Starfinder 2e only, and switched on or off with the world setting "Hero points raise the
// degree of success".
//
// How it hooks in: the chat card's "Reroll using Hero Point" menu entry calls
// game.pf2e.Check.rerollFromMessage(message, { resource: 'hero-points' }). This wraps that one
// function. For a hero point it adds a one-degree-better adjustment (the same record the game
// system's own AdjustDegreeOfSuccess rule uses, labelled "Hero Point") to the card's check context
// and then lets the system run its normal reroll, with the new roll made to be the old one, so the
// dice do not change. The system therefore still does everything else itself: it spends the hero
// point, rebuilds the card with the adjusted degree and its notes, and keeps the initiative in step.
//
// What it will not do, with a message instead of spending anything:
//   - a check with no DC (nothing to raise the degree against);
//   - a check that is already a critical success.
// Mythic points, "keep higher/lower" and the plain reroll entries are left exactly as they were.
//
// The GM can switch it from the D&D Amigos menu (toggleHeroPointRule) or the world setting.
//
// Every hero point spent on a check, with the rule on or off, also puts a gold "Heroic moment" banner
// in the chat (and calls the hook dndAmigosHeroPoint({ actor, from, to, raised }), for later use).

import { MODULE_ID, esc, t } from './util.js';

const SYSTEMS = ['pf2e', 'sf2e'];

/** True where the house rule applies at all (the menu entry is hidden elsewhere). */
export const heroPointRuleAvailable = () => SYSTEMS.includes(game.system.id);

/** The menu entry's text: the rule's state, and what a click does. */
export const heroPointRuleLabel = () => t(game.settings.get(MODULE_ID, 'heroPointBump') ? 'DNDAMIGOS.HeroPoint.MenuOn' : 'DNDAMIGOS.HeroPoint.MenuOff');

/** GM only (a world setting): flips the house rule and says what it is now. */
export async function toggleHeroPointRule() {
  if (!game.user.isGM) return;
  const on = !game.settings.get(MODULE_ID, 'heroPointBump');
  await game.settings.set(MODULE_ID, 'heroPointBump', on);
  ui.notifications.info(t(on ? 'DNDAMIGOS.HeroPoint.NowOn' : 'DNDAMIGOS.HeroPoint.NowOff'));
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'heroPointBump', {
    name: 'DNDAMIGOS.HeroPoint.SettingName',
    hint: 'DNDAMIGOS.HeroPoint.SettingHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
});

Hooks.once('ready', () => {
  if (!SYSTEMS.includes(game.system.id)) return;
  const Check = (game.pf2e ?? game[game.system.id])?.Check;
  if (typeof Check?.rerollFromMessage !== 'function') {
    console.warn(`${MODULE_ID} | the hero point house rule could not find the system's reroll, so hero points work as normal`);
    return;
  }
  if (Check.rerollFromMessage.dndAmigosHeroPoint) return;
  const original = Check.rerollFromMessage;
  const wrapped = async function rerollFromMessage(message, options = {}) {
    const run = () => original.call(this, message, options);
    if (options?.resource !== 'hero-points') return run();
    if (!game.settings.get(MODULE_ID, 'heroPointBump')) return announcing(message, run, false);
    return announcing(message, () => raiseWithHeroPoint(run, message), true);
  };
  wrapped.dndAmigosHeroPoint = true;
  Check.rerollFromMessage = wrapped;
});

const NEXT_DEGREE = { criticalFailure: 'failure', failure: 'success', success: 'criticalSuccess' };

/**
 * Runs a hero point reroll and, if it really spent a point, puts a banner in the chat. Wraps both
 * the house rule and the normal reroll, so every hero point is an event whichever way it is set.
 */
async function announcing(message, run, raised) {
  const actor = message?.actor;
  const owner = actor?.isOfType?.('familiar') ? actor.master : actor;
  const before = owner?.isOfType?.('character') ? owner.getResource?.('hero-points')?.value : undefined;
  const context = message?.flags?.pf2e?.context;
  const from = context?.outcome ?? context?.unadjustedOutcome ?? null;
  const result = await run();
  const after = before === undefined ? undefined : owner.getResource?.('hero-points')?.value;
  if (before !== undefined && after !== undefined && after < before) {
    try {
      await announceHeroPoint({ owner, from, raised });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not post the hero point banner`, err);
    }
  }
  return result;
}

/** The banner: a heroic moment in the chat. */
async function announceHeroPoint({ owner, from, raised }) {
  const to = raised ? NEXT_DEGREE[from] ?? null : null;
  const name = esc(owner.name);
  const body = to
    ? t('DNDAMIGOS.HeroPoint.Banner.Raised', { name, from: t(`DNDAMIGOS.HeroPoint.Degree.${from}`), to: t(`DNDAMIGOS.HeroPoint.Degree.${to}`) })
    : t('DNDAMIGOS.HeroPoint.Banner.Rerolled', { name });
  const stars = '<i class="fa-solid fa-star"></i>';
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: owner }),
    content: `<div class="dnd-amigos-heroic">
      <div class="dah-stars">${stars}${stars}${stars}</div>
      <h3>${t('DNDAMIGOS.HeroPoint.Banner.Title')}</h3>
      <p>${body}</p>
    </div>`,
    flags: { [MODULE_ID]: { heroic: true } },
  });
  Hooks.callAll('dndAmigosHeroPoint', { actor: owner, from, to, raised });
}

/** `reroll()` runs the system's own reroll; this arranges for it to raise the degree instead. */
async function raiseWithHeroPoint(reroll, message) {
  const actor = message?.actor;
  const owner = actor?.isOfType?.('familiar') ? actor.master : actor;
  const context = message?.flags?.pf2e?.context;
  // Anything unusual (no permission, no actor, not a character's check): the system explains itself.
  if (!(message.isAuthor || game.user.isGM) || !owner?.isOfType?.('character') || !context) return reroll();

  if (!context.dc) {
    ui.notifications.warn(t('DNDAMIGOS.HeroPoint.NoDC'));
    return undefined;
  }
  if ((context.outcome ?? context.unadjustedOutcome) === 'criticalSuccess') {
    ui.notifications.warn(t('DNDAMIGOS.HeroPoint.AlreadyCrit'));
    return undefined;
  }
  const points = owner.getResource?.('hero-points');
  if (!(points?.value > 0)) {
    ui.notifications.warn(t('DNDAMIGOS.HeroPoint.NoPoints', { name: owner.name }));
    return undefined;
  }

  // The system rebuilds the card from the message's own flags, so put the adjustment there (only on
  // this client, and only for the length of this call: the system deletes the card and makes a new one).
  const before = foundry.utils.deepClone(context.dosAdjustments ?? null);
  context.dosAdjustments = { ...(before ?? {}), all: { label: t('DNDAMIGOS.HeroPoint.Label'), amount: 1 } };

  // The "new" roll is the old roll again, so the dice do not change.
  const keepDice = Hooks.on('pf2e.preReroll', (oldRoll, newRoll) => {
    newRoll.evaluate = async () => oldRoll;
  });
  // ...and the dice animation (Dice So Nice) should not throw the same dice a second time.
  const noAnimation = Hooks.on('preCreateChatMessage', (created) => {
    if (created.flags?.pf2e?.context?.isReroll) created.updateSource({ 'flags.dice-so-nice.animateRoll': false });
  });
  try {
    return await reroll();
  } finally {
    Hooks.off('pf2e.preReroll', keepDice);
    Hooks.off('preCreateChatMessage', noAnimation);
    if (before) context.dosAdjustments = before;
    else delete context.dosAdjustments;
  }
}
