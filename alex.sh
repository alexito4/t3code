#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Each branch is one independently-droppable concern, rebased onto fresh
# origin/main on its own, then composed into main in this order. Drop a
# feature by removing its line here — no rebase archaeology required. See
# ALEX.md for what each branch is and how to update the PR-derived ones.
PATCH_BRANCHES=(
    patch/alex-fork-tooling
    patch/ios-personal-team
    patch/fork-docs
    patch/pr8296-side-questions
)

usage() {
    echo "Usage: alex.sh <dev|connect|sync|dist|pair> [args...]" >&2
    echo "  dev      Run pnpm dev with T3CODE_HOST=0.0.0.0 (LAN-reachable)" >&2
    echo "  connect  Run \`t3 connect\` from source (extra args forwarded, e.g. \`connect status\`)" >&2
    echo "  sync     Rebase each patch branch onto origin/main, recompose main, push --force-with-lease to fork" >&2
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
        git fetch origin main

        for branch in "${PATCH_BRANCHES[@]}"; do
            echo "==> Rebasing $branch onto origin/main"
            git checkout "$branch"
            git rebase origin/main
        done

        echo "==> Recomposing main"
        git checkout -B main origin/main
        for branch in "${PATCH_BRANCHES[@]}"; do
            git merge --no-ff --no-edit "$branch"
        done

        git push --force-with-lease fork main
        for branch in "${PATCH_BRANCHES[@]}"; do
            git push --force-with-lease fork "$branch"
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
