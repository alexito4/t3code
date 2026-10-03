# Personal fork notes

`main` is built from a fixed set of `patch/*` branches (`PATCH_BRANCHES` in `alex.sh`), each one
kept current by _merging_ `upstream/main` into it — never rebasing. A merge only ever resolves
the delta since the last sync; a rebase re-derives conflicts for the entire diff every time,
which got expensive fast once an upstream PR started touching the same hot files repeatedly.
This file tracks what each branch is and why, so I don't have to reconstruct it from `git log`
or my own memory. Entries stay here permanently, including features later sent upstream — this
is a record of what I've built, not a todo list to clear out.

Remotes: `origin` is this fork (`alexito4/t3code`, push target), `upstream` is the real project
(`pingdotgg/t3code`, no write access, fetch source for `sync`/`rebuild`).

Two ways to update, both in `alex.sh`:

- **`sync`** (routine) — merges `upstream/main` straight into `main` and fast-forward-pushes to
  `origin`. Cheap, and the common case, since `main` already has every patch branch merged in;
  pulling fresh upstream commits into it is an ordinary incremental merge. If it conflicts,
  resolve it right there, or abandon (`git merge --abort`) and reach for `rebuild`.
- **`rebuild`** (fallback) — merges `upstream/main` into every patch branch independently first
  (small, isolated conflicts, one per branch), then discards `main` and rebuilds it from fresh
  `upstream/main` plus the current patch branch set. Use this when a plain `sync` conflict gets
  messy, or when adding/removing a line from `PATCH_BRANCHES` — dropping a feature is just
  removing its line and running `rebuild`. Stacked branches (see `patch_base` in `alex.sh`) merge
  their parent branch instead of `upstream/main`, so the parent's fixes flow up instead of being
  retyped in each child's merge.

`./alex.sh dist` runs `pnpm install` itself, so a sync that changes dependencies needs nothing
extra before building.

**Orchestration V2 (2026-10-02/03).** Upstream replaced the whole orchestration layer in one squash
(`de34391427`, ~1900 files): the V1 decider, projection pipeline, `packages/contracts/src/orchestration.ts`
and `apps/server/src/server.test.ts` are gone. Every branch below was ported on 2026-10-03 by
merging upstream into it (no history rewrite); the pre-port tips are kept locally as
`refs/backup/pre-v2/<branch>`. Two consequences that shape every fork feature now:

- V2 servers use `~/.t3/userdata/statev2.sqlite`, copied once from V1's `state.sqlite` on first V2
  launch and never re-synced. This fork's V2 build shares `statev2.sqlite` with the official V2
  app, but **never run both at once**: each server's startup/shutdown recovery ends every
  in-flight run recorded in the database, including the other app's. Quit one before opening the
  other.
- Fork-only server state must never become V2 orchestration events or commands. The official app
  decodes `orchestration_events` against a closed union, so one unknown event type breaks its
  stream and projection rebuilds. Use a plain repository + RPC instead (scratchpad is the template).

## Features

Things that add product functionality, distinct from the plumbing that just makes the fork
buildable/runnable for personal use (see Fork infrastructure below).

