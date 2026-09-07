import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { initScriptCandidates } from "./wiki-init.js";

test("initScriptCandidates supports Codex and Claude skill install locations", () => {
	const home = path.join("/", "Users", "example");
	assert.deepEqual(initScriptCandidates(home), [
		path.join(home, ".codex", "skills", "llm-wiki", "init-wiki.sh"),
		path.join(home, ".codex", "skills", "llm-wiki", "scripts", "init-wiki.sh"),
		path.join(home, ".codex", "skills", "llm-wiki-skill", "init-wiki.sh"),
		path.join(home, ".codex", "skills", "llm-wiki-skill", "scripts", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki-skill", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki-skill", "scripts", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki", "init-wiki.sh"),
		path.join(home, ".claude", "skills", "llm-wiki", "scripts", "init-wiki.sh"),
	]);
});
