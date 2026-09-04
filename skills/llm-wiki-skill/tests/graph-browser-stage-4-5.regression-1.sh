#!/bin/bash
# Regression: stage 4.5 graph browser interactions

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

target="offline"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      target="${2:-}"
      shift 2
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [ "$target" != "offline" ] && [ "$target" != "workbench" ]; then
  fail "stage 4.5 browser regression target '$target' is not implemented yet"
fi

tmp_dir="$(mktemp -d)"
server_pid=""
web_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
  if [ -n "$web_pid" ]; then kill "$web_pid" 2>/dev/null || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
  || fail "graph-engine build should succeed before stage 4.5 browser regression"
build_graph_html_fixture "$tmp_dir"
node - "$tmp_dir/wiki/graph-data.json" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
for (const node of data.nodes) {
  if (node.id === "A") {
    node.date = "2026-01-02";
    node.source_title = "不应作为实体来源链接";
  }
}
data.nodes.push({
  id: "S",
  label: "节点来源S",
  type: "source",
  community: "t2",
  content: "# 来源S\n\n这是来源S的内容。\n",
  source_path: "/fake/wiki/sources/S.md",
  date: "2026-01-03",
  source_title: "原始文章S"
});
data.edges.push({ id: "e3", from: "A", to: "S", type: "EXTRACTED" });
data.meta.total_nodes = data.nodes.length;
data.meta.total_edges = data.edges.length;
data.meta.initial_view = Array.from(new Set([...(data.meta.initial_view || []), "S"]));
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
NODE
bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir" > /dev/null 2>&1 \
  || fail "build-graph-html.sh should succeed after augmenting stage 4.5 browser fixture"

dense_dir="$tmp_dir/dense/wiki"
mkdir -p "$dense_dir"
cp "$REPO_ROOT/tests/fixtures/graph-interactive-dense/wiki/graph-data.json" "$dense_dir/graph-data.json"
bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir/dense" > /dev/null 2>&1 \
  || fail "build-graph-html.sh should succeed on dense stage 4.5 browser fixture"

artifact_dir="$tmp_dir/stage-4.5-artifacts"
mkdir -p "$artifact_dir"

if [ "$target" = "workbench" ]; then
  if lsof -i TCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port 8787 is already in use"
  fi
  if lsof -i TCP:5180 -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port 5180 is already in use"
  fi

  workbench_kb="$tmp_dir/workbench-kb"
  mkdir -p "$workbench_kb/wiki/entities" "$tmp_dir/home/.llm-wiki-agent"
  cp "$REPO_ROOT/tests/fixtures/graph-interactive-basic/wiki/graph-data.json" "$workbench_kb/wiki/graph-data.json"
  cat > "$workbench_kb/.wiki-schema.md" <<'EOF'
# Test schema
EOF
  cat > "$workbench_kb/purpose.md" <<'EOF'
# Stage 4.5 Workbench Test
EOF
  cat > "$workbench_kb/wiki/entities/A.md" <<'EOF'
# 节点A

这是节点A的正文。参见 [[wiki/entities/B.md]]。
EOF
  cat > "$workbench_kb/wiki/entities/B.md" <<'EOF'
# 节点B

这是节点B的正文。
EOF
  cat > "$workbench_kb/wiki/entities/C.md" <<'EOF'
# 节点C

这是节点C的正文。
EOF
  node - "$workbench_kb/wiki/graph-data.json" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
for (const node of data.nodes) {
  node.source_path = `wiki/entities/${node.id}.md`;
}
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
NODE
  cat > "$tmp_dir/home/.llm-wiki-agent/config.json" <<JSON
{
  "version": 1,
  "externalKnowledgeBases": ["$workbench_kb"]
}
JSON

  HOME="$tmp_dir/home" PORT=8787 npm run dev -w @llm-wiki-agent/server > "$tmp_dir/server.log" 2>&1 &
  server_pid="$!"
  npm run dev -w @llm-wiki-agent/web -- --host 127.0.0.1 > "$tmp_dir/web.log" 2>&1 &
  web_pid="$!"

  for _ in $(seq 1 80); do
    if curl -fsS "http://127.0.0.1:8787/api/knowledge-bases" >/dev/null 2>&1 \
      && curl -fsS "http://127.0.0.1:5180" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  curl -fsS "http://127.0.0.1:8787/api/knowledge-bases" >/dev/null 2>&1 \
    || fail "workbench server did not start; see $tmp_dir/server.log"
  curl -fsS "http://127.0.0.1:5180" >/dev/null 2>&1 \
    || fail "workbench web did not start; see $tmp_dir/web.log"
fi

export GRAPH_STAGE_4_5_TARGET="$target"
export GRAPH_STAGE_4_5_OFFLINE_HTML="$tmp_dir/wiki/knowledge-graph.html"
export GRAPH_STAGE_4_5_DENSE_HTML="$dense_dir/knowledge-graph.html"
export GRAPH_STAGE_4_5_ARTIFACT_DIR="$artifact_dir"
export GRAPH_STAGE_4_5_WORKBENCH_URL="http://127.0.0.1:5180"

chrome_executable="${GRAPH_STAGE_4_5_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi
export GRAPH_STAGE_4_5_CHROME_EXECUTABLE="$chrome_executable"

cd "$REPO_ROOT"
playwright_node_path="$(
  npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"
NODE_PATH="$playwright_node_path" node tests/browser/graph-stage-4-5.mjs

echo "PASS: stage 4.5 browser regression ($target)"