- **Review panel parity with Codex** — Codex's Review panel has three things T3 Code's didn't: a
  full staged/unstaged/committed diff-source split, per-file stage/revert buttons, and a
  collapsible file-tree browser with git-status badges. Split into four independently-droppable
  branches, each its own concern:
  - `patch/review-diff-staged-unstaged` — adds Unstaged and Staged diff views, end to end
    (contracts, server git plumbing, web dropdown, mobile section menu including `ReviewSheet.tsx`
    UI wiring). Upstream #15005 (2026-10-02) renamed its own views to "Changes" (merge-base vs
    working tree, incl. untracked; now the default) and "Uncommitted" (HEAD vs working tree), and
    still uses `{kind:"unstaged"}` to mean Uncommitted. Since the V2 port the fork keeps both
    upstream views and that key's meaning, and adds new keys for Unstaged/Staged (menu order:
    Changes, Uncommitted, Unstaged, Staged). The port also moved staged/unstaged onto upstream's
    stats/lazy per-file loading instead of computing both full patches on every request.
  - `patch/review-diff-committed-mode` — adds a "Committed" per-commit diff mode, adapted from
    upstream PR https://github.com/pingdotgg/t3code/pull/6102 (closed unmerged 2026-09-30 for
    lacking maintainer approval, so this is permanent fork code). The Commits submenu lists
    `<merge-base>..HEAD` (up to 100) and commit previews load per file like the other views.
    It's gated by a `reviewCommits` server capability. Mobile only gets the data-model update
    (`ReviewSectionKind`), matching #6102's own scope — no mobile "Commits" picker UI.
  - `patch/review-diff-file-actions` — per-file stage/unstage/discard buttons in the diff header,
    shown only in the working-tree views (Uncommitted/Unstaged/Staged), not Changes or
    Committed. They're gated by a `reviewFileActions` server capability. `discardFile` runs a
    silent `git stash push -- <path>` immediately before the destructive checkout/clean, left
    unpopped, purely as a recovery net — no confirmation dialog, the one-click UX matches Codex
    exactly. Git runs at the repository root with literal pathspecs; the V2 port fixed a project
    cwd below the repo root, and a file named like `[ab].txt` sweeping `a.txt` into the stash.
    Web + desktop only, deliberately no mobile UI.
  - **Stacked since the V2 port**: committed-mode and file-actions each sit on top of
    staged-unstaged and get updates by merging it (`patch_base` in `alex.sh`), not
    `upstream/main`. Before that, each carried its own retyped copy of staged-unstaged, so every
    sync resolved the same conflicts three times. Dropping staged-unstaged now means dropping all
    three.
  - `patch/review-diff-file-tree` — a collapsible file-tree sidebar in the diff panel using
    `@pierre/trees`' `gitStatus` option (installed, unused elsewhere in the codebase before this)
    for added/modified/deleted/renamed/untracked badges. **Dropped 2026-09-03**: upstream shipped
    its own diff-panel/PR-code-view file tree the same way
    (`1aa44a071 feat(web): add a file tree to the diff panel and pull request code view`), and
    after comparing the two, upstream's is a strict superset (expand/collapse-all, incremental
    path diffing instead of full resets, ancestor auto-expand on reveal, header/footer accessory
    slots that also power the PR code view). Removed from `PATCH_BRANCHES` and dropped via
    `rebuild` rather than merged forward — maintaining a parallel, permanently-conflicting
    implementation of something upstream now does natively and better wasn't worth it. The branch
    itself (`patch/review-diff-file-tree`) is left in place, unmerged with upstream, only as a
    historical reference; do not revive it without re-checking upstream hasn't since covered
    whatever gap prompted reviving it.
  - Built for personal use first; not yet sent upstream as PRs. Revisit upstreaming once lived
    with for a while — see the "personal first, upstream later" call in the planning
    conversation that produced these.

- **Configurable "Review this PR" pull request action** — adds a "Review this PR" menu item
  next to "Ask a question" / "Explain this PR", backed by a user-editable checklist in
  Settings → Source Control → Pull requests. On branch `feat/pull-request-review-checklist`
  (based on `upstream/main`) and composed into `main` via `PATCH_BRANCHES` as of 2026-09-02 —
  wanted in daily use now rather than waiting on upstream. Sent upstream as
  https://github.com/pingdotgg/t3code/pull/9099, closed unmerged 2026-09-30 for lacking prior
  maintainer approval (CONTRIBUTING.md "Prior approval"), so it stays a fork feature unless an
  Ideas discussion gets the direction approved first.

