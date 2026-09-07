import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractWikiPageRefs, normalizeWikiLinks } from "../src/lib/wiki-links";

describe("wiki link helpers", () => {
	it("extracts unique wiki markdown page refs in order", () => {
		const refs = extractWikiPageRefs([
			"See [[wiki/topics/alpha.md]] and [[wiki/entities/beta.md]].",
			"Repeat [[wiki/topics/alpha.md]] and ignore [[wiki/raw-note]].",
			"Markdown [Wikilink](wiki/entities/wikilink.md)."
		].join("\n"));

		assert.deepEqual(refs, ["wiki/topics/alpha.md", "wiki/entities/beta.md", "wiki/entities/wikilink.md"]);
	});

	it("normalizes phase-two wiki refs to markdown links", () => {
		assert.equal(
			normalizeWikiLinks("Open [[wiki/topics/alpha.md]] now."),
			"Open [wiki/topics/alpha.md](wiki/topics/alpha.md) now."
		);
	});
});
