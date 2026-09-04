import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { APP_DIR } from "./config.js";
import { getCachedPages, type PageRef } from "./pages.js";

export type HitReason =
	| "explicit"
	| "title"
	| "filename"
	| "body"
	| "recent_synthesis"
	| "kb_meta";

export interface SearchResult {
	path: string;
	title: string;
	snippet: string;
	mtime: number;
	hitReason: HitReason;
	score: number;
}

export interface SearchKnowledgeBaseOutput {
	results: SearchResult[];
	missingExplicitRefs: string[];
	totalSnippetChars: number;
}

export interface SearchKnowledgeBaseOptions {
	explicitRefs?: string[];
	maxPages?: number;
	snippetMaxChars?: number;
	totalBudgetChars?: number;
	assertRegistered?: boolean;
}

export interface RetrievalLogEntry {
	ts: number;
	sessionId: string;
	kbPath: string;
	messagePreview: string;
	triggered: boolean;
	explicitRefs: string[];
	results: Array<{ path: string; hitReason: HitReason; score: number }>;
	wrappedCharCount: number;
	error: string | null;
}

const DEFAULT_MAX_PAGES = 6;
const DEFAULT_SNIPPET_MAX_CHARS = 600;
const DEFAULT_TOTAL_BUDGET_CHARS = 4000;
const MIN_QUERY_TOKEN_LENGTH = 2;
const META_FILES = ["purpose.md", "index.md", "wiki/overview.md"];
const GENERIC_QUERY_RE =
	/(总结|概括|归纳|这些文章|这批文章|自媒体|共同主题|这个库|当前库|刚刚消化|刚消化|文章讲|内容讲|分析一下)/i;
const GREETING_SET = new Set(["你好", "hi", "hello", "在吗", "谢谢", "thanks", "thx", "ok", "好的"]);
const META_QUESTION_RE =
	/(当前模型|模型是什么|怎么设置|怎么用|界面|快捷键|登录|api\s*key|API\s*key|整理产出为|prepare_artifact|finalize_artifact|artifact id|生成主文件)/i;

export function parseExplicitPageRefs(message: string): string[] {
	const seen = new Set<string>();
	const refs: string[] = [];
	const re = /\[\[(wiki\/[^\]\n]+?\.md)\]\]/g;
	for (const match of message.matchAll(re)) {
		const ref = match[1]?.trim();
		if (!ref || seen.has(ref)) continue;
		seen.add(ref);
		refs.push(ref);
	}
	return refs;
}

export function shouldUseKnowledgeBase(message: string, kbSelected: boolean): boolean {
	if (!kbSelected) return false;
	const trimmed = message.trim();
	if (!trimmed) return false;
	if (trimmed.startsWith("/")) return false;
	if (parseExplicitPageRefs(trimmed).length > 0) return true;
	if ([...trimmed].length < 3) return false;
	const normalized = trimmed.replace(/[。！？!?.,，\s]/g, "").toLowerCase();
	if (GREETING_SET.has(normalized)) return false;
	if (META_QUESTION_RE.test(trimmed)) return false;
	return true;
}

export async function searchKnowledgeBase(
	kbPath: string,
	query: string,
	options: SearchKnowledgeBaseOptions = {},
): Promise<SearchKnowledgeBaseOutput> {
	const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
	const snippetMaxChars = Math.max(120, options.snippetMaxChars ?? DEFAULT_SNIPPET_MAX_CHARS);
	const totalBudgetChars = Math.max(300, options.totalBudgetChars ?? DEFAULT_TOTAL_BUDGET_CHARS);
	const explicitRefs = unique(options.explicitRefs ?? []);
	const genericQuery = isGenericQuery(query);
	const tokens = queryTokens(query);
	const candidates = await buildCandidates(kbPath, options.assertRegistered !== false);
	const byPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
	const missingExplicitRefs: string[] = [];
	const scored: SearchResult[] = [];

	for (const ref of explicitRefs) {
		const candidate = byPath.get(ref) ?? (await loadAdHocCandidate(kbPath, ref));
		if (!candidate) {
			missingExplicitRefs.push(ref);
			continue;
		}
		scored.push(toResult(candidate, "explicit", 10_000, query, snippetMaxChars));
	}

	for (const candidate of candidates) {
		if (explicitRefs.includes(candidate.path)) continue;
		const evaluated = evaluateCandidate(candidate, tokens, genericQuery, query, snippetMaxChars);
		if (evaluated) scored.push(evaluated);
	}

	scored.sort((a, b) => {
		if (a.hitReason === "explicit" && b.hitReason !== "explicit") return -1;
		if (b.hitReason === "explicit" && a.hitReason !== "explicit") return 1;
		return b.score - a.score || b.mtime - a.mtime || a.path.localeCompare(b.path, "zh");
	});

	const limited: SearchResult[] = [];
	let totalSnippetChars = 0;
	for (const result of scored) {
		if (limited.some((item) => item.path === result.path)) continue;
		const isExplicit = result.hitReason === "explicit";
		if (!isExplicit && limited.length >= maxPages) continue;
		if (!isExplicit && totalSnippetChars + result.snippet.length > totalBudgetChars) continue;
		limited.push(result);
		totalSnippetChars += result.snippet.length;
		if (limited.length >= maxPages && totalSnippetChars >= totalBudgetChars) break;
	}

	return { results: limited, missingExplicitRefs, totalSnippetChars };
}

