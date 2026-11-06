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

import { MODULE_ID, t } from './util.js';

const SYSTEMS = ['pf2e', 'sf2e'];

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
    if (options?.resource !== 'hero-points' || !game.settings.get(MODULE_ID, 'heroPointBump')) {
      return original.call(this, message, options);
    }
    return raiseWithHeroPoint(() => original.call(this, message, options), message);
  };
  wrapped.dndAmigosHeroPoint = true;
  Check.rerollFromMessage = wrapped;
});

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