- **Codex usage undercount fix** — the Usage screen's Codex scan only read
  `~/.codex/sessions`, never `~/.codex/archived_sessions` (where Codex CLI rotates completed
  rollouts), silently undercounting Codex cost/tokens by 5x+ on an account that archives
  sessions. Also adds the "Unpriced" cost-quality metric to the web Usage page, matching
  mobile. Unlike the PR-review-checklist entry above, this one is wanted in daily use now, so
  it's on branch `fix/codex-usage-archived-sessions` (based on `upstream/main`, no `patch/`
  rename needed — the prefix is convention, not a requirement) and _is_ composed into `main` via
  `PATCH_BRANCHES`. Sent upstream as https://github.com/pingdotgg/t3code/pull/9226, closed
  2026-09-04 in favor of #7096 (which also deduplicated rollouts moving between session roots),
  and #7096 was itself closed unmerged. As of the V2 port upstream still scans only `sessions`, so
  this stays a fork fix. Check upstream's `UsageService.ts` scan roots before each port in case
  that changes.

- **Projects list page** — there was no way to see all projects at a glance, only a per-project
  settings screen reachable one at a time. Adds a `/projects` page listing every project
  (favicon, workspace path, thread count, last activity) plus an "Activity" section showing
  threads active per day over the last 30 days, styled to match the existing Usage page
  (headline stat + legend on the left, chart beside it, no card wrapper). Also adds a "Projects"
  icon to the sidebar's bottom-left utility bar. (It also linked the per-project settings
  breadcrumb back to the list until upstream #13139 removed that breadcrumb.) V2 thread shells
  include subagent child threads, so counts and the chart skip them (`isSidebarSubagentThread`);
  the no-project "Scratch" project is listed like any other. On branch
  `feat/projects-list-page` (based on `upstream/main`) and composed into `main` via
  `PATCH_BRANCHES`. Sent upstream as https://github.com/pingdotgg/t3code/pull/9238, closed
  unmerged 2026-09-30 for lacking prior maintainer approval, so this is permanent fork code.