export function buildKnowledgeContextPrompt(input: {
	originalMessage: string;
	kb: { name: string; path: string };
	search: SearchKnowledgeBaseOutput;
}): string {
	return [
		input.originalMessage,
		"",
		"---",
		buildKnowledgeContextMessage({ kb: input.kb, search: input.search }),
	].join("\n");
}

export function buildKnowledgeContextMessage(input: {
	kb: { name: string; path: string };
	search: SearchKnowledgeBaseOutput;
}): string {
	const { kb, search } = input;
	const missing =
		search.missingExplicitRefs.length > 0
			? [
					"",
					"用户显式引用了以下页面，但该页面不存在：",
					...search.missingExplicitRefs.map((ref) => `- ${ref}`),
				].join("\n")
			: "";
	if (search.results.length === 0) {
		return [
			"[系统检索上下文 / 用户不可见]",
			"",
			`当前知识库：${kb.name}`,
			`路径：${kb.path}`,
			"系统已尝试检索，但未在当前知识库找到与该问题相关的页面。",
			missing,
			"",
			"请明确告诉用户：当前知识库未找到相关内容。禁止反问用户提供文章，禁止编造来源。",
		]
			.filter((part) => part !== "")
			.join("\n");
	}

	const pages = search.results.flatMap((result, index) => [
		`[${index + 1}] ${result.title}`,
		`    路径: ${result.path}`,
		`    命中: ${result.hitReason}`,
		`    摘要: ${result.snippet}`,
		"",
	]);
	return [
		"[系统检索上下文 / 用户不可见]",
		"",
		"当前知识库：",
		`- 名称: ${kb.name}`,
		`- 路径: ${kb.path}`,
		"",
		"系统已从当前知识库检索到以下页面（按相关度排序）：",
		"",
		...pages,
		missing,
		"",
		"回答约束：",
		"- 必须基于以上页面内容回答；不得编造未在页面中出现的事实。",
		"- 如果以上页面不足以回答，明确说明当前知识库未找到足够相关内容。",
		"- 禁止再次反问用户提供文章；系统已经提供了当前知识库页面。",
		"- 回答末尾必须列出“参考页面”，格式为 `- 《标题》：路径`。",
		"- 参考页面只能从上述检索结果中选取，禁止编造路径。",
		"- 如未基于以上页面回答而再次反问用户提供文章，视为错误。",
	].join("\n");
}

export function stripKnowledgeContextForDisplay(text: string): string {
	const marker = "[系统检索上下文";
	const markerIndex = text.indexOf(marker);
	if (markerIndex === -1) return text;

	const beforeMarker = text.slice(0, markerIndex);
	const separatorIndex = beforeMarker.lastIndexOf("\n---");
	if (separatorIndex !== -1 && beforeMarker.slice(separatorIndex).trim() === "---") {
		return beforeMarker.slice(0, separatorIndex).trimEnd();
	}

	return beforeMarker.trimEnd();
}

export function formatSearchResultsForTool(search: SearchKnowledgeBaseOutput): string {
	if (search.results.length === 0) return "当前知识库未找到相关页面。";
	return search.results
		.map(
			(result, index) =>
				[
					`[${index + 1}] ${result.title}`,
					`路径: ${result.path}`,
					`命中: ${result.hitReason}`,
					result.snippet,
				].join("\n"),
		)
		.join("\n\n");
}

export function contextBudgetFromWindow(contextWindow: unknown): number {
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return DEFAULT_TOTAL_BUDGET_CHARS;
	}
	return Math.max(1000, Math.floor(contextWindow * 0.2));
}

export async function writeRetrievalLog(entry: RetrievalLogEntry): Promise<void> {
	const date = new Date(entry.ts).toISOString().slice(0, 10);
	const dir = path.join(APP_DIR, "logs", "retrieval");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, `${date}.jsonl`), `${JSON.stringify(entry)}\n`, {
		encoding: "utf8",
		flag: "a",
	});
}

interface Candidate {
	path: string;
	title: string;
	content: string;
	mtime: number;
	category: string;
	name: string;
}

