#!/bin/bash
# Regression: engine atlas should keep weighted relationship cues

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_weighted_edge_hooks() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "edgeStrokeWidth"
    assert_file_contains "$html" "edgeOpacity"
    assert_file_contains "$html" "edgeVisualStrokeWidth"
    assert_file_contains "$html" "edgeVisualOpacity"
    assert_file_contains "$html" "edgeRelationClass"
    assert_file_contains "$html" "strokeWidth"
    assert_file_contains "$html" "opacity"
    assert_file_contains "$html" "data-relation-type"
    assert_file_contains "$html" "data-confidence"
    assert_file_contains "$html" "confidence-inferred"
    assert_file_contains "$html" "confidence-ambiguous"
    assert_file_contains "$html" "relation-contrast"
    assert_file_contains "$html" "relation-conflict"
    assert_file_contains "$html" "#d94693"
    assert_file_contains "$html" "atlasConfidenceLabel"

    rm -rf "$tmp_dir"
}

test_graph_html_has_structural_selection_actions_without_offline_ask_ui() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "why_no_connection"
    assert_file_contains "$html" "find_potential_bridges"
    assert_file_contains "$html" "resolveSelectionForCapabilities"
    assert_file_contains "$html" "graph-selection-panel"
    assert_file_contains "$html" "graph-selection-facts"
    assert_file_contains "$html" "Shift+点击 增删节点"
    assert_file_not_contains "$html" "提问选区"
    assert_file_not_contains "$html" "onAsk:"

    rm -rf "$tmp_dir"
}

test_graph_html_offline_selection_panel_behaves_in_browser() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    local playwright_node_path
    playwright_node_path="$(
        npx --yes -p playwright -c 'node -e "const path=require(\"path\"); console.log(path.dirname(process.env.PATH.split(\":\")[0]))"'
    )"
    GRAPH_HTML_INSIGHTS_HTML="$html" NODE_PATH="$playwright_node_path" node "$REPO_ROOT/tests/browser/graph-html-insights.mjs" \
        || fail "offline graph selection browser regression should pass"

    rm -rf "$tmp_dir"
}

main() {
    npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
        || fail "graph-engine build should succeed before insights regression"
    test_graph_html_has_weighted_edge_hooks
    test_graph_html_has_structural_selection_actions_without_offline_ask_ui
    test_graph_html_offline_selection_panel_behaves_in_browser
    echo "PASS: graph HTML insights regression coverage"
}

main "$@"
