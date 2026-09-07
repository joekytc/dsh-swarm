#!/bin/bash
# Regression: graph-data nodes must keep wiki-relative page paths for workbench reader and selection prompts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/build-graph-data.sh"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

test_synthesis_session_node_keeps_wiki_relative_path() {
    local tmp_dir source_path private_path
    tmp_dir="$(mktemp -d)"

    mkdir -p "$tmp_dir/wiki/synthesis/sessions"

    cat > "$tmp_dir/purpose.md" <<'EOF'
# Source Path Fixture
EOF

    cat > "$tmp_dir/wiki/synthesis/sessions/A.md" <<'EOF'
# A

消化结果正文。
EOF

    LLM_WIKI_TEST_MODE=1 \
        bash "$SCRIPT" "$tmp_dir" "$tmp_dir/wiki/graph-data.json" > /dev/null 2>&1 \
        || fail "build-graph-data.sh should succeed on synthesis session fixture"

    source_path="$(jq -r '.nodes[] | select(.id == "A") | .source_path // ""' "$tmp_dir/wiki/graph-data.json")"
    [ "$source_path" = "wiki/synthesis/sessions/A.md" ] \
        || fail "Expected source_path to be wiki/synthesis/sessions/A.md, got: $source_path"

    private_path="$(jq -r '.nodes[] | select(.id == "A") | ._file_path // ""' "$tmp_dir/wiki/graph-data.json")"
    [ -z "$private_path" ] || fail "Graph data should not expose helper-only _file_path, got: $private_path"

    rm -rf "$tmp_dir"
}

main() {
    test_synthesis_session_node_keeps_wiki_relative_path
    echo "PASS: graph data source path regression coverage"
}

main "$@"
