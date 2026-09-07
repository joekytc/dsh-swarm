import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateLargeGraphFixture,
  LARGE_GRAPH_FIXTURE_SPECS,
  summarizeLargeGraphFixture
} from "./large-graph-fixtures";

describe("large graph fixture generation", () => {
  it("generates every required graph shape with deterministic metadata", () => {
    for (const spec of LARGE_GRAPH_FIXTURE_SPECS) {
      const fixture = generateLargeGraphFixture(spec.id);
      assert.equal(fixture.metadata.id, spec.id);
      assert.equal(fixture.metadata.nodes, spec.nodes, `${spec.id} node count`);
      assert.equal(fixture.metadata.edges, spec.edges, `${spec.id} edge count`);
      assert.equal(fixture.metadata.communities, spec.communities, `${spec.id} community count`);
      assert.equal(fixture.metadata.largest_community, spec.largestCommunity, `${spec.id} largest community`);
      assert.equal(fixture.metadata.search_hits, spec.searchHits, `${spec.id} search-hit count`);
      assert.equal(fixture.metadata.pin_count, spec.pinCount, `${spec.id} Pin count`);
      assert.equal(fixture.metadata.oversized_community, spec.oversizedCommunity, `${spec.id} oversized flag`);
      assert.deepEqual(
        summarizeLargeGraphFixture(spec.id, fixture.data, fixture.pins),
        fixture.metadata,
        `${spec.id} metadata should be reproducible from graph data`
      );
    }
  });

  it("keeps generated output stable for the same fixture id", () => {
    const first = generateLargeGraphFixture("nodes-1000-sparse");
    const second = generateLargeGraphFixture("nodes-1000-sparse");

    assert.deepEqual(second.metadata, first.metadata);
    assert.deepEqual(second.data.nodes.slice(0, 20), first.data.nodes.slice(0, 20));
    assert.deepEqual(second.data.edges.slice(0, 40), first.data.edges.slice(0, 40));
    assert.deepEqual(second.pins, first.pins);
  });

  it("does not require committed generated graph artifacts", () => {
    const fixture = generateLargeGraphFixture("nodes-10000-high-edge");

    assert.equal(fixture.data.nodes.length, 10000);
    assert.equal(fixture.data.edges.length, 90000);
    assert.ok(fixture.data.meta.degraded, "large generated fixtures should be marked degraded for current DOM/SVG baseline");
    assert.equal(Object.keys(fixture.pins).length, 300);
  });
});
