#!/bin/bash
# Regression: engine graph HTML should keep density contracts for larger graphs

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

write_density_fixture() {
    local output="$1"
    local count="$2"

    node - <<'NODE' "$output" "$count"
const fs = require("fs");
const output = process.argv[2];
const count = Number(process.argv[3]);
const nodes = Array.from({ length: count }, (_, index) => {
  const type = index % 8 === 0 ? "source" : index % 3 === 0 ? "topic" : "entity";
  const community = String(index % 6);
  return {
    id: `node-${index}`,
    label: `Density Node ${index}`,
    type,
    community,
    confidence: "EXTRACTED",
    content: `# Density Node ${index}\n\n这是第 ${index} 个密度测试节点，用来验证大量节点时不会全部铺成大卡片。\n\n关联到 [[node-${Math.max(0, index - 1)}|前一个节点]]。`
  };
});
const edges = [];
for (let index = 1; index < count; index++) {
  edges.push({
    id: `edge-${index}`,
    from: `node-${index - 1}`,
    to: `node-${index}`,
    type: index % 5 === 0 ? "INFERRED" : "EXTRACTED",
    weight: index % 5 === 0 ? 0.6 : 0.9
  });
}
const communities = Array.from({ length: 6 }, (_, index) => ({
  id: String(index),
  label: `社区 ${index}`,
  node_count: nodes.filter((node) => node.community === String(index)).length,
  source_count: 1,
  is_primary: index === 0,
  recommended_start_node_id: `node-${index}`
}));
const graph = {
  meta: {
    wiki_title: "密度测试知识库",
    build_date: "2026-04-27",
    total_nodes: nodes.length,
    total_edges: edges.length
  },
  nodes,
  edges,
  learning: {
    entry: { recommended_start_node_id: "node-0" },
    views: {
      path: { enabled: true, degraded: false, node_ids: ["node-0", "node-1", "node-2"] },
      community: { enabled: true, degraded: false, node_ids: nodes.filter((node) => node.community === "0").map((node) => node.id) },
      global: { enabled: true, degraded: false, node_ids: nodes.map((node) => node.id) }
    },
    communities
  },
  insights: {
    surprising_connections: [],
    isolated_nodes: [],
    bridge_nodes: [],
    sparse_communities: [],
    meta: { degraded: false }
  }
};
fs.writeFileSync(output, JSON.stringify(graph, null, 2));
NODE
}

test_graph_engine_exports_density_rules() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "e.getAtlasDensityMode="
    assert_file_contains "$html" "screenEffectiveDensityMode"
    assert_file_contains "$html" "nodeDisplayModeForDensity"
    assert_file_contains "$html" "e.resolveAtlasVisibleSnapshot="
    assert_file_contains "$html" "e.edgeStrokeWidth="
    assert_file_contains "$html" "e.cardDims="
    assert_file_contains "$html" ".node.is-overview"
    assert_file_contains "$html" ".node[data-visual-role=\"map-pin\"]"
    assert_file_contains "$html" "dataset.densityMode"
    assert_file_contains "$html" "dataset.effectiveDensity"

    rm -rf "$tmp_dir"
}

test_graph_html_builds_large_density_fixture_as_single_file() {
    local tmp_dir output_dir html
    tmp_dir="$(mktemp -d)"
    output_dir="$tmp_dir/wiki"
    mkdir -p "$output_dir"

    write_density_fixture "$output_dir/graph-data.json" 200
    ensure_graph_engine_dist
    bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on 200-node density fixture"

    html="$output_dir/knowledge-graph.html"
    assert_single_file_engine_output "$output_dir"
    assert_file_contains "$html" "密度测试知识库"
    assert_file_contains "$html" "Density Node 199"
    assert_file_contains "$html" "200 节点"
    assert_file_contains "$html" "199 关联"

    rm -rf "$tmp_dir"
}

test_graph_html_density_preview_for_compact_and_point_nodes() {
    local tmp_dir output_dir html playwright_node_path
    tmp_dir="$(mktemp -d)"
    output_dir="$tmp_dir/wiki"
    mkdir -p "$output_dir"

    write_density_fixture "$output_dir/graph-data.json" 240
    ensure_graph_engine_dist
    bash "$REPO_ROOT/scripts/build-graph-html.sh" "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on density preview fixture"
    html="$output_dir/knowledge-graph.html"

    playwright_node_path="$(
        npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
    )"
    GRAPH_DENSITY_PREVIEW_HTML="$html" NODE_PATH="$playwright_node_path" node "$REPO_ROOT/tests/browser/graph-density-preview.mjs" \
        || fail "density preview browser regression should pass"

    rm -rf "$tmp_dir"
}

