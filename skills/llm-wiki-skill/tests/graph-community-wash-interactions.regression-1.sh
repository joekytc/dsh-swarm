#!/bin/bash
# Regression: community wash is a visual/click target, not a wheel or node-drag fence.

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
    || fail "graph-engine build should succeed before community wash browser regression"
build_graph_html_fixture "$tmp_dir"

playwright_node_path="$(
    npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

chrome_executable="${GRAPH_COMMUNITY_WASH_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

GRAPH_COMMUNITY_WASH_HTML="$tmp_dir/wiki/knowledge-graph.html" \
GRAPH_COMMUNITY_WASH_CHROME_EXECUTABLE="$chrome_executable" \
NODE_PATH="$playwright_node_path" \
node "$REPO_ROOT/tests/browser/graph-community-wash-interactions.mjs" \
    || fail "community wash browser regression should pass"

echo "PASS: graph community wash interaction regression"
