#!/bin/bash
# Regression: engine graph controls should stay readable and bounded

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_readable_shell_controls() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" ".offline-badges"
    assert_file_contains "$html" "offline-toolbar-host"
    assert_file_contains "$html" "min-height: 26px;"
    assert_file_contains "$html" "#graph-root"
    assert_file_contains "$html" "data-testid=\"offline-graph-root\""
    assert_file_contains "$html" "data-testid=\"offline-toolbar-host\""
    assert_file_contains "$html" "var toolbarHost = document.querySelector(\"[data-testid='offline-toolbar-host']\");"
    assert_file_contains "$html" "toolbarContainer: toolbarHost"
    assert_file_contains "$html" ".graph-toolbar"
    assert_file_contains "$html" ".graph-toolbar-panel"
    assert_file_contains "$html" "llm-wiki:graph:toolbar:panel"
    assert_file_contains "$html" "筛选"
    assert_file_contains "$html" "类型筛选"
    assert_file_contains "$html" "graph-type-filter"
    assert_file_contains "$html" "实体"
    assert_file_contains "$html" "主题"
    assert_file_contains "$html" "来源"
    assert_file_contains "$html" "图例"
    assert_file_contains "$html" "回全图"
    assert_file_contains "$html" "window.__LLM_WIKI_GRAPH_ENGINE__"

    rm -rf "$tmp_dir"
}

test_graph_html_has_drag_and_pin_runtime_hooks() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "pointerdown"
    assert_file_contains "$html" "pointermove"
    assert_file_contains "$html" "pointerup"
    assert_file_contains "$html" "persistPins"
    assert_file_contains "$html" "localStorage.setItem"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_readable_shell_controls
    test_graph_html_has_drag_and_pin_runtime_hooks
    echo "PASS: graph HTML toolbar/runtime regression coverage"
}

main "$@"