test_graph_density_thresholds_and_budgets() {
    ensure_graph_engine_dist
    node --input-type=module - <<'NODE' "$REPO_ROOT" || fail "density thresholds and budgets should hold"
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = process.argv[2];
const engine = await import(pathToFileURL(path.join(repoRoot, "packages/graph-engine/dist/engine.esm.js")).href);
const {
  buildAtlasModel,
  deriveAtlasLayout,
  resolveAtlasVisibleSnapshot,
  nodeDisplayModeForDensity,
  screenEffectiveDensityMode
} = engine;

function makeGraph(count, edgeCount) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    label: `Density Node ${index}`,
    type: index % 8 === 0 ? "source" : index % 3 === 0 ? "topic" : "entity",
    community: String(index % 6),
    confidence: "EXTRACTED",
    content: `# Density Node ${index}\n\n节点 ${index}。`
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    id: `edge-${index}`,
    from: `node-${index % count}`,
    to: `node-${(index * 7 + 1) % count}`,
    type: index % 5 === 0 ? "INFERRED" : "EXTRACTED",
    weight: index % 9 === 0 ? 0.4 : 0.9
  })).filter((edge) => edge.from !== edge.to);
  return {
    meta: { wiki_title: "密度预算测试" },
    nodes,
    edges,
    learning: { entry: { recommended_start_node_id: "node-0" } }
  };
}

function snapshotFor(count, edgeCount, selectedNodeId) {
  const model = buildAtlasModel(makeGraph(count, edgeCount));
  const layout = deriveAtlasLayout(model);
  return resolveAtlasVisibleSnapshot(model, layout, {
    activeCommunityId: "all",
    focusMode: "all",
    query: "",
    selectedNodeId,
    filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true, UNVERIFIED: true }
  });
}

const pointSnapshot = snapshotFor(201, 900, "node-200");
assert.equal(pointSnapshot.densityMode, "point-plus-focus");
assert.ok(Object.keys(pointSnapshot.labelNodeIds).length <= 61);
assert.ok(pointSnapshot.labelNodeIds["node-200"]);
assert.ok(pointSnapshot.importantNodeIds["node-0"]);
assert.ok(pointSnapshot.edges.length <= 800);

const overviewSnapshot = snapshotFor(501, 1500, "node-500");
assert.equal(overviewSnapshot.densityMode, "overview");
assert.ok(Object.keys(overviewSnapshot.labelNodeIds).length <= 41);
assert.ok(overviewSnapshot.labelNodeIds["node-500"]);
assert.ok(overviewSnapshot.importantNodeIds["node-0"]);
assert.ok(overviewSnapshot.edges.length <= 1000);

assert.equal(screenEffectiveDensityMode(120, 1), "compact-card");
assert.equal(screenEffectiveDensityMode(120, 2), "card");
assert.equal(screenEffectiveDensityMode(120, 0.5), "point-plus-focus");
assert.equal(nodeDisplayModeForDensity({ selected: false, labelVisible: false, visualRole: "map-pin" }, "card"), "card");
assert.equal(nodeDisplayModeForDensity({ selected: false, labelVisible: false, visualRole: "map-pin" }, "compact-card"), "compact-card");
assert.equal(nodeDisplayModeForDensity({ selected: false, labelVisible: false, visualRole: "map-pin" }, "point-plus-focus"), "point");
assert.equal(nodeDisplayModeForDensity({ selected: true, labelVisible: false, visualRole: "map-pin" }, "overview"), "card");
NODE
}

main() {
    npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
        || fail "graph-engine build should succeed before density regression"
    test_graph_engine_exports_density_rules
    test_graph_html_builds_large_density_fixture_as_single_file
    test_graph_html_density_preview_for_compact_and_point_nodes
    test_graph_density_thresholds_and_budgets
    [ -f "$REPO_ROOT/tests/fixtures/graph-interactive-dense/wiki/graph-data.json" ] || fail "dense fixture should exist"
    echo "PASS: graph HTML density regression coverage"
}

main "$@"
