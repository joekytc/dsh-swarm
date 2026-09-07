#!/bin/bash
# Regression: engine-powered graph HTML must build locally and stay offline-friendly

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_engine_output_exists() {
    local tmp_dir output_dir
    tmp_dir="$(mktemp -d)"
    output_dir="$tmp_dir/wiki"

    build_graph_html_fixture "$tmp_dir"
    assert_single_file_engine_output "$output_dir"

    rm -rf "$tmp_dir"
}

test_graph_html_embeds_engine_runtime_and_sanitizer() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "window.LlmWikiGraphEngine.createGraphEngine"
    assert_file_contains "$html" "DOMPurify.sanitize"
    assert_file_contains "$html" "marked.parse"
    assert_file_contains "$html" "graph-reader-markdown"
    assert_file_contains "$html" "llm-wiki-graph-engine"
    assert_file_not_contains "$html" "cdn.jsdelivr.net"
    assert_file_not_contains "$html" "fonts.googleapis.com"
    assert_file_not_contains "$html" "fonts.gstatic.com"
    assert_file_not_contains "$html" "sample-data.js"
    assert_file_not_contains "$html" "vis-network.min.js"

    rm -rf "$tmp_dir"
}

test_graph_html_oriental_visual_contract() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "国风知识库·数字山水图"
    assert_file_contains "$html" "知识舆图"
    assert_file_contains "$html" "var(--cinnabar)"
    assert_file_contains "$html" "community-wash"
    assert_file_contains "$html" "node-layer"
    assert_file_contains "$html" "edge-layer"
    assert_file_contains "$html" "mini-map"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_engine_output_exists
    test_graph_html_embeds_engine_runtime_and_sanitizer
    test_graph_html_oriental_visual_contract
    echo "PASS: graph HTML engine regression coverage"
}

main "$@"
