# Changelog

All notable changes to the D&D Amigos Connector. Newest first.

## 1.9.0 — 2026-10-22
- **Break Room.** The GM starts a break from the D&D Amigos menu (**Break**) or with `/break 10`: pick 5, 10, 15, 20 or 30 minutes, or type any number. The game pauses and a panel at the top of the screen shows the countdown, when you're back, and every player as **Back**, **Away** or **Offline**. Players press **I'm back** (or type `/back`; `/brb` steps away again). The GM can add 5 minutes, ring a bell, or end the break (asked first if people are still away). When everyone is back the break ends on its own and the game unpauses (a setting turns that off). Reloading mid-break puts the panel back.
- **Import a character from another campaign.** New **Import a character** entry in the menu: pick one of the characters from the site's other campaigns (a Part 1 character into Part 2; only ones with a full saved sheet are listed). The site makes a separate copy in this campaign, and a new actor is built here from its full sheet (every item, spell and feat), linked to the copy so Pull and Push work as usual. The original is left exactly as it was. Needs permission to create actors in the world.
- **Plays nicely with AFK Tavern.** If AFK Tavern is active, Break and `/break` open its break room instead, so the minigames keep working; a setting forces this module's room. Each break is also logged, and the module announces `dndAmigosBreakStart`, `dndAmigosBreakEnd`, `dndAmigosPlayerAway` and `dndAmigosPlayerBack` hooks, groundwork for the session flow.

## 1.8.1 — 2026-10-19
- **Session Recap is much less work for the GM.** No form first: opening it starts Nethys writing straight away, then shows **one preview** of the finished entry. Most nights: read it, press **Post**. **Edit** turns it into one editable box; **Rewrite…** takes an optional line (a fact Nethys missed, or "shorter") and redraws the whole recap. The time range is one line with a **change** link. By the dice stays exact.

## 1.8.0 — 2026-10-19
- **Session Recap** (GM): Nethys drafts a session-log entry from the night's chat plus the GM's story notes (where they went, who they met, what happened, where you stopped). The session defaults to everything since the last recap. **By the dice** (nat 20s and 1s per character, biggest hits, most rolls) is counted exactly from the dice, never by the AI. Review section by section with **Rewrite** per section (optionally with an instruction), then **Post** to the site's Session Log and this world's **Session Recaps** journal. In the menu, and linked from the GM's End of Session Sync.

## 1.7.3 — 2026-10-19
Security: personal Foundry tokens (from the website security audit).
- **My D&D Amigos Identity** now takes your personal Foundry token (make it on your D&D Amigos Account page → Foundry Connection) instead of picking your name from a list. **Check token** shows whose it is; Save checks it again before storing it (this browser only). Every request sends it as `X-Foundry-User`.
- Why: the shared connection key is a world setting every Foundry player can read, and the site used to trust whichever member the module named, so anyone could have acted as anyone. Now the site works out who you are from your token.
- Older versions keep working until an admin turns on **Require personal tokens** on the site's admin page.

## 1.7.2 — 2026-10-19
Polish and cleanup; no new features.
- **Fixed:** Test Connection (Configure Settings → D&D Amigos Connection) used to save whatever was typed in before you pressed Save, so testing a wrong URL and pressing Cancel still kept it. It now tests the typed values without saving them.
- **Fixed:** the first-run setup message no longer says your identity "credits loot" (loot lives in the Party actor since 1.6.0).
- Every visible label now comes from the language file (Save, OK, Test Connection, the setup message, the E.Y.F.F.O. stats popup).
- The small helpers shared by every window now live in one place (`scripts/util.js`) instead of four copies.
- Removed leftovers: an unused string and style from the old Look Up window, two debug console messages, and exports nothing used.
- README: version history moved here; "Things worth knowing" became a short Troubleshooting section.

## 1.7.1 — 2026-10-19
- The GitHub release workflow uses current actions (checkout v7, action-gh-release v3), clearing the "Node.js 20 is deprecated" warning. No module code changes.

## 1.7.0 — 2026-10-18
- **End of Session Sync**: one checklist window that sends the Party stash, every character in The Party (created on the site if not linked yet) and NPCs & Places in one go, then reports per part. Players get the stash and their own character.

## 1.6.2 — 2026-10-18
- The & button sits 14px up from the bottom edge, and steps left of the floating chat box when the sidebar is collapsed.

## 1.6.1 — 2026-10-18
- The & button sits right beside the chat box on Foundry v14 (it landed 300px further left in 1.6.0). First click-through in the group's live world.

## 1.6.0 — 2026-10-18
- **Loot lives in Foundry**: the PF2e Party actor's inventory is the party stash. Manage Loot opens a Party Stash window (Open Party Inventory, Sync Loot to Site, and a one-time GM Import Site Loot). The site shows a read-only snapshot.
- Removed the old ledger window, the Loot Actor setting and mirroring, and the loot journal page in Import.

## 1.5.3 — 2026-10-18
- Fixed "/nethys is not a valid chat message command" on Foundry v14 (its chat box sends HTML).
- `compatibility.verified` is the whole generation `14`, so every v14 build shows as verified.

## 1.5.2 — 2026-10-18
- Installs and updates come from GitHub releases; the old hunterco.net manifest forwards there.

## 1.5.0 – 1.5.1 — 2026-10-18
- A small black button with a red **&** on the game screen opens the D&D Amigos menu (1.5.0 briefly used a "P").

## 1.4.0 — 2026-10-18
- **Ask Nethys** inside Foundry: `/nethys` (private, with Share with table), `/nethys!` (public), and an Ask Nethys window.

## 1.3.0 — 2026-10-15
- Every window uses Foundry's newer DialogV2 (with a per-browser "Use legacy windows" fallback).

## 1.2.0 — 2026-10-15
- Pushing a character saves the whole actor on the site; Pull from Site can restore all of it.

## 1.1.x and earlier
- NPCs & Places syncing with shared notes (1.1), the single D&D Amigos menu, character Sync (pull, push, create), Post Session Update, Import, and the identity setting. In real use by the group since 0.2.1; 1.0.0 on 2026-09-29.
