import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { graphDataPath, graphLayoutPath, readGraphData, readGraphLayout, writeGraphLayout } from "./graph.js";

test("graph data without node source paths is treated as stale", async () => {
	const kbPath = await tempKb();
	try {
		await mkdir(path.dirname(graphDataPath(kbPath)), { recursive: true });
		await writeFile(graphDataPath(kbPath), JSON.stringify({
			meta: { build_date: "2026-01-01T00:00:00Z", wiki_title: "Stale", total_nodes: 1, total_edges: 0 },
			nodes: [{ id: "session-a", label: "Session A", type: "synthesis" }],
			edges: [],
		}), "utf8");

		const result = await readGraphData(kbPath);
		assert.equal(result.needsBuild, true);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("graph layout read/write roundtrip stores kb-local pins", async () => {
	const kbPath = await tempKb();
	try {
		const written = await writeGraphLayout(kbPath, {
			pins: {
				"wiki/topics/agent.md": { x: 412.5, y: -88.2, coordinateSpace: "world" },
				"wiki/entities/tool.md": { x: 130, y: 245.7 },
			},
		});
		assert.equal(written.layout.version, 2);
		assert.deepEqual(written.layout.pins["wiki/topics/agent.md"], { x: 412.5, y: -88.2, coordinateSpace: "world" });
		assert.deepEqual(written.layout.pins["wiki/entities/tool.md"], { x: 130, y: 245.7, coordinateSpace: "world" });
		assert.ok(written.layout.updatedAt);

		const stored = JSON.parse(await readFile(graphLayoutPath(kbPath), "utf8"));
		assert.equal(stored.version, 2);
		assert.deepEqual(stored.pins, written.layout.pins);

		const readBack = await readGraphLayout(kbPath);
		assert.deepEqual(readBack.layout.pins, written.layout.pins);
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("graph layout treats missing or damaged files as empty", async () => {
	const kbPath = await tempKb();
	try {
		assert.deepEqual((await readGraphLayout(kbPath)).layout.pins, {});

		await writeFile(graphLayoutPath(kbPath), "{not-json", "utf8");
		assert.deepEqual((await readGraphLayout(kbPath)).layout.pins, {});
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("graph layout filters unsafe keys and invalid positions", async () => {
	const kbPath = await tempKb();
	try {
		const result = await writeGraphLayout(kbPath, {
			pins: {
				"wiki/valid.md": { x: 1, y: 2 },
				"/absolute.md": { x: 3, y: 4 },
				"wiki/../escape.md": { x: 5, y: 6 },
				"raw/not-wiki.md": { x: 7, y: 8 },
				"wiki/bad.md": { x: Number.NaN, y: 9 },
			},
		});
		assert.deepEqual(result.layout.pins, {
			"wiki/valid.md": { x: 1, y: 2, coordinateSpace: "world" },
		});
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

test("graph layout keeps old percent pins readable and preserves explicit world pins", async () => {
	const kbPath = await tempKb();
	try {
		await mkdir(path.dirname(graphLayoutPath(kbPath)), { recursive: true });
		await writeFile(graphLayoutPath(kbPath), JSON.stringify({
			version: 1,
			pins: {
				"wiki/old-percent.md": { x: 80, y: 50 },
				"wiki/new-world.md": { x: 8, y: -12, coordinateSpace: "world" },
				"wiki/legacy-explicit.md": { x: 13, y: 44, coordinateSpace: "legacy-percent" },
				"wiki/bad-space.md": { x: 1, y: 2, coordinateSpace: "screen" },
			},
			updatedAt: "2026-06-12T00:00:00.000Z",
		}), "utf8");

		const readBack = await readGraphLayout(kbPath);
		assert.equal(readBack.layout.version, 2);
		assert.deepEqual(readBack.layout.pins, {
			"wiki/old-percent.md": { x: 80, y: 50, coordinateSpace: "legacy-percent" },
			"wiki/new-world.md": { x: 8, y: -12, coordinateSpace: "world" },
			"wiki/legacy-explicit.md": { x: 13, y: 44, coordinateSpace: "legacy-percent" },
			"wiki/bad-space.md": { x: 1, y: 2, coordinateSpace: "legacy-percent" },
		});
	} finally {
		await rm(kbPath, { recursive: true, force: true });
	}
});

async function tempKb(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "llm-wiki-graph-layout-"));
}
