#!/bin/bash
# Regression: offline graph header should keep product identity without external links

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_product_branding() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "HTML测试知识库 知识舆图"
    assert_file_contains "$html" "国风知识库·数字山水图"
    assert_file_contains "$html" "aria-label=\"图谱统计\""
    assert_file_contains "$html" "3 节点"
    assert_file_contains "$html" "2 关联"

    rm -rf "$tmp_dir"
}

test_graph_html_has_focus_visible_style_without_external_brand_assets() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "offline-shell"
    assert_file_not_contains "$html" "brand__github"
    assert_file_not_contains "$html" "<span>GitHub</span>"
    assert_file_not_contains "$html" "fonts.googleapis.com"
    assert_file_not_contains "$html" "cdn.jsdelivr.net"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_product_branding
    test_graph_html_has_focus_visible_style_without_external_brand_assets
    echo "PASS: graph HTML brand regression coverage"
}

main "$@"
