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
  removing its line and running `rebuild`.

## Features

Things that add product functionality, distinct from the plumbing that just makes the fork
buildable/runnable for personal use (see Fork infrastructure below).

- **Configurable "Review this PR" pull request action** — adds a "Review this PR" menu item
  next to "Ask a question" / "Explain this PR", backed by a user-editable checklist in
  Settings → Source Control → Pull requests. Lives on its own branch
  (`feat/pull-request-review-checklist`), not composed into `main`. Sent upstream:
  https://github.com/pingdotgg/t3code/pull/9099 (draft, not yet submitted).

## Merged early from open upstream PRs

Features from someone else's still-open, unmerged upstream PR, pulled onto `main` ahead of
time so I get to use and improve them now. Not mine — improvements should go back to the
original PR, not pile up here as one-off fixes.

- **`/btw` side conversations** (side-question tool, right-panel/mobile-card UI, per-provider
  read-only isolation) — from https://github.com/pingdotgg/t3code/pull/8296
  (`Bil0000/t3code:feat/btw-side-questions`, 44 commits, open/unmerged as of 2026-09-02).
  - **Branch**: `patch/pr8296-side-questions`, built by merging `upstream-pr-8296` (a mirror of
    `refs/pull/8296/head`, kept independent of everything else) onto fresh `upstream/main`.
    `alex.sh rebuild` merges `upstream/main` into this branch like any other patch branch —
    incrementally, resolving only the new delta each time, not the whole diff.
  - **Known conflict set** (recurs on `rebuild` until the PR merges upstream or this drops):
    `ChatComposer.tsx`, `ChatView.tsx`, `MessagesTimeline.tsx`, `ws.ts`,
    `OpenCodeTextGeneration.ts`, `BranchToolbarEnvModeSelector.tsx`, `index.css`, and the
    mobile `ThreadComposer.tsx`/`ThreadDetailScreen.tsx`/`ThreadSettingsSheet.tsx` trio — main's
    composer-surface and OpenCode-shared-server refactors keep landing in the same spots the PR
    touches. Resolution pattern so far: adopt main's newer architecture (`ComposerSurface.*`,
    `OpenCodeServerOwner`), splice the PR's side-question JSX/logic into it. Don't trust the
    auto-merged (non-conflicting) hunks blindly — this has twice produced silent bugs a
    conflict marker wouldn't catch (a duplicate type import, a dropped `data-*` attribute), only
    caught by running typecheck after resolving.
  - **Updating from the author** (separate from `rebuild`, and NOT automatic — review what they
    changed first): `git fetch upstream refs/pull/8296/head && git branch -f upstream-pr-8296
FETCH_HEAD`, `git range-diff` against the old tip to see what changed, then merge the
    refreshed `upstream-pr-8296` into `patch/pr8296-side-questions`.
  - **My own fixes/improvements to this feature** belong on a branch based on
    `upstream-pr-8296` (not on `patch/pr8296-side-questions` directly), so they stay sendable as
    a PR against `Bil0000:feat/btw-side-questions` later. Then merge that branch into
    `patch/pr8296-side-questions` too if it should land in the daily build now, ahead of sending
    it upstream.
    - `improve/pr8296-side-question-button` (2026-09-02) — a "Side question" entry in the right
      panel's empty-state launcher and `+` add-surface menu (shortcut `Q`), opening the panel
      with an empty turn list ready for a first question instead of requiring `/btw` typed in
      the main composer. Reuses the existing `submitSideQuestion`/`askSideQuestion` path, no new
      server-side plumbing. Already merged into `patch/pr8296-side-questions`.
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
  - **Personal desktop build identity** (`apps/desktop/src/app/DesktopEnvironment.ts`,
    `scripts/build-desktop-artifact.ts`, `apps/desktop/vite.config.ts`) — a build made via
    `alex.sh dist` gets its own bundle id (`com.t3tools.t3code.personal`) and Electron
    `userData` dir (`t3code-personal`), gated behind `T3CODE_DESKTOP_PERSONAL_BUILD=1`, so it
    can run alongside an official install instead of colliding with it. Shared app state
    (`~/.t3/userdata`) is untouched, so projects/threads stay shared as normal.
  - **iOS personal-team Apple Team ID** (`apps/mobile/app.config.ts`) — reads
    `T3CODE_IOS_PERSONAL_TEAM_APPLE_TEAM_ID` so local iOS builds can sign with a personal Apple
    Developer team instead of the project's real one.
  - **This file.**
  - Any future fork plumbing goes here too — don't create a new `patch/*` branch for
    infrastructure, only for features or merged-early upstream PRs (see the sections above).

Run `./alex.sh` with no args for the current subcommand list (`dev`, `connect`, `sync`,
`rebuild`, `dist`, `pair`).

## Adding a new entry

New personal _feature_ (not infra): give it its own `patch/<name>` branch based on
`upstream/main`, add it to `PATCH_BRANCHES` in `alex.sh`, run `rebuild` to compose it into
`main` for the first time, document it here in "Features". Default to a new branch — the
ability to drop a feature independently is the reason this scheme exists.

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
