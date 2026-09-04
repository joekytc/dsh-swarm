#!/bin/bash
# Regression: generated graph HTML must keep the approved engine atlas shell

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_oriental_atlas_has_approved_engine_shell() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" 'class="offline-shell"'
    assert_file_contains "$html" 'class="offline-header"'
    assert_file_contains "$html" 'class="offline-badges"'
    assert_file_contains "$html" 'id="graph-root"'
    assert_file_contains "$html" "llm-wiki-graph-engine"
    assert_file_contains "$html" "community-wash-layer"
    assert_file_contains "$html" "edge-layer"
    assert_file_contains "$html" "node-layer"
    assert_file_contains "$html" ".mini-map"
    assert_file_contains "$html" ".graph-reader"

    rm -rf "$tmp_dir"
}

test_oriental_atlas_rejects_old_template_shell() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_not_contains "$html" 'id="nav-panel"'
    assert_file_not_contains "$html" 'id="mode-switch"'
    assert_file_not_contains "$html" 'id="nav-close"'
    assert_file_not_contains "$html" 'id="secondary-panel"'
    assert_file_not_contains "$html" 'id="dr-close"'
    assert_file_not_contains "$html" 'class="drawer" id="drawer"'
    assert_file_not_contains "$html" 'id="node-layer"'
    assert_file_not_contains "$html" 'id="edge-layer"'
    assert_file_not_contains "$html" "学习驾驶舱"
    assert_file_not_contains "$html" "GitHub"

    rm -rf "$tmp_dir"
}

test_oriental_atlas_has_required_copy() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "HTML测试知识库 知识舆图"
    assert_file_contains "$html" "国风知识库·数字山水图"
    assert_file_contains "$html" "3 节点"
    assert_file_contains "$html" "2 关联"
    assert_file_contains "$html" 'data-llm-wiki-offline-graph="engine"'
    assert_file_contains "$html" "选择一个节点查看内容"

    rm -rf "$tmp_dir"
}

test_oriental_atlas_runtime_uses_shared_engine_state() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "window.LlmWikiGraphEngine.createGraphEngine"
    assert_file_contains "$html" "window.__LLM_WIKI_GRAPH_ENGINE__"
    assert_file_contains "$html" "window.__LLM_WIKI_GRAPH_PINS_KEY__"
    assert_file_contains "$html" "persistPins: function"
    assert_file_contains "$html" "localStorage.setItem"
    assert_file_not_contains "$html" "graph-wash.js"
    assert_file_not_contains "$html" "graph-wash-helpers.js"

    rm -rf "$tmp_dir"
}

main() {
    test_oriental_atlas_has_approved_engine_shell
    test_oriental_atlas_rejects_old_template_shell
    test_oriental_atlas_has_required_copy
    test_oriental_atlas_runtime_uses_shared_engine_state
    echo "PASS: oriental atlas HTML contract regression coverage"
}

main "$@"
