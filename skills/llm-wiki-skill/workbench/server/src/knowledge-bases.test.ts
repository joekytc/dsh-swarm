import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { findRegisteredKnowledgeBase, type KnowledgeBaseInfo } from "./knowledge-bases.js";

test("findRegisteredKnowledgeBase only accepts registered valid knowledge bases", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "llm-wiki-kb-registry-"));
	const registered = path.join(root, "registered");
	const other = path.join(root, "other");
	const alias = path.join(root, "registered-link");
	try {
		await mkdir(registered);
		await mkdir(other);
		await writeFile(path.join(registered, ".wiki-schema.md"), "# schema\n", "utf8");
		await symlink(registered, alias);
		const knownBases: KnowledgeBaseInfo[] = [
			{ path: registered, name: "registered", origin: "external", valid: true },
			{ path: other, name: "other", origin: "external", valid: false, reason: "Missing .wiki-schema.md" },
		];

		assert.equal((await findRegisteredKnowledgeBase(alias, knownBases))?.path, registered);
		assert.equal(await findRegisteredKnowledgeBase(other, knownBases), null);
		assert.equal(await findRegisteredKnowledgeBase(path.join(root, "missing"), knownBases), null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
