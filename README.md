# D&D Amigos Connector

A FoundryVTT module (Pathfinder 2e) that connects a Foundry world to the
[D&D Amigos](https://dndamigos.com) website. Every feature is
a button you click — nothing runs automatically in the background.

## Features

A small black **"&" button** (a red ampersand) in the bottom-right
corner of the game screen, beside the chat box, opens a menu of
everything below except Sync. The same menu is also behind the
**"D&D Amigos"** button at the top of the Journal tab. (Each player can
hide the & button: Configure Settings, "Show the D&D Amigos button". It
sits just left of the sidebar on Foundry v13+, or in the bottom-right of
the play area on v12; the top right is left alone because PF2e shows
conditions and effects there.) The menu has everything below except Sync (which lives on the actor sheet
itself, since it's specific to one character). Every menu item is
available to every player, not just the GM, except "Import from D&D
Amigos," which stays GM-only. The top of that menu also has **"How to
Use This Module"** — a plain-language reference covering every feature
below (Sync included), set apart from the action items with its own
divider so it's easy to find without being mistaken for one of them.

- **D&D Amigos Sync** — a button on any PF2e character actor's
  sheet header (named direction-neutrally since it can pull or push,
  not just pull). If the actor isn't linked yet, pick an existing
  Character Vault entry to pull basic stats from (name, level, current
  HP, ability modifiers) — or, if it doesn't exist on the site yet,
  create one directly from the actor's current data, credited to
  whichever D&D Amigos member you've set as your identity (see "Setting
  your identity" below — required before you can create). Click again
  later on an already-linked actor and pick a direction: **Pull from
  Site** (overwrite this actor with what's on the site) or **Push to
  Site** (overwrite the site — stats and portrait image both — with this
  actor's current data). Push works if your identity matches whoever
  owns that character on the site, **or if you're the DM of the
  campaign it's in** — a DM often ends up running sync for a player's
  actor mid-session. If the linked character was since deleted from the
  site, pulling offers to create a fresh entry (or just unlink the
  actor) instead of failing with no way forward.
- **Post Session Update** — opens a small dialog to send a message to
  the campaign's Discord, optionally also logging it as a real entry in
  the site's session log.
- **Manage Loot** (called out in gold in the menu) — party loot lives
  in Foundry: the PF2e **Party** actor's inventory is the party stash
  (the "party" entry PF2e keeps in the Actors tab). Drag items in from
  compendiums or character sheets, split coins, and hand things out
  there, all standard PF2e. Manage Loot opens a small **Party Stash**
  window: the stash's coins, item count and total at a glance, when it
  was last synced, **Open Party Inventory** (PF2e's own Party sheet on
  its Inventory tab), and **Sync Loot to Site**, which sends the stash
  (every item with quantity, level, type, rarity and value, plus the
  coins) to the site. Anyone can sync, whenever they like. From the
  first sync on, the site's Party Loot page shows that snapshot
  read-only ("Synced from Foundry", with an Archives of Nethys search
  link per PF2e item) and its old editable ledger is frozen, so the two
  can't drift. Unidentified items go up under the name the table sees,
  with no level, value or link. Players need at least Observer
  permission on the Party actor to open its inventory. The first time,
  the GM also gets **Import Site Loot**: it copies the old site-side
  ledger into the stash as treasure items (value split per item, notes
  as the description) and syncs. Up to 1.5.x, Manage Loot edited the
  site ledger directly and could mirror items onto a separate PF2e
  "Loot" actor; both are gone, and the Loot Actor setting with them.
- **NPCs & Places** (open to everyone; was "Look Up" before v1.1) —
  search the campaign's NPCs and Places, open one to read it (portrait,
  tagline, description), and add **notes** the whole party can see.
  Notes are shared with the website: anything written here appears on
  that NPC's or place's page there, and the other way round. You can
  edit or delete your own notes; the campaign's DM can delete anyone's.
  Writing a note needs your identity set (see below); reading doesn't.
  The window's GM-only buttons are **New NPC** / **New Place** (a ready
  page in the right journal; the journal opens, large and resizable, at
  the new page, and you click its pencil to write it) and **Push to Site**.
- **Push NPCs & Places to Site** (GM only; also in the menu) — NPCs and
  Places are *written in Foundry*: one journal page each, in the
  "D&D Amigos: NPCs" and "D&D Amigos: Places" journals. Start a page
  with one italic line (the tagline), then the description. Pushing
  sends every page up to the campaign on the site and remembers which
  page is which entry (a hidden flag on the page), so pushing again
  updates it instead of duplicating it, and a rename in Foundry renames
  the site entry. An entry already on the site with the same name is
  adopted the first time. A picture on the page becomes the portrait
  (uploaded once). The site shows plain text, so headings, bold and
  lists are flattened (lists become "- item" lines). Only the
  campaign's DM (or a site admin) can push; their identity must be
  set. Entries pushed from Foundry are marked on the site "Written in
  Foundry" and can't be edited there, only noted on.
- **Import from D&D Amigos** (GM only) — pulls the campaign's Places
  and NPCs in as Journal Entries (loot isn't imported: it lives in the
  Party actor, see Manage Loot), and shows your E.Y.F.F.O.
  mini-game stats in a popup if you've set your identity and played it.
  For NPCs and Places it **adds pages that are not here yet and
  refreshes pages you have not touched, but never overwrites or deletes
  a page you changed or made in Foundry** (it tells you how many it left
  alone). A page you already had with the same name as a site entry is
  linked to it rather than replaced.
- **Ask Nethys** (everyone) — rules questions without alt-tabbing out of
  a session. Nethys is the group's rules helper (the same one as the
  Discord bot and the website's Ask Nethys page): it looks Pathfinder 2e
  Remaster and Starfinder 2e rules up on Archives of Nethys and links
  the page it used. Type `/nethys <question>` in the chat box for a
  private answer card only you see, with a **Share with table** button;
  `/nethys! <question>` posts the question and answer for everyone. Or
  open **Ask Nethys** from the menu for a small chat window to keep
  beside the map: follow-ups remember the conversation (until you click
  New Chat or close Foundry), and each answer has a **Share to chat**
  link. The answers come from the website
  (`engine/api/foundry/nethys-ask.php`, which needs `OLLAMA_API_KEY` in
  the site's config.php); the module holds no AI key. The whole table
  shares a limit of 120 questions an hour.

### Setting your identity

Foundry accounts and D&D Amigos site accounts aren't linked to each
other automatically. **Post Session Update**, NPC & Place notes, and
the E.Y.F.F.O. stats popup in **Import from D&D
Amigos** all need to know which site member you are so the right name
gets credited. Each player
sets this once per browser/device under **Configure Settings → My D&D
Amigos Identity** — a plain dropdown of site members, populated
automatically once the connection is configured. This is saved
per-browser (a Foundry "client" setting), not shared with other
players and not tied to the world.

Note that this identity is who gets credited for a session post or
note — it's deliberately never assumed to also be who a
newly-created character is *for*. A character made via "Create New on
Site" shows up on the site as "Unassigned" until someone explicitly
picks a Player there, even though your identity is what owns it (and
can edit it). This is on purpose: since a DM often creates several
characters for the whole table in one sitting, defaulting the Player to
whoever clicked the button made every one of those look like the DM's
own character.

## Setup

### 1. On the website (one-time, done by whoever administers the site)

`engine/config.php` needs two values filled in (this file never
auto-deploys — it has to be edited directly on the server):

```php
define('FOUNDRY_API_KEY', '...');   // php -r "echo bin2hex(random_bytes(32));"
define('FOUNDRY_ORIGIN', 'https://your-foundry-host');
```

### 2. Install this module

Install it from its GitHub releases: in Foundry, Add-on Modules, Install
Module, and paste this into "Manifest URL":

```
https://github.com/InternetGamer360/dnd-amigos-foundry/releases/latest/download/module.json
```

(Up to 1.5.1 the module was served from
`https://hunterco.net/dnd-amigos-foundry/module.json`. That address still
works: it now points installs at GitHub, so an older install moves over on
its next Check for Updates.)

Foundry's **Check for Updates** then picks up every new release from the
same place. Enable the module in your world's Manage Modules screen. (You
can also copy this whole folder into your server's `Data/modules/`
directory, so it ends up as `Data/modules/dnd-amigos-connector/`.)

#### Releasing a new version (for whoever maintains it)

1. Change `version` in `module.json`. `compatibility.verified` is a whole
   Foundry generation (`"14"`), which Foundry treats as verified for every
   build of that generation, so it only needs bumping (to `"15"`) once the
   module is checked on a new generation.
2. Commit, then tag and push: `git tag v1.5.3` and `git push --tags`. The tag
   must match `module.json`'s version with a leading `v`.
3. The **Release** workflow (`.github/workflows/release.yml`) builds
   `module.zip`, points the manifest and download URLs at this repository's
   latest release, and publishes both files. Nothing to upload by hand.

### 3. Configure it in Foundry

The first time a GM loads a world with this module enabled but not yet
configured, a popup walks through this step automatically. Otherwise:
open **Configure Settings → D&D Amigos Connection** and fill in:
- **Site URL** — e.g. `https://dndamigos.com`
- **API Key** — the same value as `FOUNDRY_API_KEY` above
- **Journal ID** — the numeric id of the campaign journal on the site
  this world corresponds to (visible in the site's URL when viewing
  that campaign, e.g. `journal.php?id=5` → `5`)

Click **Test Connection** before saving — it'll tell you the linked
journal's name if everything's correct, or exactly what failed if not.

## Things worth knowing before relying on this

**New in 1.6.2:** the & button sits 14px up from the bottom edge, and with the sidebar collapsed it steps just left of the floating chat box instead of covering it (both checked in the live world). **New in 1.6.1:** first click-through in the group's live v14 world (as a Player-role user): the & button, the menu, the Party Stash window, Open Party Inventory (PF2e's "Stash" tab) and a private `/nethys` all worked; the & button now sits at the bottom-right of v14's chat pop-up column, right beside the chat box (1.6.0 put it 300px further left). Sync Loot to Site itself has not been pressed in the live world yet. **New in 1.6.0:** loot moved into Foundry (see Manage Loot above). The party-stash reading uses PF2e 8.x's own Party actor API (`game.actors.party`, `inventory.coins`, `totalWealth`, each item's `assetValue`), checked against the PF2e code running on the group's server, and the site side was tested end to end against a local copy of the site; the window itself had not yet been clicked through in the live world when this shipped.

**New in 1.3.0:** every window now uses Foundry's newer window type (DialogV2) instead of the deprecated Dialog/FormApplication, which removes the deprecation warnings and future-proofs the module. Nothing about what the windows do changed. It was exercised against a stand-in Foundry, not a live world, so if any window misbehaves, turn on **Use legacy windows** in Configure Settings to get the old ones back. **New in 1.2.0:** pushing a character now saves the WHOLE actor on the site (every item with quantities and containers, spells, feats, skills, conditions, coins, biography), shown as a readable sheet on the PCs page, and Pull from Site can restore all of it onto an actor. Exercised against the site's endpoints with a hand-built actor, but the restore itself (Foundry's own Import Data path) has not been run in a live world. **New in 1.1.0:** NPCs & Places syncing and shared notes (pull, push, portraits, notes window). The data logic was exercised end to end against the real site endpoints, but the notes window itself was written without a live Foundry to click through, so treat its first real use as the test.

This has been in real use by the group since v0.2.1 — sync (pull,
push, and create), the old Add/Manage Loot, Post Session Update, Look Up,
Import, and the identity setting have all been clicked through against
a real Foundry v14 instance at some point in this module's life.

That said, this module changes often, and a version bump doesn't imply
a fresh click-through of everything — only what a given change actually
touched gets exercised again in practice. Everything genuinely new only
gets verified server-side here (the site's own endpoints tested
directly against a local copy of the site) plus careful manual
read-throughs of the JS, since there's no live Foundry instance to test
against directly. As of this writing, that applies to the newest layer
on top of the confirmed core above:
- **The single "D&D Amigos" menu** (`openAmigosMenu()` in
  `scripts/main.js`) — replacing what used to be several separate
  sidebar buttons with one that opens a Dialog listing them instead,
  including a "How to Use This Module" reference at the top
  (`openHelpDialog()`). Built on the same window helper (`scripts/windows.js`) the rest of the
  module already uses.
- **The Sync button's label** — renamed to the direction-neutral "D&D
  Amigos Sync" after real players found "Sync from D&D Amigos"
  confusing once it could also push. Cosmetic only; the underlying pull/
  push/create logic is part of the confirmed core above.

Worth a real click-through of that list specifically before trusting it
blindly — everything below this point is the older, already-confirmed
detail.

1. **The PF2e actor field mapping** (`buildBasicPf2eUpdate()` in
   `scripts/main.js`) only sets name/level/HP/ability modifiers on
   purpose — pf2e actors build ancestry/background/class/skills/feats
   from real compendium Items, and guessing at that mapping blind would
   be far less reliable than pf2e's own **"Import from Pathbuilder"**
   feature (already built into character creation in the pf2e system).
   So for any character imported from Pathbuilder, syncing also copies
   the complete raw Pathbuilder export to your clipboard and saves it
   on the actor's flags — paste it into that native importer on the
   same actor for the full build. If the *basic* fields (level/HP/
   ability mods) don't show up correctly, the exact `system.*` paths in
   `buildBasicPf2eUpdate()` are the one place to check — pf2e's data
   model can shift between versions.
2. **Where the "D&D Amigos" button lands** — `renderJournalDirectory`
   in `scripts/main.js` looks for `.directory-header .header-actions`,
   falling back to `.directory-header`. Foundry's sidebar markup has
   changed slightly across versions; if the button doesn't show up (or
   lands somewhere awkward), that selector is the thing to adjust.
3. **The window types** — every window goes through `scripts/windows.js`,
   which uses Foundry's newer `DialogV2` and falls back to the old `Dialog`
   if a new-style window fails to build. If a window ever won't open or looks
   broken on a future Foundry, the per-browser setting **Use legacy windows**
   (Configure Settings → D&D Amigos Connector) switches back to the old
   type until the module catches up.

`module.json`'s `compatibility.minimum`/`verified` is currently `12`/
`14`, matching the group's actual Foundry instance — adjust if that
ever changes.

Everything else — settings storage, the API client, the dialogs, the
journal-entry import — uses stable, long-standing Foundry APIs
(`game.settings`, `DialogV2`, `JournalEntry`) and should work as written.