async function buildCandidates(kbPath: string, assertRegistered: boolean): Promise<Candidate[]> {
	const pages = await getCachedPages(kbPath, { assertRegistered });
	const pageCandidates = await Promise.all(
		pages.map((page) => loadPageCandidate(kbPath, page).catch(() => null)),
	);
	const metaCandidates = await Promise.all(
		META_FILES.map((relPath) => loadMetaCandidate(kbPath, relPath).catch(() => null)),
	);
	return [...pageCandidates, ...metaCandidates].filter((item): item is Candidate => Boolean(item));
}

async function loadPageCandidate(kbPath: string, page: PageRef): Promise<Candidate> {
	const absolute = safeResolve(kbPath, page.path);
	const [content, info] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
	return {
		path: page.path,
		title: page.title,
		content,
		mtime: info.mtimeMs,
		category: page.category,
		name: page.name,
	};
}

async function loadMetaCandidate(kbPath: string, relPath: string): Promise<Candidate | null> {
	const absolute = safeResolve(kbPath, relPath);
	const info = await stat(absolute).catch(() => null);
	if (!info?.isFile()) return null;
	const content = await readFile(absolute, "utf8");
	return {
		path: relPath,
		title: extractTitle(content, path.basename(relPath, ".md")),
		content,
		mtime: info.mtimeMs,
		category: "kb_meta",
		name: path.basename(relPath, ".md"),
	};
}

async function loadAdHocCandidate(kbPath: string, relPath: string): Promise<Candidate | null> {
	if (!relPath.startsWith("wiki/") || !relPath.endsWith(".md")) return null;
	return loadMetaCandidate(kbPath, relPath);
}

function evaluateCandidate(
	candidate: Candidate,
	tokens: string[],
	genericQuery: boolean,
	query: string,
	snippetMaxChars: number,
): SearchResult | null {
	let hitReason: HitReason | null = null;
	let score = 0;
	const title = candidate.title.toLowerCase();
	const name = candidate.name.toLowerCase();
	const relPath = candidate.path.toLowerCase();
	const body = candidate.content.toLowerCase();
	const loweredTokens = tokens.map((token) => token.toLowerCase());

	for (const token of loweredTokens) {
		if (title.includes(token)) {
			score += 8 + token.length / 10;
			hitReason ??= "title";
		}
		if (name.includes(token)) {
			score += 5 + token.length / 10;
			hitReason ??= "filename";
		}
		if (relPath.includes(token)) {
			score += 2;
			hitReason ??= "filename";
		}
		if (body.includes(token)) {
			score += 3 + token.length / 10;
			hitReason ??= "body";
		}
	}

	if (genericQuery && candidate.category === "kb_meta") {
		score += 25;
		hitReason = "kb_meta";
	}
	if (genericQuery && candidate.path.startsWith("wiki/synthesis/sessions/")) {
		score += 40 + Math.min(10, candidate.mtime / 1_000_000_000_000);
		hitReason = "recent_synthesis";
	}

	if (!hitReason || score <= 0) return null;
	return toResult(candidate, hitReason, score, query, snippetMaxChars);
}

function toResult(
	candidate: Candidate,
	hitReason: HitReason,
	score: number,
	query: string,
	snippetMaxChars: number,
): SearchResult {
	return {
		path: candidate.path,
		title: candidate.title,
		snippet: extractSnippet(candidate.content, query, snippetMaxChars),
		mtime: candidate.mtime,
		hitReason,
		score,
	};
}

function extractSnippet(content: string, query: string, maxChars: number): string {
	const compact = content.replace(/\s+/g, " ").trim();
	if (compact.length <= maxChars) return compact;
	const tokens = queryTokens(query);
	const lower = compact.toLowerCase();
	const token = tokens.find((item) => lower.includes(item.toLowerCase()));
	if (!token) return `${compact.slice(0, maxChars).trim()}…`;
	const index = lower.indexOf(token.toLowerCase());
	const start = Math.max(0, index - Math.floor(maxChars / 2));
	const end = Math.min(compact.length, start + maxChars);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < compact.length ? "…" : "";
	return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function queryTokens(query: string): string[] {
	const normalized = query
		.replace(/\[\[[^\]]+\]\]/g, " ")
		.replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, " ");
	return unique(
		normalized
			.split(/\s+/)
			.map((token) => token.trim())
			.filter((token) => [...token].length >= MIN_QUERY_TOKEN_LENGTH),
	);
}

function isGenericQuery(query: string): boolean {
	return GENERIC_QUERY_RE.test(query);
}

function extractTitle(content: string, fallback: string): string {
	const match = content.slice(0, 1024).match(/^#\s+(.+)$/m);
	return match?.[1]?.trim() || fallback;
}

function safeResolve(kbPath: string, relPath: string): string {
	if (!relPath || path.isAbsolute(relPath)) throw new Error("path must be relative");
	const root = path.resolve(kbPath);
	const target = path.resolve(root, relPath);
	if (target !== root && !target.startsWith(root + path.sep)) {
		throw new Error("path must be inside kb");
	}
	return target;
}

function unique(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}
