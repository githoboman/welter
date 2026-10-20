#!/usr/bin/env bash
set -euo pipefail
args=()
skip=0
for arg in "$@"; do
  if [[ "$skip" == 1 ]]; then skip=0; continue; fi
  if [[ "$arg" == "--allow-paths" ]]; then skip=1; continue; fi
  args+=("$arg")
done
"$(dirname "$0")/../node_modules/.bin/solcjs" "${args[@]}" | sed '/^>>> /d'
