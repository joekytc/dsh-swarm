#!/bin/bash
# Regression: engine offline graph HTML must remain responsive

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$REPO_ROOT/tests/lib/graph-html-engine-helpers.sh"

test_graph_html_has_responsive_css() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" "@media (max-width: 720px)"
    assert_file_contains "$html" ".offline-header { align-items: flex-start; flex-direction: column; }"
    assert_file_contains "$html" ".offline-toolbar-host { width: 100%; flex-basis: auto; }"
    assert_file_contains "$html" "#graph-root { min-height: 520px; }"
    assert_file_contains "$html" "width: min(360px, calc(100% - 32px));"
    assert_file_contains "$html" "overflow-wrap: anywhere;"

    rm -rf "$tmp_dir"
}

test_graph_html_has_stable_mobile_shell_dimensions() {
    local tmp_dir html
    tmp_dir="$(mktemp -d)"

    build_graph_html_fixture "$tmp_dir"
    html="$tmp_dir/wiki/knowledge-graph.html"

    assert_file_contains "$html" ".offline-shell"
    assert_file_contains "$html" "grid-template-rows: auto minmax(0, 1fr);"
    assert_file_contains "$html" "#graph-root"
    assert_file_contains "$html" "height: 100%;"
    assert_file_contains "$html" "min-height: 560px;"

    rm -rf "$tmp_dir"
}

main() {
    test_graph_html_has_responsive_css
    test_graph_html_has_stable_mobile_shell_dimensions
    echo "PASS: graph HTML mobile regression coverage"
}

main "$@"
