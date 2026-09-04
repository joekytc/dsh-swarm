#!/bin/bash
# Regression: graph analysis helper should compute weights, source omission, and insights deterministically

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELPER="$REPO_ROOT/scripts/graph-analysis.js"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_text_contains() {
    local text="$1"
    local expected="$2"

    if ! printf '%s' "$text" | grep -F -- "$expected" > /dev/null; then
        fail "Expected output to contain: $expected"
    fi
}

test_helper_computes_weights_and_source_omission() {
    local tmp_dir output
    tmp_dir="$(mktemp -d)"

    mkdir -p "$tmp_dir/wiki/entities"

    cat > "$tmp_dir/wiki/entities/A.md" <<'EOF'
---
sources: ["same.pdf"]
---

# A

[[B]]
EOF

    cat > "$tmp_dir/wiki/entities/B.md" <<'EOF'
---
sources: ["same.pdf"]
---

# B

[[A]]
EOF

    cat > "$tmp_dir/wiki/entities/C.md" <<'EOF'
# C

[[A]]
EOF

    cat > "$tmp_dir/nodes.json" <<EOF
[
  {"id":"A","label":"A","type":"entity","source_path":"$tmp_dir/wiki/entities/A.md"},
  {"id":"B","label":"B","type":"entity","source_path":"$tmp_dir/wiki/entities/B.md"},
  {"id":"C","label":"C","type":"entity","source_path":"$tmp_dir/wiki/entities/C.md"}
]
EOF

    cat > "$tmp_dir/edges.json" <<'EOF'
[
  {"id":"e1","from":"A","to":"B","type":"EXTRACTED"},
  {"id":"e2","from":"B","to":"A","type":"EXTRACTED"},
  {"id":"e3","from":"C","to":"A","type":"EXTRACTED"}
]
EOF

    node "$HELPER" "$tmp_dir/nodes.json" "$tmp_dir/edges.json" "$tmp_dir/out.json" 0 500 250 1000 > /dev/null

    output="$(jq -r '.edges[] | select(.from == "A" and .to == "B") | [.weight, .source_signal_available, .signals.source_overlap, .signals.type_affinity] | @tsv' "$tmp_dir/out.json")"
    [ "$output" = $'0.667	true	1	1' ] || fail "Unexpected A-B edge metrics: $output"

    output="$(jq -r '.edges[] | select(.from == "C" and .to == "A") | [.weight, .source_signal_available, (.signals.source_overlap // "null"), .signals.type_affinity] | @tsv' "$tmp_dir/out.json")"
    [ "$output" = $'0.5	false	null	1' ] || fail "Expected missing sources to be omitted from denominator, got: $output"

    rm -rf "$tmp_dir"
}

test_single_node_graph_louvain_returns_safely() {
    local output
    output="$(node - <<'NODE' "$HELPER"
const helper = require(process.argv[2]);
const result = helper.runLouvain(["Solo"], new Map());
console.log(JSON.stringify(Object.fromEntries(result)));
NODE
)"
    [ "$output" = '{"Solo":"Solo"}' ] || fail "Expected single-node Louvain to return solo assignment, got: $output"
}

test_parse_sources_yaml_multiline() {
    local output
    output="$(node - <<'NODE' "$HELPER"
const helper = require(process.argv[2]);
const fm = [
  "title: Test",
  "sources:",
  "  - paper_a.pdf",
  "  - paper_b.pdf",
  "  - \"quoted.pdf\""
].join("\n");
const result = helper.parseSourcesFrontmatter(fm);
console.log(JSON.stringify(result));
NODE
)"
    local has_field parsed signal sources
    has_field="$(printf '%s' "$output" | jq -r '.hasField')"
    parsed="$(printf '%s' "$output" | jq -r '.parsed')"
    signal="$(printf '%s' "$output" | jq -r '.signalAvailable')"
    sources="$(printf '%s' "$output" | jq -r '.sources | join(",")')"
    [ "$has_field" = "true" ] || fail "Expected hasField=true for YAML multiline, got: $has_field"
    [ "$parsed" = "true" ] || fail "Expected parsed=true for YAML multiline, got: $parsed"
    [ "$signal" = "true" ] || fail "Expected signalAvailable=true, got: $signal"
    [ "$sources" = "paper_a.pdf,paper_b.pdf,quoted.pdf" ] || fail "Unexpected sources: $sources"
}

