#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Each branch is one independently-droppable concern, kept current by
# merging upstream/main into it (not rebasing — a merge only ever resolves
# the *new* delta since the last sync; a rebase re-derives conflicts for the
# entire diff every time). Drop a feature by removing its line here and
# running `rebuild` — no history archaeology required. See ALEX.md for what
# each branch is and how to update the PR-derived ones.
#
# patch/fork-infra is the one exception to "one concern per branch": it's
# everything needed to build/sign/run this fork for personal use (alex.sh,
# desktop identity, iOS team ID, this file's own history, ALEX.md), which
# never gets dropped piecemeal — new infra work goes there too, not into a
# new branch.
PATCH_BRANCHES=(
    patch/fork-infra
    patch/pr8296-side-questions
)

usage() {
    echo "Usage: alex.sh <dev|connect|sync|rebuild|dist|pair> [args...]" >&2
    echo "  dev      Run pnpm dev with T3CODE_HOST=0.0.0.0 (LAN-reachable)" >&2
    echo "  connect  Run \`t3 connect\` from source (extra args forwarded, e.g. \`connect status\`)" >&2
    echo "  sync     Merge upstream/main into main and fast-forward-push to origin (the routine path)" >&2
    echo "  rebuild  Merge upstream/main into every patch branch, then rebuild main from scratch" >&2
    echo "           (fallback for a messy sync conflict, or for adding/removing a patch branch)" >&2
    echo "  dist     Build, sign, and install a local arm64 build to /Applications" >&2
    echo "  pair     Mint a pairing token for the official app's running server (extra args forwarded)" >&2
    exit 1
}

[[ $# -ge 1 ]] || usage
cmd="$1"
shift

cd "$REPO_ROOT"

case "$cmd" in
    dev)
        exec env T3CODE_HOST=0.0.0.0 pnpm --config.minimum-release-age=0 dev "$@"
        ;;
    connect)
        exec node apps/server/src/bin.ts connect "$@"
        ;;
    sync)
        # The routine path: main only ever gains commits, so this is a plain
        # fast-forward push — no --force needed. If this conflicts, either
        # resolve it right here on main, or abandon with `git merge --abort`
        # and run `./alex.sh rebuild` instead.
        git fetch upstream main
        git checkout main
        git merge upstream/main
        git push origin main:main
        ;;
    rebuild)
        # The fallback path: refresh every patch branch against upstream/main
        # independently (small, isolated conflicts, resolved once each), then
        # throw main away and rebuild it from upstream/main plus the current
        # patch branch set. Reach for this when a plain sync conflict gets
        # messy, or when adding/removing a line from PATCH_BRANCHES.
        #
        # This does NOT pull in an upstream PR author's own new commits (e.g.
        # upstream-pr-8296) — that stays a deliberate, separate step. See
        # ALEX.md's "Merged early from open upstream PRs" section.
        git fetch upstream main

        for branch in "${PATCH_BRANCHES[@]}"; do
            echo "==> Merging upstream/main into $branch"
            git checkout "$branch"
            git merge upstream/main
        done

        echo "==> Rebuilding main"
        git checkout -B main upstream/main
        for branch in "${PATCH_BRANCHES[@]}"; do
            git merge --no-ff --no-edit "$branch"
        done

        # Explicit local:remote refspecs, not just a branch name: these
        # branches track upstream/main (for the merge above), and a bare
        # branch-name push resolves its destination through that tracking
        # config instead of the branch's own name, which silently force-pushes
        # everything to origin's main. Cost a working main once already. Only
        # main needs --force here — checkout -B rewrites its history; every
        # patch branch only ever gained commits, so those still fast-forward.
        git push --force-with-lease origin main:main
        for branch in "${PATCH_BRANCHES[@]}"; do
            git push origin "$branch:$branch"
        done
        ;;
    dist)
        export PNPM_CONFIG_MINIMUM_RELEASE_AGE=0
        export T3CODE_DESKTOP_PERSONAL_BUILD=1
        pnpm build:desktop
        pnpm dist:desktop:dmg:arm64

        # electron-builder skips codesigning entirely for unsigned local
        # builds, leaving Electron's stock ad-hoc signature (with no
        # entitlements) on the binary. Without allow-jit /
        # allow-unsigned-executable-memory, V8 can't allocate JIT memory and
        # the app silently exits within its first second. Re-sign ad-hoc with
        # the entitlements the official notarized build gets for free, using
        # the zip artifact (a plain .app) rather than the dmg.
        zip_path="$(ls -t release/*-arm64.zip | head -1)"
        stage_dir="$(mktemp -d)"
        ditto -x -k "$zip_path" "$stage_dir"
        app_path="$(find "$stage_dir" -maxdepth 1 -iname "*.app")"

        entitlements_path="$(mktemp -t t3code-personal-entitlements).plist"
        cat >"$entitlements_path" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
PLIST
        codesign --force --deep --options runtime --entitlements "$entitlements_path" --sign - "$app_path"

        install_path="/Applications/$(basename "$app_path")"
        rm -rf "$install_path"
        ditto "$app_path" "$install_path"
        rm -rf "$stage_dir" "$entitlements_path"

        echo "Installed $install_path"
        echo "First launch needs one Finder double-click to clear Gatekeeper's unsigned-app approval (open/exec from a terminal won't trigger or satisfy it)."
        ;;
    pair)
        exec node apps/server/src/bin.ts pair "$@"
        ;;
    *)
        usage
        ;;
esac
