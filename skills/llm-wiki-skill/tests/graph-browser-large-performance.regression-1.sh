#!/bin/bash
# Regression: generated large graph browser performance measurement

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

artifact_dir="${GRAPH_LARGE_PERF_ARTIFACT_DIR:-}"
if [ -z "$artifact_dir" ]; then
  artifact_dir="$(mktemp -d)"
fi
mkdir -p "$artifact_dir"

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1

playwright_node_path="$(
  npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

chrome_executable="${GRAPH_LARGE_PERF_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ]; then
  candidate="$(
    NODE_PATH="$playwright_node_path" node -e 'const { chromium } = require("playwright"); console.log(chromium.executablePath())'
  )"
  if [ -x "$candidate" ]; then
    chrome_executable="$candidate"
  elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  fi
fi

cd "$REPO_ROOT"
NODE_PATH="$playwright_node_path" \
GRAPH_LARGE_PERF_ARTIFACT_DIR="$artifact_dir" \
GRAPH_LARGE_PERF_CHROME_EXECUTABLE="$chrome_executable" \
node --import tsx tests/browser/graph-large-performance.ts

test -f "$artifact_dir/large-graph-performance-results.json"
echo "PASS: large graph performance measurement ($artifact_dir/large-graph-performance-results.json)"
