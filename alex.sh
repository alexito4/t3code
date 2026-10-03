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
    fix/codex-usage-archived-sessions
    feat/projects-list-page
    feat/pull-request-review-checklist
    patch/review-diff-staged-unstaged
    patch/review-diff-committed-mode
    patch/review-diff-file-actions
    feat/thread-share
    feat/scratchpad-panel
    feat/conversation-font-size
)

# What `rebuild` merges into a patch branch. Stacked branches merge their
# parent (listed above them, so already refreshed by then) instead of
# upstream/main: the parent's fixes flow up, and upstream comes along with it.
patch_base() {
    case "$1" in
        patch/review-diff-committed-mode | patch/review-diff-file-actions)
            echo patch/review-diff-staged-unstaged
            ;;
        *) echo upstream/main ;;
    esac
}

usage() {
    echo "Usage: alex.sh <dev|connect|sync|sync-nightly|rebuild|dist|pair> [args...]" >&2
    echo "  dev      Run pnpm dev with T3CODE_HOST=0.0.0.0 (LAN-reachable)" >&2
    echo "  connect  Run \`t3 connect\` from source (extra args forwarded, e.g. \`connect status\`)" >&2
    echo "  sync     Merge upstream/main into main and fast-forward-push to origin (the routine path)" >&2
    echo "  sync-nightly  Same, but merge the newest upstream nightly release; no-op if main has it" >&2
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
    sync-nightly)
        # Like sync, but merges the commit of the newest nightly release (what
        # the official Nightly app ships, a few times a day) instead of
        # upstream/main's tip. Exits without touching anything when main
        # already has it, so it's safe to run on a schedule.
        #
        # Tags are read over anonymous HTTPS, not gh or the SSH remote: both go
        # through the login keychain, and unattended gh hangs on it instead of
        # failing. Only the final push needs credentials.
        upstream_url="https://github.com/pingdotgg/t3code.git"
        nightly_tags="$(GIT_TERMINAL_PROMPT=0 git -c credential.helper= ls-remote --tags \
            --refs --sort=-v:refname "$upstream_url" 'v*-nightly.*')"
        tag="${nightly_tags%%$'\n'*}"
        tag="${tag##*refs/tags/}"
        [[ -n "$tag" ]] || {
            echo "No nightly release found" >&2
            exit 1
        }
        GIT_TERMINAL_PROMPT=0 git -c credential.helper= fetch "$upstream_url" \
            "refs/tags/$tag:refs/tags/$tag"
        if git merge-base --is-ancestor "$tag^{commit}" main; then
            echo "main already has $tag"
            exit 0
        fi
        git checkout main
        git merge --no-edit -m "Merge nightly $tag" "$tag^{commit}"
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

        # Bash reads PATCH_BRANCHES once, from whatever alex.sh happened to be
        # on disk when this process started. If you just edited the array on
        # patch/fork-infra but invoked `rebuild` from a checkout that hasn't
        # picked that commit up yet (e.g. still on `main` from before), the
        # loops below would silently use the stale list — once dropped a
        # branch from a real rebuild. Reload from patch/fork-infra's own
        # committed copy so the array is always current, regardless of what's
        # actually checked out here.
        #
        # `mapfile`/`readarray` need bash 4+; macOS ships bash 3.2 at
        # /bin/bash (Apple froze it pre-GPLv3), so this reads the old way.
        PATCH_BRANCHES=()
        while IFS= read -r branch; do
            PATCH_BRANCHES+=("$branch")
        done < <(git show patch/fork-infra:alex.sh |
            awk '/^PATCH_BRANCHES=\(/{f=1;next} /^\)/{f=0} f{print $1}')

        for branch in "${PATCH_BRANCHES[@]}"; do
            base="$(patch_base "$branch")"
            echo "==> Merging $base into $branch"
            git checkout "$branch"
            git merge "$base"
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
        # The current upstream lockfile can contain dependencies within pnpm's
        # release-age window. Bypass it only for this local personal build,
        # then restore the user's normal policy even if the build fails.
        minimum_release_age="$(pnpm config get minimumReleaseAge)"
        build_dir="$(mktemp -d)"
        cleanup_dist() {
            pnpm config set minimumReleaseAge "$minimum_release_age" --location user
            rm -rf "$build_dir"
        }
        trap cleanup_dist EXIT
        pnpm config set minimumReleaseAge 0 --location user

        # A sync can change dependencies (V2 added several); build against
        # exactly what the lockfile says. A toolchain bump can make pnpm want
        # to recreate node_modules, which it refuses to do without a TTY.
        pnpm install --config.confirm-modules-purge=false

        export T3CODE_DESKTOP_PERSONAL_BUILD=1
        pnpm build:desktop
        T3CODE_DESKTOP_OUTPUT_DIR="$build_dir" pnpm dist:desktop:dmg:arm64

        # electron-builder skips codesigning entirely for unsigned local
        # builds, leaving Electron's stock ad-hoc signature (with no
        # entitlements) on the binary. Without allow-jit /
        # allow-unsigned-executable-memory, V8 can't allocate JIT memory and
        # the app silently exits within its first second. Re-sign ad-hoc with
        # the entitlements the official notarized build gets for free, using
        # the zip artifact (a plain .app) rather than the dmg.
        zip_path="$(ls -t "$build_dir"/*-arm64.zip | head -1)"
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
        echo "Packaging artifacts were kept temporary and removed."
        echo "First launch needs one Finder double-click to clear Gatekeeper's unsigned-app approval (open/exec from a terminal won't trigger or satisfy it)."
        ;;
    pair)
        exec node apps/server/src/bin.ts pair "$@"
        ;;
    *)
        usage
        ;;
esac
