#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    echo "Usage: alex.sh <dev|connect|sync|dist|pair> [args...]" >&2
    echo "  dev      Run pnpm dev with T3CODE_HOST=0.0.0.0 (LAN-reachable)" >&2
    echo "  connect  Run \`t3 connect\` from source (extra args forwarded, e.g. \`connect status\`)" >&2
    echo "  sync     Rebase main onto origin/main and push --force-with-lease to fork" >&2
    echo "  dist     Build a local arm64 .dmg from source" >&2
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
        git checkout main
        git fetch origin main
        git rebase origin/main
        git push --force-with-lease fork main
        ;;
    dist)
        export PNPM_CONFIG_MINIMUM_RELEASE_AGE=0
        export T3CODE_DESKTOP_PERSONAL_BUILD=1
        pnpm build:desktop
        exec pnpm dist:desktop:dmg:arm64
        ;;
    pair)
        exec node apps/server/src/bin.ts pair "$@"
        ;;
    *)
        usage
        ;;
esac
