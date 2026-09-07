#!/bin/bash
# Regression: workbench uses the shared graph interaction stack for zoom, drag, hover, drawer, minimap, and reset.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

tmp_dir="$(mktemp -d)"
server_pid=""
web_pid=""
server_port="${GRAPH_WORKBENCH_SERVER_PORT:-18787}"
web_port="${GRAPH_WORKBENCH_WEB_PORT:-15180}"

cleanup() {
    if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
    if [ -n "$web_pid" ]; then kill "$web_pid" 2>/dev/null || true; fi
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

if lsof -i TCP:"$server_port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $server_port is already in use"
fi
if lsof -i TCP:"$web_port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $web_port is already in use"
fi

npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
    || fail "graph-engine build should succeed before workbench browser regression"

workbench_kb="$tmp_dir/home/llm-wiki/phase-6-workbench"
mkdir -p "$workbench_kb/wiki/entities" "$tmp_dir/home/.llm-wiki-agent"
cp "$REPO_ROOT/tests/fixtures/graph-interactive-basic/wiki/graph-data.json" "$workbench_kb/wiki/graph-data.json"
cat > "$workbench_kb/.wiki-schema.md" <<'EOF'
# Test schema
EOF
cat > "$workbench_kb/purpose.md" <<'EOF'
# Phase 6 Workbench Test
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
const byId = new Map(data.nodes.map((node) => [node.id, node]));
const base = byId.get("A") || data.nodes[0];
for (const id of ["D", "E", "F", "G"]) {
  if (byId.has(id)) continue;
  data.nodes.push({
    ...base,
    id,
    label: `节点${id}`,
    type: "entity",
    community: "t1",
    source_path: `wiki/entities/${id}.md`,
    x: (base.x || 500) + (id.charCodeAt(0) - 67) * 24,
    y: (base.y || 300) + (id.charCodeAt(0) - 67) * 18
  });
}
const existingEdges = new Set(data.edges.map((edge) => edge.id));
for (const id of ["D", "E", "F", "G"]) {
  const edgeId = `A-${id}`;
  if (existingEdges.has(edgeId)) continue;
  data.edges.push({ id: edgeId, from: "A", to: id, type: "EXTRACTED", relation_type: "同社区", weight: 0.5 });
}
for (const node of data.nodes) {
  node.source_path = `wiki/entities/${node.id}.md`;
  node.content = `# ${node.label}\n\n这是${node.label}的内容。\n`;
  if (node.id === "C") node.type = "source";
}
const t1 = data.learning?.communities?.find((community) => community.id === "t1");
if (t1) {
  t1.members = data.nodes.filter((node) => node.community === "t1").map((node) => node.id);
  t1.node_count = t1.members.length;
}
if (data.meta) {
  data.meta.total_nodes = data.nodes.length;
  data.meta.total_edges = data.edges.length;
}
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
NODE
for id in D E F G; do
cat > "$workbench_kb/wiki/entities/$id.md" <<EOF
# 节点$id

这是节点$id 的正文。
EOF
done
cat > "$tmp_dir/home/.llm-wiki-agent/config.json" <<JSON
{
  "version": 1,
  "externalKnowledgeBases": [],
  "lastUsedKbPath": "$workbench_kb"
}
JSON

HOME="$tmp_dir/home" HOST=127.0.0.1 PORT="$server_port" npm run dev -w @llm-wiki-agent/server > "$tmp_dir/server.log" 2>&1 &
server_pid="$!"
HOME="$tmp_dir/home" LLM_WIKI_AGENT_API_ORIGIN="http://127.0.0.1:$server_port" npm run dev -w @llm-wiki-agent/web -- --host 127.0.0.1 --port "$web_port" --force > "$tmp_dir/web.log" 2>&1 &
web_pid="$!"

for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$server_port/api/knowledge-bases" >/dev/null 2>&1 \
        && curl -fsS "http://127.0.0.1:$web_port" >/dev/null 2>&1; then
        break
    fi
    sleep 0.25
done

curl -fsS "http://127.0.0.1:$server_port/api/knowledge-bases" >/dev/null 2>&1 \
    || fail "workbench server did not start; see $tmp_dir/server.log"
curl -fsS "http://127.0.0.1:$web_port" >/dev/null 2>&1 \
    || fail "workbench web did not start; see $tmp_dir/web.log"

artifact_dir="$tmp_dir/artifacts"
mkdir -p "$artifact_dir"

playwright_node_path="$(
    npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
)"

chrome_executable="${GRAPH_WORKBENCH_CHROME_EXECUTABLE:-}"
if [ -z "$chrome_executable" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    chrome_executable="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi

GRAPH_WORKBENCH_URL="http://127.0.0.1:$web_port" \
GRAPH_WORKBENCH_ARTIFACT_DIR="$artifact_dir" \
GRAPH_WORKBENCH_CHROME_EXECUTABLE="$chrome_executable" \
NODE_PATH="$playwright_node_path" \
node "$REPO_ROOT/tests/browser/graph-workbench-interactions.mjs" \
    || fail "workbench graph interaction browser regression should pass"

echo "Artifacts: $artifact_dir"
echo "PASS: graph workbench interaction regression"