test_node_helper_bad_json_exits_with_error() {
    local tmp_dir output
    tmp_dir="$(mktemp -d)"

    printf 'not json' > "$tmp_dir/bad.json"
    printf '[]' > "$tmp_dir/edges.json"

    if output="$(node "$HELPER" "$tmp_dir/bad.json" "$tmp_dir/edges.json" "$tmp_dir/out.json" 0 500 250 1000 2>&1)"; then
        fail "graph-analysis.js should fail on invalid JSON input"
    fi

    assert_text_contains "$output" "Invalid JSON"
    rm -rf "$tmp_dir"
}

test_helper_preserves_node_source_path() {
    local tmp_dir output
    tmp_dir="$(mktemp -d)"

    mkdir -p "$tmp_dir/wiki/synthesis/sessions"

    cat > "$tmp_dir/wiki/synthesis/sessions/A.md" <<'EOF'
# A

正文。
EOF

    cat > "$tmp_dir/nodes.json" <<EOF
[
  {"id":"A","label":"A","type":"synthesis","source_path":"$tmp_dir/wiki/synthesis/sessions/A.md"}
]
EOF

    cat > "$tmp_dir/edges.json" <<'EOF'
[]
EOF

    node "$HELPER" "$tmp_dir/nodes.json" "$tmp_dir/edges.json" "$tmp_dir/out.json" 0 500 250 1000 > /dev/null

    output="$(jq -r '.nodes[] | select(.id == "A") | .source_path // ""' "$tmp_dir/out.json")"
    [ "$output" = "$tmp_dir/wiki/synthesis/sessions/A.md" ] || fail "Expected source_path to survive graph analysis, got: $output"

    rm -rf "$tmp_dir"
}

test_helper_reports_sparse_and_bridge_insights() {
    local output

    output="$(node - <<'NODE' "$HELPER"
const helper = require(process.argv[2]);
const nodesById = {
  's-topic': { id: 's-topic', label: 'Sparse Topic' },
  's1': { id: 's1', label: 'S1' },
  's2': { id: 's2', label: 'S2' },
  's3': { id: 's3', label: 'S3' },
  's4': { id: 's4', label: 'S4' },
  's5': { id: 's5', label: 'S5' },
  'bridge': { id: 'bridge', label: 'Bridge' },
  't2': { id: 't2', label: 'T2' },
  'b1': { id: 'b1', label: 'B1' },
  't3': { id: 't3', label: 'T3' },
  'c1': { id: 'c1', label: 'C1' }
};
const edges = [
  { from: 's-topic', to: 's1', type: 'EXTRACTED' },
  { from: 's-topic', to: 's2', type: 'EXTRACTED' },
  { from: 'bridge', to: 's-topic', type: 'EXTRACTED' },
  { from: 'bridge', to: 't2', type: 'EXTRACTED' },
  { from: 'bridge', to: 't3', type: 'EXTRACTED' },
  { from: 't2', to: 'b1', type: 'EXTRACTED' },
  { from: 't3', to: 'c1', type: 'EXTRACTED' }
];
const pairMetrics = new Map([
  ['bridge\ts-topic', { weight: 0.8 }],
  ['bridge\tt2', { weight: 0.8 }],
  ['bridge\tt3', { weight: 0.8 }]
]);
const communityAssignments = new Map([
  ['s-topic', 's-topic'],
  ['s1', 's-topic'],
  ['s2', 's-topic'],
  ['s3', 's-topic'],
  ['s4', 's-topic'],
  ['s5', 's-topic'],
  ['bridge', 'bridge'],
  ['t2', 't2'],
  ['b1', 't2'],
  ['t3', 't3'],
  ['c1', 't3']
]);
const insights = helper.buildInsights(nodesById, edges, pairMetrics, communityAssignments, {
  nodeCount: Object.keys(nodesById).length,
  edgeCount: edges.length,
  maxInsightNodes: 250,
  maxInsightEdges: 1000
});
console.log(JSON.stringify(insights));
NODE
)"

    local bridge sparse
    bridge="$(printf '%s' "$output" | jq -r '.bridge_nodes[]?.id')"
    assert_text_contains "$bridge" "bridge"

    sparse="$(printf '%s' "$output" | jq -r '.sparse_communities[]?.id')"
    assert_text_contains "$sparse" "s-topic"
}

main() {
    test_helper_computes_weights_and_source_omission
    test_single_node_graph_louvain_returns_safely
    test_parse_sources_yaml_multiline
    test_node_helper_bad_json_exits_with_error
    test_helper_preserves_node_source_path
    test_helper_reports_sparse_and_bridge_insights
    echo "PASS: graph analysis helper regression coverage"
}

main "$@"
