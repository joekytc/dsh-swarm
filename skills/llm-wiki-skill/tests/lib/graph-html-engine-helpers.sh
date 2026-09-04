#!/bin/bash

set -euo pipefail

GRAPH_HTML_BASIC="tests/fixtures/graph-interactive-basic"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_file_exists() {
    local file="$1"

    [ -f "$file" ] || fail "Expected file to exist: $file"
}

assert_file_not_exists() {
    local file="$1"

    [ ! -e "$file" ] || fail "Expected file to not exist: $file"
}

assert_file_contains() {
    local file="$1"
    local text="$2"

    if ! grep -F -- "$text" "$file" > /dev/null; then
        fail "Expected $file to contain: $text"
    fi
}

assert_file_not_contains() {
    local file="$1"
    local text="$2"

    if grep -F -- "$text" "$file" > /dev/null; then
        fail "Expected $file to not contain: $text"
    fi
}

ensure_graph_engine_dist() {
    if [ -f "$REPO_ROOT/packages/graph-engine/dist/engine.iife.js" ]; then
        return 0
    fi

    npm run build -w @llm-wiki/graph-engine > /dev/null 2>&1 \
        || fail "graph-engine build should succeed before offline HTML regression"
}

build_graph_html_fixture() {
    local tmp_dir="$1"
    local output_dir="$tmp_dir/wiki"

    ensure_graph_engine_dist
    mkdir -p "$output_dir"
    cp "$REPO_ROOT/$GRAPH_HTML_BASIC/wiki/graph-data.json" "$output_dir/graph-data.json"

    bash "$REPO_ROOT/scripts/build-graph-html.sh" \
        "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on basic fixture"
}

build_graph_html_fixture_with_layout() {
    local tmp_dir="$1"

    mkdir -p "$tmp_dir/wiki"
    cp "$REPO_ROOT/$GRAPH_HTML_BASIC/wiki/graph-data.json" "$tmp_dir/wiki/graph-data.json"
    cat > "$tmp_dir/.wiki-graph-layout.json" <<'JSON'
{
  "version": 1,
  "pins": {
    "/fake/wiki/entities/A.md": { "x": 240, "y": 180, "coordinateSpace": "world" }
  },
  "updatedAt": "2026-06-12T00:00:00.000Z"
}
JSON

    ensure_graph_engine_dist
    bash "$REPO_ROOT/scripts/build-graph-html.sh" \
        "$tmp_dir" > /dev/null 2>&1 \
        || fail "build-graph-html.sh should succeed on basic fixture with layout"
}

assert_single_file_engine_output() {
    local output_dir="$1"
    local html="$output_dir/knowledge-graph.html"

    assert_file_exists "$html"
    assert_file_not_exists "$output_dir/d3.min.js"
    assert_file_not_exists "$output_dir/rough.min.js"
    assert_file_not_exists "$output_dir/marked.min.js"
    assert_file_not_exists "$output_dir/purify.min.js"
    assert_file_not_exists "$output_dir/graph-wash.js"
    assert_file_not_exists "$output_dir/graph-wash-helpers.js"
    assert_file_not_exists "$output_dir/LICENSE-d3.txt"
    assert_file_not_exists "$output_dir/LICENSE-roughjs.txt"
    assert_file_not_exists "$output_dir/LICENSE-marked.txt"
    assert_file_not_exists "$output_dir/LICENSE-purify.txt"

    assert_file_contains "$html" '<script id="graph-data" type="application/json">'
    assert_file_contains "$html" '<script id="graph-layout" type="application/json">'
    assert_file_contains "$html" "var LlmWikiGraphEngine="
    assert_file_contains "$html" "window.LlmWikiGraphEngine.createGraphEngine"
    assert_file_contains "$html" "persistPins: function"
    assert_file_contains "$html" "window.__LLM_WIKI_GRAPH_PINS_KEY__"
    assert_file_not_contains "$html" 'src="graph-wash.js"'
    assert_file_not_contains "$html" 'src="d3.min.js"'
    assert_file_not_contains "$html" 'sourceMappingURL'
}
