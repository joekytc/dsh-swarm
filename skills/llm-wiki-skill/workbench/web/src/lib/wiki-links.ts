export const WIKI_LINK_SEEN_EVENT = "llm-wiki-agent:wiki-link-seen";

export function extractWikiPageRefs(content: string): string[] {
	const seen = new Set<string>();
	const refs: string[] = [];
	const patterns = [
		/\[\[(wiki\/[^\]\n]+?\.md)\]\]/g,
		/\]\((wiki\/[^)\n]+?\.md)\)/g
	];
	for (const pattern of patterns) {
		addMatches(content, pattern, seen, refs);
	}
	return refs;
}

function addMatches(content: string, pattern: RegExp, seen: Set<string>, refs: string[]): void {
	for (const match of content.matchAll(pattern)) {
		const target = match[1];
		if (seen.has(target)) continue;
		seen.add(target);
		refs.push(target);
	}
}

export function normalizeWikiLinks(content: string): string {
	return content.replace(/\[\[(wiki\/[^\]\n]+?\.md)\]\]/g, (_match, target: string) => `[${target}](${target})`);
}

export function emitWikiLinkSeen(path: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent<string>(WIKI_LINK_SEEN_EVENT, { detail: path }));
}
