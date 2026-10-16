# D&D Amigos Connector

A FoundryVTT module (Pathfinder 2e) that connects a Foundry world to the
[D&D Amigos](https://dndamigos.com) website. Every feature is
a button you click — nothing runs automatically in the background.

## Features

One **"D&D Amigos"** button next to the Journal sidebar tab opens a
menu of everything below except Sync (which lives on the actor sheet
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
- **Manage Loot** (called out in gold in the menu) — styled and laid
  out like the site's own Party Loot table (pages/loot.php): a
  Description/Qty/Value/Notes table, a running Total Party Wealth line,
  and every current line right there with Edit/Delete. The site's
  Party Loot ledger is fully shared — anyone can edit or remove any
  line, not just whoever added it. Click **+ Add Loot** to add a new
  one — it opens an editable row at the top of the table, the same way
  the site's own "+ Add Loot" button does, credited to whichever D&D
  Amigos member you told the module you are (see "Setting your
  identity" below) — and, if a **Loot Actor** is configured (Configure
  Settings → D&D Amigos Connection), also drops the same item onto that
  world's shared PF2e Loot sheet, so the site's ledger and Foundry's
  "closet of things found adventuring" stay in sync from one entry
  instead of typing it twice. An item added while a Loot Actor is
  configured stays linked to its matching Foundry Item, so editing or
  deleting it here keeps both sides in sync; an item added straight on
  the site, or before a Loot Actor was ever configured, has no such
  link, so changes to it here only affect the site.
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
- **Import from D&D Amigos** (GM only) — pulls the campaign's Places,
  NPCs, and Party Loot in as Journal Entries, and shows your E.Y.F.F.O.
  mini-game stats in a popup if you've set your identity and played it.
  For NPCs and Places it **adds pages that are not here yet and
  refreshes pages you have not touched, but never overwrites or deletes
  a page you changed or made in Foundry** (it tells you how many it left
  alone). A page you already had with the same name as a site entry is
  linked to it rather than replaced.

### Setting your identity

Foundry accounts and D&D Amigos site accounts aren't linked to each
other automatically. Adding loot through **Manage Loot**, **Post
Session Update**, and the E.Y.F.F.O. stats popup in **Import from D&D
Amigos** all need to know which site member you are so the right name
gets credited. Each player
sets this once per browser/device under **Configure Settings → My D&D
Amigos Identity** — a plain dropdown of site members, populated
automatically once the connection is configured. This is saved
per-browser (a Foundry "client" setting), not shared with other
players and not tied to the world.

Note that this identity is who gets credited as having *added* a loot
line or session post — it's deliberately never assumed to also be who a
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
Module, and paste this into "Manifest URL" (replace `<owner>/<repo>` with
this repository):

```
https://github.com/<owner>/<repo>/releases/latest/download/module.json
```

Foundry's **Check for Updates** then picks up every new release from the
same place. Enable the module in your world's Manage Modules screen. (You
can also copy this whole folder into your server's `Data/modules/`
directory, so it ends up as `Data/modules/dnd-amigos-connector/`.)

#### Releasing a new version (for whoever maintains it)

1. Change `version` in `module.json` (and `compatibility.verified` if you
   tested on a newer Foundry).
2. Commit, then tag and push: `git tag v1.2.0` and `git push --tags`. The tag
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
- **Loot Actor** — optional. Pick this world's shared PF2e "Loot"
  actor (party stash) from the dropdown if you have one — this is what
  lets adding loot through **Manage Loot** write to Foundry as well as
  the site. Leave it on "— None —" and adding loot still works, it
  just only posts to the site.

Click **Test Connection** before saving — it'll tell you the linked
journal's name if everything's correct, or exactly what failed if not.

## Things worth knowing before relying on this

**New in 1.2.0:** pushing a character now saves the WHOLE actor on the site (every item with quantities and containers, spells, feats, skills, conditions, coins, biography), shown as a readable sheet on the PCs page, and Pull from Site can restore all of it onto an actor. Exercised against the site's endpoints with a hand-built actor, but the restore itself (Foundry's own Import Data path) has not been run in a live world. **New in 1.1.0:** NPCs & Places syncing and shared notes (pull, push, portraits, notes window). The data logic was exercised end to end against the real site endpoints, but the notes window itself was written without a live Foundry to click through, so treat its first real use as the test.

This has been in real use by the group since v0.2.1 — sync (pull,
push, and create), Add/Manage Loot, Post Session Update, Look Up,
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
- **Manage Loot's current layout** — a real table styled to match the
  site's own loot table (`pages/loot.php`), with adding, editing, and
  deleting all in one popup (the standalone Add Loot dialog was folded
  in once Manage Loot could do everything it did). The Foundry-side
  half (`addLootItemToFoundryActor()` /
  `updateLootItemOnFoundryActor()` / `deleteLootItemFromFoundryActor()`
  in `scripts/main.js`) all set the same pf2e `equipment` fields
  (`system.quantity`, `system.price.value.gp`,
  `system.description.value`), so they'd need the same fix together if
  a future pf2e update renames any of them. The site-side call always
  succeeds independently of the Foundry-side one — never a single
  all-or-nothing outcome. Rests on a `loot_items.foundry_item_id`
  column on the site plus `update-loot.php`/`delete-loot.php` to keep
  an item's site row and Foundry Item linked.
- **The single "D&D Amigos" menu** (`openAmigosMenu()` in
  `scripts/main.js`) — replacing what used to be several separate
  sidebar buttons with one that opens a Dialog listing them instead,
  including a "How to Use This Module" reference at the top
  (`openHelpDialog()`). Built on the same `Dialog` API the rest of the
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
3. **The identity dropdown's Handlebars template**
   (`templates/identity-settings.html`) uses Foundry's built-in
   `{{selectOptions}}` helper to build the `<select>` from
   `members-list.php`'s response — a long-standing core helper, but
   worth checking first if that dropdown ever renders empty despite a
   working connection.

`module.json`'s `compatibility.minimum`/`verified` is currently `12`/
`14`, matching the group's actual Foundry instance — adjust if that
ever changes.

Everything else — settings storage, the API client, the dialogs, the
journal-entry import — uses stable, long-standing Foundry APIs
(`game.settings`, `Dialog`, `JournalEntry`) and should work as written.