- **Export a thread** — no existing way to show a colleague what happened in a thread without
  giving them access to the environment (confirmed by checking upstream: nothing solves this,
  and open PR #7902 "copy a link to a thread" explicitly isn't a share link — the recipient still
  needs pairing; #7902 has since closed unmerged). Adds "Export thread…" to the thread context
  menu (sidebar row and chat header, same shared `buildThreadActionMenuItems` list; web +
  desktop only) that saves the full transcript, tool activity, and code changes as one
  self-contained Markdown file: human/agent readable prose plus an embedded JSON block (format
  version 2: the full V2 thread projection encoded with `OrchestrationV2ThreadProjectionJson`)
  and a full-thread diff (whitespace changes kept), for a future T3-native re-import. Reasoning
  is left out of the readable transcript but kept in the JSON. No redaction — export is exactly
  what's in the thread. Read-only "learn from it" only for now; resuming a thread from an export
  is deliberately out of scope, though the embedded diff makes that a follow-up, not a redesign,
  when it's wanted. Since the V2 port it is **client-only**
  (`packages/client-runtime/src/state/threadExport.ts`, formatter in
  `packages/shared/src/threadExport.ts`): it uses only requests any official V2 server answers
  (the HTTP thread snapshot, `orchestration.getFullThreadDiff`, signed attachment URLs for inlined
  images), so there's no server code and no capability flag. The cost: the HTTP snapshot strips
  command output and per-file diffs and shortens large tool payloads. Threads without checkpoints
  (migrated V1 threads, threads outside a Git repo) export without a diff. On branch `feat/thread-share` (based on
  `upstream/main`) and composed into `main` via `PATCH_BRANCHES`. Built for personal use first;
  not yet sent upstream. CONTRIBUTING.md is explicit that unsolicited feature PRs are unlikely to
  be accepted without an Ideas discussion first — revisit once lived with for a while, and open
  that discussion before a PR if it still seems worth sending.

- **Scratchpad panel** — a new right-side panel, alongside Browser/Review/Files/Terminal, for
  freeform personal notes tied to a specific thread — there was no way to jot down ideas about a
  thread without polluting the actual conversation. Uses the same `@pierre/diffs` editor as the
  Files panel, including its exact line-selection → inline-comment-box → cite flow (reusing
  `buildFileReviewComment`'s sibling `buildScratchpadReviewComment`, which shapes a cited excerpt
  as a `ReviewCommentContext` with `sectionId: "scratchpad:<threadId>"` — no new
  `ComposerContextRecord` kind needed). The assistant-message selection toolbar also gets "Add to
  scratchpad", which appends the selection (read-then-write on the client, serialized per thread
  with the editor's own saves). Content persists server-side in `projection_thread_scratchpads`,
  created by its repository layer (`apps/server/src/persistence/ThreadScratchpads.ts`) rather
  than a numbered migration — see "Adding a new entry". It's served by two plain RPCs,
  `threadScratchpad.get` / `threadScratchpad.set`, fetched on demand and never part of the
  thread snapshot or shell broadcast, so a large scratchpad never slows down the thread list.
  Before V2 this was a `thread.scratchpad.set` orchestration command/event pair. The V2 port
  dropped that path, because a fork event type would break the official app sharing the
  database. The table name stayed so existing notes carried over; V2 keeps V1 thread IDs. The port
  also bumped the right panel's persisted storage version to 15: upstream independently used 14,
  and fork users already at the fork's 14 would otherwise skip the migration that strips the
  removed "Agents" surface. Since this only works against a server built from this fork, it's gated behind
  a new `scratchpad` server capability flag (`ExecutionEnvironmentCapabilities`) — clients hide
  the tab entirely when connected to an unpatched/upstream server (e.g. a remote machine running
  the official nightly) instead of offering one that would fail. On branch
  `feat/scratchpad-panel` (based on `upstream/main`) and composed into `main` via
  `PATCH_BRANCHES`. Built for personal use first; not yet sent upstream.

- **Conversation font size** — the Interface size in Settings → Appearance → Typography was the
  only knob that reached thread messages, and it scales the whole app (sidebar, header,
  controls). Adds a "Conversation size" row (Auto = follow Interface, or 12–20 px) that resizes
  only the thread timeline's text by overriding Tailwind's `--text-*` tokens inside a
  `.conversation-text` scope; spacing stays on the interface rem. Shown in both the simple and
  Advanced typography views. Web + desktop only (mobile uses Dynamic Type). Written from
  scratch instead of merging the competing open upstream PR
  https://github.com/pingdotgg/t3code/pull/11246 (conflicting, unreviewed, accidentally
  commits `.pnpm-store`, and also rescales fixed-px labels and composer approval panels,
  which is more than this needs). On branch `feat/conversation-font-size` (based on
  `upstream/main`) and composed into `main` via `PATCH_BRANCHES`. Sent upstream:
  https://github.com/pingdotgg/t3code/pull/13234 (open; this branch is the PR's head, so keep it
  free of fork-only changes, and remember that pushing it updates the PR). Known conflict spot:
  `MessagesTimeline.tsx`, where `.conversation-text` sits on the timeline viewport and the
  working row uses `min-h-6`. V2's timeline cards use `text-3xs` badges, which deliberately don't
  scale. Once merged, drop the branch from `PATCH_BRANCHES` and `rebuild`.

## Merged early from open upstream PRs

Features from someone else's still-open, unmerged upstream PR, pulled onto `main` ahead of
time so I get to use and improve them now. Not mine — improvements should go back to the
original PR, not pile up here as one-off fixes.

