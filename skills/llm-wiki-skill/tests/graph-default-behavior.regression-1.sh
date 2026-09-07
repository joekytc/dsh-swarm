#!/bin/bash
# Regression: graph-owned surfaces should own browser-conflicting defaults.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

tmp_dir="$(mktemp -d)"
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
    || fail "graph-engine build should succeed before graph default behavior browser regression"
build_graph_html_fixture "$tmp_dir"

playwright_node_path="$(
    npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

chrome_executable="${GRAPH_DEFAULT_BEHAVIOR_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

GRAPH_DEFAULT_BEHAVIOR_HTML="$tmp_dir/wiki/knowledge-graph.html" \
GRAPH_DEFAULT_BEHAVIOR_CHROME_EXECUTABLE="$chrome_executable" \
NODE_PATH="$playwright_node_path" \
node "$REPO_ROOT/tests/browser/graph-default-behavior.mjs" \
    || fail "graph default behavior browser regression should pass"

echo "PASS: graph default behavior regression"
