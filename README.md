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
- **End of Session Sync** (gold, near the top of the menu) — one window
  that brings the site up to date at the end of a session. It lists what
  it will send, all ticked, then **Sync to Site** runs each part and
  reports per line. **GM:** the Party stash, every character in The Party
  (pushed to its Character Vault entry, or created there if it isn't
  linked yet; a link to a deleted entry is cleared and recreated), and
  NPCs & Places; the GM's identity must be the campaign's DM on the site,
  since the site only takes a character push from its owner or the DM.
  **Players:** the Party stash and their own character(s) in The Party.
  The same pieces as the separate buttons, so nothing new on the site.
- **Session Recap** (GM only; in the menu and linked from End of Session
  Sync) — Nethys drafts a session-log entry from the night's chat. The
  session defaults to everything since the last recap (start/end
  adjustable). Four optional story-note boxes (where they went, who they
  met, what happened, where you stopped) carry the story, since chat is
  mostly dice. The module condenses the chat into a compact transcript and
  counts **By the dice** exactly from the dice results; the site
  (`engine/api/foundry/recap-draft.php`) has Nethys write the title,
  story, highlights and worth-noting sections. Every section is editable,
  each AI section has **Rewrite** (with an optional instruction), and
  **Post** adds it to the Session Log (`recap-post.php`) and to the
  world's "Session Recaps" journal.
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
  as the description) and syncs.
- **NPCs & Places** (open to everyone) —
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

### Setting your identity (personal token)

Foundry accounts and D&D Amigos site accounts aren't linked automatically,
and the shared connection key can be read by every Foundry player, so the
site doesn't take the module's word for who you are. Instead, each player:

1. On the website, opens their **Account** page → **Foundry Connection** →
   **Create token**, and copies it (it's shown once).
2. In Foundry, opens **Configure Settings → My D&D Amigos Identity**, pastes
   it, presses **Check token** (it shows whose token it is) and **Save**.

It's saved per browser (a Foundry "client" setting), so do it once on each
device. The module sends it with every request (`X-Foundry-User`), and the
site acts as that member whatever else the module sends. Replace or revoke
it on the Account page anytime. The site's admin page lists who has set one
up and has **Require personal tokens**: until that's on, older module
versions still work the old way.

Your identity is who gets credited for session posts, notes and new
characters; it's never assumed to be who a newly created character is
*for* (that shows "Unassigned" on the site until a Player is picked there).

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

## Troubleshooting and known limits

Version history is in [CHANGELOG.md](CHANGELOG.md).

- **A window won't open or looks broken** on a newer Foundry: turn on
  **Use legacy windows** (Configure Settings → D&D Amigos Connector, per
  browser). Every window goes through `scripts/windows.js`, which uses
  Foundry's `DialogV2` and falls back to the old `Dialog` on its own if a
  new-style window fails to build.
- **The & button or the journal button is missing or misplaced:** the &
  button's placement is `placeCanvasButton()` in `scripts/main.js` (plus
  its rules in `styles/module.css`); the journal button looks for
  `.directory-header .header-actions`, falling back to `.directory-header`.
  Foundry's layout has moved between versions, so those are the places to
  adjust. Players can hide the & button with **Show the D&D Amigos
  button**.
- **Pull from Site only sets the basics** (name, level, HP, ability
  modifiers) unless the site has a full Foundry snapshot of the character;
  `buildBasicPf2eUpdate()` in `scripts/main.js` holds the PF2e field paths
  if a PF2e update moves them. For a Pathbuilder-imported character, the
  raw Pathbuilder export is copied to your clipboard for PF2e's own
  "Import from Pathbuilder".
- **Moving loot needs a GM online:** players whose character is a member
  of The Party can move items in and out of its inventory, but PF2e
  routes those moves through the GM's client.
- **Character syncs and NPCs & Places need an identity** (My D&D Amigos
  Identity), and the site only accepts a character push from the
  character's owner or the campaign's DM.

`module.json`'s `compatibility` is minimum `12`, verified `14` (Foundry
treats a whole-number `verified` as every build of that generation).