- **`/btw` side conversations** (side-question tool, right-panel/mobile-card UI, per-provider
  read-only isolation) — from https://github.com/pingdotgg/t3code/pull/8296
  (`Bil0000/t3code:feat/btw-side-questions`, 44 commits). Closed unmerged on 2026-09-07:
  upstream won't add a second ephemeral side-conversation protocol, so this fork now owns the
  feature outright.
  - **Branch**: `patch/pr8296-side-questions`, built by merging `upstream-pr-8296` (a mirror of
    `refs/pull/8296/head`, kept independent of everything else) onto fresh `upstream/main`.
    `alex.sh rebuild` merges `upstream/main` into this branch like any other patch branch —
    incrementally, resolving only the new delta each time, not the whole diff.
  - **V2 shape (ported 2026-10-03)**: contracts in `packages/contracts/src/sideQuestion.ts`
    (method names unchanged). `SideQuestionCoordinator.ask()` reads the thread's V2 turn items
    through `ThreadManagementService.getThreadRecords` and applies the timeline's own visibility
    rule, so rolled-back turns and cancelled queued messages are left out. Still stateless:
    nothing is written to the shared database. Web logic lives in `useSideChat.tsx`, so
    ChatView only gains about 40 lines. `SideQuestionPanel.tsx` is built on upstream's
    `ComposerSurface`/`ComposerBanner` via a `sideChatBanner` prop on `ChatComposer`. The fork's
    467-line composer CSS, `ComposerGlass.tsx` and `UserMessageBubble.tsx` were dropped, so side
    chat now looks like upstream's composer instead of the old glass styling. Every
    text-generation provider answers side questions, including V2's new Pi and OpenCode2. ACP
    Registry threads have no text generation and get a clear error. Known gaps: in a V2 forked
    thread, side chat only sees the fork's own turns, not the inherited history; each question
    loads all of the thread's matching items before trimming to the budget.
  - **Known conflict set** (recurs on `rebuild` for as long as this branch is carried):
    `ChatComposer.tsx`, `ChatView.tsx` (small since `useSideChat`), `ws.ts`, `rpc.ts`, the
    `textGeneration/*` providers, and the mobile
    `ThreadComposer.tsx`/`ThreadDetailScreen.tsx`/`ThreadSettingsSheet.tsx` trio. The branch no
    longer touches `index.css` and only passes props through `MessagesTimeline`. Resolution
    pattern: adopt upstream's newer architecture and splice side chat into it. Don't trust the
    auto-merged (non-conflicting) hunks blindly — this has twice produced silent bugs a
    conflict marker wouldn't catch (a duplicate type import, a dropped `data-*` attribute), only
    caught by running typecheck after resolving.
  - **`upstream-pr-8296`** is frozen at the closed PR's final head; there is nothing left to
    pull from the author.
  - **My own fixes/improvements to this feature** go straight onto
    `patch/pr8296-side-questions` now that there is no PR to send them back to:
    - Side chat reliability (2026-10-02) — a `sideQuestions` server capability, so web and
      mobile hide side chat (and send `/btw` to the agent) on servers without this fork, e.g. a
      remote machine on an official build, instead of failing with `Unknown request tag`. Long
      threads now keep their newest context within the 512 KB budget instead of refusing with
      "thread context is too large". Side chat still defaults to the thread's own model and
      effort, so on e.g. Opus at `xhigh` an answer takes ~30 s+; pick a lighter model in the
      side chat's picker when that matters.
    - `improve/pr8296-side-question-button` (2026-09-02) — a "Side question" entry in the right
      panel's empty-state launcher and `+` add-surface menu (shortcut `Q`), opening the panel
      with an empty turn list ready for a first question instead of requiring `/btw` typed in
      the main composer. Reuses the existing `submitSideQuestion`/`askSideQuestion` path, no new
      server-side plumbing. Already merged into `patch/pr8296-side-questions`.
    - "Ask in side chat" on the assistant text-selection toolbar (2026-09-03) — a second button
      next to "Cite" (`AssistantSelectionToolbar.tsx`; plain upstream buttons since the V2
      port's lint rules, shared with scratchpad's "Add to scratchpad") that opens/reuses the side chat and seeds its draft with the same citation
      token "Cite" inserts into the main composer (`useSideChat.tsx`'s `askSelection`,
      `SideQuestionPanel.tsx`'s nonce-gated `draftSeed` prop so repeat clicks prepend a fresh
      citation instead of wiping the conversation). Committed straight onto
      `patch/pr8296-side-questions` rather than a dedicated `upstream-pr-8296`-based branch like
      the entry above — this one isn't meant to go back to `Bil0000:feat/btw-side-questions`, so
      skip hunting for a separate `improve/pr8296-*` branch for it if the mirror pattern above
      doesn't turn it up.
  - **To drop this feature**: remove `patch/pr8296-side-questions` from `PATCH_BRANCHES` in
    `alex.sh` and run `rebuild`. That's it — isolation was the entire point of moving to
    branches.

