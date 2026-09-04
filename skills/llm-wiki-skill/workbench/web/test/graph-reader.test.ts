import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GraphOpenPagePayload } from "@llm-wiki/graph-engine";
import {
	graphReaderActionLabels,
	graphReaderActions,
	graphReaderMetaItems,
} from "../src/lib/graph-reader";

describe("graph reader", () => {
	it("uses graph metadata for reader meta and actions without legacy reading sections", () => {
		const payload: GraphOpenPagePayload = {
			path: "wiki/sources/source-a.md",
			node: {
				id: "source-a",
				title: "Source A",
				type: "source",
				typeLabel: "来源",
				sourcePath: "wiki/sources/source-a.md",
				community: "sources",
				date: "2026-06-13",
				source: "Archive",
				isolated: true,
			},
		};

		assert.deepEqual(graphReaderMetaItems(payload), [
			"来源",
			"2026-06-13",
			"Archive",
			"wiki/sources/source-a.md",
		]);
		assert.deepEqual(graphReaderActions(), [
			{ id: "quote_page", label: "在对话中引用" },
			{ id: "find_related_pages", label: "它和谁有关" },
		]);
		assert.deepEqual(graphReaderActionLabels(payload), ["在对话中引用", "它和谁有关"]);
		assert.equal(graphReaderActionLabels(payload).includes("学习队列"), false);
		assert.equal(graphReaderActionLabels(payload).includes("摘要"), false);
		assert.equal(graphReaderActionLabels(payload).includes("相邻节点"), false);
	});

	it("only exposes source path as a source link for source pages", () => {
		const topicPayload: GraphOpenPagePayload = {
			path: "wiki/topics/topic-a.md",
			node: {
				id: "topic-a",
				title: "Topic A",
				type: "topic",
				typeLabel: "主题",
				sourcePath: "wiki/topics/topic-a.md",
				community: "topics",
				date: null,
				source: null,
				isolated: false,
			},
		};

		assert.deepEqual(graphReaderMetaItems(topicPayload), ["主题"]);
	});
});
