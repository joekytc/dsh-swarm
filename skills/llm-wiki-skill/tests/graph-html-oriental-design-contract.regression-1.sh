#!/bin/bash
# Regression: oriental atlas design grammar hooks must survive engine HTML generation

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_oriental_design_contract_hooks() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "node-layer"
    assert_file_contains "$html" "edge-layer"
    assert_file_contains "$html" "community-wash"
    assert_file_contains "$html" ".node[data-visual-role=\"landmark\"]"
    assert_file_contains "$html" ".node[data-visual-role=\"index-slip\"],"
    assert_file_contains "$html" ".node[data-visual-role=\"cinnabar-note\"]"
    assert_file_contains "$html" "dataset.visualRole"
    assert_file_contains "$html" "dataset.startNode"
    assert_file_contains "$html" "dataset.previewStart"
    assert_file_contains "$html" "node-kind"
    assert_file_contains "$html" "node-name"
    assert_file_contains "$html" "node-meta"
    assert_file_contains "$html" "var(--cinnabar)"

    rm -rf "$tmp_dir"
}

test_first_open_selection_contract() {
    ensure_graph_engine_dist
    node --input-type=module - <<'NODE' "$REPO_ROOT" || fail "first-open selection contract should hold"
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = process.argv[2];
const {
  buildAtlasModel,
  deriveAtlasLayout,
  resolveAtlasVisibleSnapshot,
  resolveAtlasSelectedNodeId
} = await import(pathToFileURL(path.join(repoRoot, "packages/graph-engine/dist/engine.esm.js")).href);

const graph = {
  meta: { wiki_title: "首屏预览测试" },
  nodes: [
    { id: "start", label: "推荐起点", type: "topic", community: "main", confidence: "EXTRACTED", content: "# 推荐起点\n\n从这里开始。" },
    { id: "next", label: "相邻节点", type: "entity", community: "main", confidence: "EXTRACTED" }
  ],
  edges: [{ id: "edge", from: "start", to: "next", type: "EXTRACTED", weight: 0.9 }],
  learning: { entry: { recommended_start_node_id: "start" } }
};

const model = buildAtlasModel(graph);
const layout = deriveAtlasLayout(model);
const snapshot = resolveAtlasVisibleSnapshot(model, layout, {
  activeCommunityId: "all",
  focusMode: "all",
  query: "",
  selectedNodeId: null,
  filters: { EXTRACTED: true, INFERRED: true, AMBIGUOUS: true, UNVERIFIED: true }
});

assert.equal(snapshot.starts[0].node.id, "start");
assert.equal(snapshot.startNodeIds.start, true);
assert.equal(snapshot.importantNodeIds.start, true);
assert.equal(resolveAtlasSelectedNodeId(model, snapshot, null), null);
assert.equal(resolveAtlasSelectedNodeId(model, snapshot, "start"), "start");
NODE
}

main() {
    test_oriental_design_contract_hooks
    test_first_open_selection_contract
    echo "PASS: oriental design contract regression coverage"
}

main "$@"
