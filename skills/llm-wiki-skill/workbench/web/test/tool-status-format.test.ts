import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatToolStatusItem, truncateToolStatusText } from "../src/lib/tool-status-format";

describe("tool status format", () => {
	it("formats read and write file tools with compact private paths", () => {
		const read = formatToolStatusItem({
			toolName: "read",
			action: "读取",
			target: "/Users/alice/projects/secret/wiki/sources/very-long-private-file-name.md",
			args: { path: "/Users/alice/projects/secret/wiki/sources/very-long-private-file-name.md" },
			homeDir: "/Users/alice",
		});
		const write = formatToolStatusItem({
			toolName: "write_file",
			action: "写入",
			target: "/Users/alice/projects/secret/wiki/synthesis/report.md",
			args: { filePath: "/Users/alice/projects/secret/wiki/synthesis/report.md" },
			homeDir: "/Users/alice",
		});

		assert.deepEqual(
			[read.action, read.group, write.action, write.group],
			["读取", "file", "写入", "file"],
		);
		assert.equal(read.target.includes("/Users/alice"), false);
		assert.equal(write.target.includes("/Users/alice"), false);
		assert.match(read.target, /very-long-private-file-name\.md$/);
		assert.match(write.target, /report\.md$/);
		assert.ok(read.target.length <= 72);
	});

	it("formats bash commands as short command snippets", () => {
		const formatted = formatToolStatusItem({
			toolName: "bash",
			action: "运行命令",
			target:
				"npm run test --workspace=@llm-wiki-agent/web -- --verbose --filter a-very-long-test-name-that-keeps-going",
			args: {
				command:
					"npm run test --workspace=@llm-wiki-agent/web -- --verbose --filter a-very-long-test-name-that-keeps-going",
			},
		});

		assert.equal(formatted.action, "运行命令");
		assert.equal(formatted.group, "command");
		assert.match(formatted.target, /^npm run test/);
		assert.match(formatted.target, /\.\.\./);
		assert.ok(formatted.target.length <= 72);
	});

	it("formats search and skill tools with stable groups", () => {
		const search = formatToolStatusItem({
			toolName: "knowledge_search",
			action: "搜索",
			target: "tool status events",
			args: { query: "tool status events" },
		});
		const skill = formatToolStatusItem({
			toolName: "skill_runner",
			action: "调用 Skill",
			target: "llm-wiki",
			args: { skillName: "llm-wiki" },
		});

		assert.deepEqual(
			[search.action, search.target, search.group, skill.action, skill.target, skill.group],
			["搜索", "tool status events", "search", "调用 Skill", "llm-wiki", "skill"],
		);
	});

	it("handles empty args and unknown tools without blank labels", () => {
		const emptyRead = formatToolStatusItem({
			toolName: "read",
			action: "",
			target: "",
			args: {},
		});
		const unknown = formatToolStatusItem({
			toolName: "custom_vectorize",
			action: "",
			target: "",
			args: {},
		});

		assert.deepEqual(
			[emptyRead.action, emptyRead.target, emptyRead.group],
			["读取", "未知路径", "file"],
		);
		assert.deepEqual(
			[unknown.action, unknown.target, unknown.group],
			["运行 custom_vectorize", "未知目标", "other"],
		);
	});

	it("truncates text in the middle and preserves useful endings", () => {
		const truncated = truncateToolStatusText(
			"wiki/sources/2026/06/15/omp-tool-status-events-full-implementation-notes.md",
			36,
		);

		assert.equal(truncated.length <= 36, true);
		assert.match(truncated, /\.\.\./);
		assert.match(truncated, /notes\.md$/);
	});
});
