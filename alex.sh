#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    echo "Usage: alex.sh <dev|connect> [args...]" >&2
    echo "  dev      Run pnpm dev with T3CODE_HOST=0.0.0.0 (LAN-reachable)" >&2
    echo "  connect  Run \`t3 connect\` from source (extra args forwarded, e.g. \`connect status\`)" >&2
    exit 1
}

[[ $# -ge 1 ]] || usage
cmd="$1"
shift

cd "$REPO_ROOT"

case "$cmd" in
    dev)
        exec env T3CODE_HOST=0.0.0.0 pnpm dev "$@"
        ;;
    connect)
        exec node apps/server/src/bin.ts connect "$@"
        ;;
    *)
        usage
        ;;
esac