## Fork infrastructure

Not features — just what it takes to build, sign, and run a personal copy of the app alongside
the official one. Never meant to merge upstream.

- **`patch/fork-infra`** — everything needed to build/run this fork, all in one branch since
  none of it is meaningfully droppable on its own (unlike a feature, there's no scenario where
  I'd want "the desktop identity but not alex.sh"). Covers:
  - **`alex.sh`** — this script.
  - **Personal desktop build identity** (`apps/desktop/src/app/DesktopUserData.ts`,
    `apps/desktop/src/app/DesktopEnvironment.ts`, `scripts/build-desktop-artifact.ts`,
    `apps/desktop/vite.config.ts`) — a build made via `alex.sh dist` gets its own bundle id
    (`com.t3tools.t3code.personal`) and Electron profile dir, gated behind
    `T3CODE_DESKTOP_PERSONAL_BUILD=1`, so it can be installed next to an official build instead
    of colliding with it (same profile = same single-instance lock = the second app silently
    quits). Since V2 the profile dir is chosen in `DesktopUserData.ts` (upstream: `t3code-v2`
    packaged, `t3code-dev` in dev) and the personal build uses `t3code-personal-v2`. Taking
    upstream's side of a `DesktopEnvironment.ts` conflict compiles fine but silently drops this,
    so check `DesktopUserData.ts` after every port. On macOS, as with upstream's own V2 switch,
    the first V2 launch starts with a fresh Electron profile (website and T3 Connect sign-ins
    again). App state (`~/.t3/userdata`) is resolved independently; see the V2 note at the top
    for how the database is shared and why the two apps must not run at the same time. `alex.sh
pair` writes into whichever database this checkout's server uses, so from a V2 `main` it
    only pairs with V2 servers.
  - **Personal build branding** — same idea as the official Nightly channel's distinctive
    visuals, so a personal build is recognizable at a glance next to an official install:
    - App icon: `assets/personal/app-icon.icon` (Icon Composer project, warm orange solid fill
      - the shared `text.svg` T3 mark, mirroring `assets/prod` and `assets/nightly`'s
        structure) wired through `scripts/lib/brand-assets.ts` (`personal*` asset paths),
        `scripts/export-brand-icons.ts` (`ICON_VARIANTS`), and
        `scripts/build-desktop-artifact.ts` (`resolveDesktopBuildIconAssets`,
        `resolveDesktopProductName` → `"T3 Code (Personal)"`), all gated on the same
        `T3CODE_DESKTOP_PERSONAL_BUILD=1` check as the bundle id. After changing the icon
        project, re-run `node scripts/export-brand-icons.ts` — like the other channels, the
        macOS 1024pt PNG (`assets/personal/personal-macos-1024.png`) still needs one manual
        export from the Icon Composer GUI per `assets/README.md`; the CLI exporter refuses that
        preset for every channel, not just this one.
    - Sidebar/composer-button art: `"Personal"` stage label (added to `DesktopAppStageLabel` in
      `packages/contracts/src/ipc.ts`, resolved in `DesktopEnvironment.ts`'s
      `resolveDesktopAppStageLabel`) drives a `"personal"` variant in
      `apps/web/src/components/SidebarStageBackdrop.tsx` (`SunsetHorizonArt`, alongside
      `NightlySkyArt`/`DevBlueprintArt`), painted with `--stage-sunset-*` tokens in
      `apps/web/src/index.css`. Unlike the nightly/dev art, the sunset palette is one fixed
      set of colors (not retinted per selectable color theme) — a personal build is a fixed
      identity, not a swappable theme, so this was scoped down deliberately.
  - **iOS personal-team Apple Team ID** (`apps/mobile/app.config.ts`) — reads
    `T3CODE_IOS_PERSONAL_TEAM_APPLE_TEAM_ID` so local iOS builds can sign with a personal Apple
    Developer team instead of the project's real one.
  - **This file.**
  - Any future fork plumbing goes here too — don't create a new `patch/*` branch for
    infrastructure, only for features or merged-early upstream PRs (see the sections above).

Run `./alex.sh` with no args for the current subcommand list (`dev`, `connect`, `sync`,
`sync-nightly`, `rebuild`, `dist`, `pair`). `./alex.sh dist` is the local desktop update workflow: it builds the
personal arm64 app, replaces `/Applications/T3 Code (Personal).app`, and removes its temporary
packaging artifacts. Close the installed app before reopening it to use the new build; do not use
the generated DMG or ZIP for local updates.

`sync-nightly` tracks upstream's nightly releases rather than `upstream/main`'s tip, so the
personal build sits on the same tested commits as the official Nightly app. Since 2026-10-03 a
T3 scheduled task ("Sync personal build with upstream nightly", every 3 hours, posting into the
thread that set it up) runs it, resolves conflicts on the owning patch branches, typechecks,
pushes, and runs `dist`. Manage it in the app's scheduled tasks. Each new build needs one Finder
double-click on first launch.

## Adding a new entry

New personal _feature_ (not infra): give it its own `patch/<name>` branch based on
`upstream/main`, add it to `PATCH_BRANCHES` in `alex.sh`, run `rebuild` to compose it into
`main` for the first time, document it here in "Features". Default to a new branch — the
ability to drop a feature independently is the reason this scheme exists.

Schema changes: never add a numbered migration on a fork branch. `~/.t3/userdata/statev2.sqlite`
(V1: `state.sqlite`) is shared with the official app, and the migrator skips every ID at or below
the highest one recorded, so a fork migration ID silently hides upstream's next migration with
that number, in both apps. That happened once: the scratchpad table was recorded as 53/54 in the
live DB, and upstream's own 54 (`auto_settle_disabled_at`) would never have run. Upstream now
documents the same trap for forks (`docs/internals/legacy-orchestration-migration.md`, "Divergent
migration ids"). Create fork-only tables idempotently (`CREATE TABLE IF NOT EXISTS`) where the
owning repository layer is built instead.

Server state: never add V2 orchestration event or command types on a fork branch (see the V2 note
at the top). Persist fork-only state through a plain repository + RPC, gated by a server
capability flag so clients hide the feature on official servers.

New _infra_ work: commit it directly onto `patch/fork-infra`, document it in "Fork
infrastructure" above. No new branch, no `PATCH_BRANCHES` change needed.

New upstream PR to merge early: mirror it (`git fetch upstream refs/pull/<n>/head && git branch
patch/pr<n>-<slug> FETCH_HEAD`), then merge it onto fresh `upstream/main` as its own
`patch/pr<n>-<slug>` branch (matching the PR #8296 entry above), add to `PATCH_BRANCHES`, run
`rebuild`, document it in "Merged early from open upstream PRs" with the same shape: branch
name, known conflict set, update recipe, drop recipe.

For a feature sent upstream as your own PR (not merged-early from someone else's), update its
status as it moves (draft → open → merged) rather than deleting the entry — once merged, note
that too and drop its branch from `PATCH_BRANCHES`, but keep the line here.
