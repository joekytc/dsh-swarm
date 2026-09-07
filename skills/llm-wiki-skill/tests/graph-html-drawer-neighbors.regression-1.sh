#!/bin/bash
# Regression: offline host without onOpenPage should expose the built-in reader

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_builtin_reader_region() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" ".graph-reader {"
    assert_file_contains "$html" ".graph-reader[data-state=\"open\"]"
    assert_file_contains "$html" ".graph-reader-body"
    assert_file_contains "$html" "graph-reader-markdown"
    assert_file_contains "$html" "选择一个节点查看内容"

    rm -rf "$tmp_dir"
}

test_graph_html_reader_uses_marked_and_purify() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "marked.parse"
    assert_file_contains "$html" "DOMPurify.sanitize"
    assert_file_contains "$html" "graph-reader-markdown"
    grep -Eq '[[:alnum:]_$]+\.content\|\|[[:alnum:]_$]+\.summary\|\|[[:alnum:]_$]+\.label' "$html" \
        || fail "Expected $html to contain the reader content/summary/label fallback chain"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_builtin_reader_region
    test_graph_html_reader_uses_marked_and_purify
    echo "PASS: graph HTML built-in reader regression coverage"
}

main "$@"
