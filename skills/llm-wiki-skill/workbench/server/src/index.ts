/**
 * llm-wiki-agent 后端入口
 *
 * 阶段一 step 8 完整端点：
 *   GET    /api/health                          心跳
 *   POST   /api/echo                            诊断回显
 *   POST   /api/prompt                          发消息（SSE 回 agent 事件流）
 *
 *   GET    /api/knowledge-bases                 列出所有已知知识库
 *   POST   /api/knowledge-bases/external        登记外部库
 *   DELETE /api/knowledge-bases/external        取消登记
 *
 *   GET    /api/knowledge-base                  当前活跃上下文（含 kb + conversation + messages）
 *   POST   /api/knowledge-base                  选择 KB（自动加载/新建对话）
 *   DELETE /api/knowledge-base                  清空活跃上下文
 *
 *   GET    /api/conversations?kb=<path>         列出某 KB 下所有对话
 *   POST   /api/conversations                   切到指定对话 body: {kbPath, conversationId}
 *   POST   /api/conversations/new               在指定 KB 新建对话 body: {kbPath}
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import {
	artifactEvents,
	getArtifact,
	isValidArtifactId,
	listArtifacts,
	resolveArtifactFile,
	type ArtifactCreatedEvent,
} from "./artifacts.js";
import {
	bootstrapFromConfig,
	clearActive,
	createNewConversation,
	getActive,
	getActiveSession,
	listAvailableModels,
	listLoadedSkills,
	reloadActiveResources,
	selectConversation,
	selectKb,
} from "./agent.js";
import { getAuthStatus, setAuthKey, testAuthConnection } from "./auth.js";
import { type AppConfig, loadConfig, saveConfig } from "./config.js";
import { listConversations, piMessagesToUIMessages } from "./conversations.js";
import { runBatchDigest } from "./digest/batch.js";
import {
	clearPendingKnowledgeContext,
	setPendingKnowledgeContext,
} from "./extensions/knowledge-base.js";
import {
	readGraphData,
	readGraphLayout,
	resumeGraphWatcher,
	subscribeGraphEvents,
	stopKnowledgeBaseGraphWatcher,
	suspendGraphWatcher,
	triggerGraphRebuild,
	watchKnowledgeBaseGraph,
	writeGraphLayout,
} from "./graph.js";
import {
	inspectPath,
	assertRegisteredKnowledgeBase,
	listKnowledgeBases,
	registerExternalKnowledgeBase,
	unregisterExternalKnowledgeBase,
} from "./knowledge-bases.js";
import { listPageRefs, readWikiPage } from "./pages.js";
import {
	buildKnowledgeContextMessage,
	contextBudgetFromWindow,
	parseExplicitPageRefs,
	searchKnowledgeBase,
	shouldUseKnowledgeBase,
	writeRetrievalLog,
} from "./retrieval.js";
import {
	OrderedSseWriter,
	PromptRunRegistry,
	ToolStatusEventAdapter,
} from "./tool-status-events.js";
import { createWiki, InitConflictError, initExistingWiki } from "./wiki-init.js";

const execFileAsync = promisify(execFile);
const promptRuns = new PromptRunRegistry();

/** 从 session 安全取出模型 provider+id（pi 类型未导出 Model，用结构化访问） */
function extractModelInfo(session: AgentSession): { provider: string; id: string } | null {
	const model = (session.state as { model?: { provider?: unknown; id?: unknown } }).model;
	if (
		model &&
		typeof model.provider === "string" &&
		typeof model.id === "string"
	) {
		return { provider: model.provider, id: model.id };
	}
	return null;
}

function extractContextWindow(session: AgentSession): number | undefined {
	const model = (session.state as { model?: { contextWindow?: unknown } }).model;
	return typeof model?.contextWindow === "number" ? model.contextWindow : undefined;
}

function normalizeRoleModelRef(raw: unknown): AppConfig["modelRoles"] extends infer Roles
	? Roles extends { main?: infer Ref }
		? Ref | undefined
		: never
	: never {
	if (raw === null) return null;
	if (typeof raw !== "object" || raw === undefined) return undefined;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.provider !== "string" || typeof obj.modelId !== "string") return undefined;
	if (!obj.provider.trim() || !obj.modelId.trim()) return undefined;
	return { provider: obj.provider.trim(), modelId: obj.modelId.trim() };
}

function sameModelRef(a: unknown, b: unknown): boolean {
	const left = normalizeRoleModelRef(a);
	const right = normalizeRoleModelRef(b);
	if (left === undefined && right === undefined) return true;
	if (left === null || right === null) return left === right;
	if (left === undefined || right === undefined) return false;
	return left.provider === right.provider && left.modelId === right.modelId;
}

function requestedKnowledgeBasePath(queryValue: string | undefined, body?: unknown): string | null {
	if (queryValue?.trim()) return queryValue.trim();
	if (body && typeof body === "object") {
		const bodyPath = (body as { kbPath?: unknown }).kbPath;
		if (typeof bodyPath === "string" && bodyPath.trim()) return bodyPath.trim();
	}
	return getActive()?.kb.path ?? null;
}

async function requestedRegisteredKnowledgeBasePath(
	queryValue: string | undefined,
	body?: unknown,
): Promise<string | null> {
	const requestedPath = requestedKnowledgeBasePath(queryValue, body);
	if (!requestedPath) return null;
	return assertRegisteredKnowledgeBase(requestedPath);
}

function errorStatus(err: unknown, fallback: 400 | 500 = 500): 400 | 403 | 500 {
	const statusCode = (err as { statusCode?: unknown })?.statusCode;
	if (statusCode === 403) return 403;
	if (statusCode === 400) return 400;
	return fallback;
}

function localHostOnly(rawHost: string | undefined): string {
	const host = rawHost?.trim() || "127.0.0.1";
	if (host === "127.0.0.1" || host === "localhost" || host === "::1") return host;
	console.warn(`[llm-wiki-agent/server] ignoring unsafe HOST=${host}; binding to 127.0.0.1`);
	return "127.0.0.1";
}

const app = new Hono();

app.get("/api/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: Date.now(),
		service: "llm-wiki-agent/server",
	});
});

app.get("/api/events", (c) => {
	return streamSSE(c, async (stream) => {
		const unsubscribe = subscribeGraphEvents((event) => {
			void stream.writeSSE({
				event: event.type,
				data: JSON.stringify(event),
			}).catch(() => {
				stream.abort();
			});
		});
		stream.onAbort(unsubscribe);
		await stream.writeSSE({
			event: "ready",
			data: JSON.stringify({ ok: true, timestamp: Date.now() }),
		});
		await new Promise<void>((resolve) => {
			stream.onAbort(() => resolve());
		});
		unsubscribe();
	});
});

app.post("/api/echo", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	return c.json({ ok: true, received: body });
});

// ============= 知识库列表（库的管理） =============

app.get("/api/knowledge-bases", async (c) => {
	try {
		const items = await listKnowledgeBases();
		return c.json({ ok: true, items });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/knowledge-bases/external", async (c) => {
	let body: { path?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || !body.path.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'path'" }, 400);
	}
	try {
		const result = await registerExternalKnowledgeBase(body.path);
		return c.json({ ok: true, ...result });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.post("/api/knowledge-bases/inspect", async (c) => {
	let body: { path?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || !body.path.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'path'" }, 400);
	}
	try {
		return c.json({ ok: true, result: await inspectPath(body.path) });
	} catch (err) {
		const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			statusCode === 403 ? 403 : 500,
		);
	}
});

app.delete("/api/knowledge-bases/external", async (c) => {
	let body: { path?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || !body.path.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'path'" }, 400);
	}
	const result = await unregisterExternalKnowledgeBase(body.path);
	return c.json({ ok: true, ...result });
});

app.post("/api/knowledge-bases/new", async (c) => {
	let body: { name?: unknown; purpose?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.name !== "string" || typeof body.purpose !== "string") {
		return c.json({ ok: false, error: "Missing 'name' or 'purpose'" }, 400);
	}
	try {
		const result = await createWiki(body.name, body.purpose);
		return c.json({
			ok: true,
			info: {
				path: result.path,
				name: result.name,
				origin: "default",
				valid: true,
			},
			stdout: result.stdout,
			stderr: result.stderr,
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.post("/api/knowledge-bases/init-existing", async (c) => {
	let body: { path?: unknown; purpose?: unknown; overwrite?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || typeof body.purpose !== "string") {
		return c.json({ ok: false, error: "Missing 'path' or 'purpose'" }, 400);
	}
	try {
		const result = await initExistingWiki(body.path, body.purpose, body.overwrite === true);
		return c.json({
			ok: true,
			info: {
				path: result.path,
				name: result.path.split("/").filter(Boolean).pop() ?? result.path,
				origin: "external",
				valid: true,
			},
			stdout: result.stdout,
			stderr: result.stderr,
			backedUpFiles: result.backedUpFiles,
		});
	} catch (err) {
		if (err instanceof InitConflictError) {
			return c.json({ ok: false, error: err.message, conflicts: err.conflicts }, 409);
		}
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

// ============= 活跃上下文（当前选中的 KB + 对话） =============

app.get("/api/knowledge-base", async (c) => {
	const ctx = getActive();
	if (!ctx) return c.json({ ok: true, active: null });
	return c.json({
		ok: true,
		active: {
			kb: ctx.kb,
			conversation: {
				id: ctx.conversationId,
				messages: piMessagesToUIMessages(ctx.session.state.messages),
			},
			model: extractModelInfo(ctx.session),
		},
	});
});

app.post("/api/knowledge-base", async (c) => {
	let body: { path?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.path !== "string" || !body.path.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'path'" }, 400);
	}
	try {
		const ctx = await selectKb(body.path);
		watchKnowledgeBaseGraph(ctx.kb.path);
		return c.json({
			ok: true,
			active: {
				kb: ctx.kb,
				conversation: {
					id: ctx.conversationId,
					isNew: ctx.isNew,
					messages: piMessagesToUIMessages(ctx.session.state.messages),
				},
				model: extractModelInfo(ctx.session),
			},
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.delete("/api/knowledge-base", async (c) => {
	await clearActive();
	stopKnowledgeBaseGraphWatcher();
	return c.json({ ok: true });
});

// ============= 图谱（指定知识库；未传时回退当前知识库） =============

app.get("/api/graph", async (c) => {
	try {
		const kbPath = await requestedRegisteredKnowledgeBasePath(c.req.query("kb"));
		if (!kbPath) return c.json({ ok: false, error: "请先选择一个知识库" }, 400);
		return c.json(await readGraphData(kbPath));
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			errorStatus(err),
		);
	}
});

app.post("/api/graph/rebuild", async (c) => {
	try {
		const kbPath = await requestedRegisteredKnowledgeBasePath(c.req.query("kb"));
		if (!kbPath) return c.json({ ok: false, error: "请先选择一个知识库" }, 400);
		return c.json(triggerGraphRebuild(kbPath));
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			errorStatus(err),
		);
	}
});

app.get("/api/graph/layout", async (c) => {
	try {
		const kbPath = await requestedRegisteredKnowledgeBasePath(c.req.query("kb"));
		if (!kbPath) return c.json({ ok: false, error: "请先选择一个知识库" }, 400);
		return c.json(await readGraphLayout(kbPath));
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			errorStatus(err),
		);
	}
});

app.put("/api/graph/layout", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	try {
		const kbPath = await requestedRegisteredKnowledgeBasePath(c.req.query("kb"), body);
		if (!kbPath) return c.json({ ok: false, error: "请先选择一个知识库" }, 400);
		return c.json(await writeGraphLayout(kbPath, body));
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			errorStatus(err),
		);
	}
});

// ============= Wiki 页面引用候选 =============

app.get("/api/refs", async (c) => {
	const kbPath = c.req.query("kb");
	if (!kbPath) return c.json({ ok: false, error: "Missing query param 'kb'" }, 400);
	const q = c.req.query("q") ?? "";
	const rawLimit = Number(c.req.query("limit") ?? 20);
	const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
	try {
		const items = await listPageRefs(kbPath, q, limit);
		return c.json({ ok: true, items });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.get("/api/page", async (c) => {
	const kbPath = c.req.query("kb");
	const relPath = c.req.query("path");
	if (!kbPath || !relPath) {
		return c.json({ ok: false, error: "Missing query params 'kb' or 'path'" }, 400);
	}
	try {
		const content = await readWikiPage(kbPath, relPath);
		return c.json({ ok: true, content });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

// ============= Slash 命令列表 =============

app.get("/api/commands", async (c) => {
	try {
		const queryValue = c.req.query("includeUserGlobal");
		const includeUserGlobal =
			queryValue === "true" ||
			(queryValue === undefined && (await loadConfig()).showUserGlobalSkills === true);
		const builtin = [
			{
				slug: "/sediment",
				name: "sediment_to_wiki",
				description: "把当前对话结晶为 wiki/synthesis/sessions/ 下的页面",
				source: "builtin",
				skillPath: null,
			},
			{
				slug: "/new-wiki",
				name: "new_wiki",
				description: "在默认目录下新建一个 llm-wiki 知识库",
				source: "builtin",
				skillPath: null,
			},
			{
				slug: "/html",
				name: "html",
				description: "把当前对话导出为自包含 HTML 页面",
				source: "builtin",
				skillPath: null,
			},
		];
		const skills = (await listLoadedSkills())
			.filter((skill) => includeUserGlobal || skill.source !== "user-global")
			.map((skill) => ({
				slug: `/${skill.name}`,
				name: skill.name,
				description: skill.description,
				source: skill.source,
				skillPath: skill.skillPath,
			}));
		return c.json({ ok: true, items: [...builtin, ...skills] });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.get("/api/config", async (c) => {
	try {
		return c.json({ ok: true, config: await loadConfig() });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/config", async (c) => {
	let body: {
		showUserGlobalSkills?: unknown;
		modelRoles?: unknown;
		uiPrefs?: unknown;
	};
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	try {
		const current = await loadConfig();
		const next: AppConfig = {
			...current,
			...(typeof body.showUserGlobalSkills === "boolean"
				? { showUserGlobalSkills: body.showUserGlobalSkills }
				: {}),
		};
		let mainRoleChanged = false;
		if (typeof body.modelRoles === "object" && body.modelRoles !== null) {
			const roles = body.modelRoles as Record<string, unknown>;
			const nextMain = normalizeRoleModelRef(roles.main);
			const nextDigest = normalizeRoleModelRef(roles.digest);
			mainRoleChanged = nextMain !== undefined && !sameModelRef(current.modelRoles?.main, nextMain);
			next.modelRoles = {
				...(current.modelRoles ?? {}),
				...(nextMain !== undefined ? { main: nextMain } : {}),
				...(nextDigest !== undefined ? { digest: nextDigest } : {}),
			};
		}
		if (typeof body.uiPrefs === "object" && body.uiPrefs !== null) {
			const prefs = body.uiPrefs as Record<string, unknown>;
			next.uiPrefs = {
				...(current.uiPrefs ?? {}),
				...(Array.isArray(prefs.sidebarExpandedKbs)
					? {
							sidebarExpandedKbs: prefs.sidebarExpandedKbs.filter(
								(value): value is string => typeof value === "string",
							),
						}
					: {}),
			};
		}
		await saveConfig(next);
		if (
			(typeof body.showUserGlobalSkills === "boolean" &&
				body.showUserGlobalSkills !== current.showUserGlobalSkills) ||
			mainRoleChanged
		) {
			await reloadActiveResources();
		}
		return c.json({ ok: true, config: next });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.get("/api/models", async (c) => {
	try {
		return c.json({ ok: true, items: listAvailableModels() });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/system/choose-directory", async (c) => {
	if (process.platform !== "darwin") {
		return c.json({ ok: false, error: "当前系统暂不支持文件夹选择器" }, 501);
	}
	try {
		const { stdout } = await execFileAsync("osascript", [
			"-e",
			'POSIX path of (choose folder with prompt "选择知识库文件夹")',
		]);
		const selectedPath = stdout.trim();
		if (!selectedPath) return c.json({ ok: false, error: "没有选择文件夹" }, 400);
		return c.json({ ok: true, path: selectedPath });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("-128") || message.toLowerCase().includes("user canceled")) {
			return c.json({ ok: false, canceled: true });
		}
		return c.json({ ok: false, error: message }, 500);
	}
});

app.post("/api/knowledge-bases/batch-digest", async (c) => {
	let body: {
		kbPath?: unknown;
		filePaths?: unknown;
		concurrency?: unknown;
		sourceScanId?: unknown;
		digestModel?: unknown;
	};
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.kbPath !== "string") {
		return c.json({ ok: false, error: "Missing 'kbPath'" }, 400);
	}
	if (!Array.isArray(body.filePaths) || !body.filePaths.every((item) => typeof item === "string")) {
		return c.json({ ok: false, error: "Missing or invalid 'filePaths'" }, 400);
	}
	const concurrency = body.concurrency === undefined ? 3 : Number(body.concurrency);
	if (![1, 3, 5].includes(concurrency)) {
		return c.json({ ok: false, error: "concurrency 只能是 1、3 或 5" }, 400);
	}
	const sourceScanId = typeof body.sourceScanId === "string" ? body.sourceScanId : undefined;
	const digestModel =
		typeof body.digestModel === "object" &&
		body.digestModel !== null &&
		typeof (body.digestModel as { provider?: unknown }).provider === "string" &&
		typeof (body.digestModel as { modelId?: unknown }).modelId === "string"
			? {
					provider: (body.digestModel as { provider: string }).provider,
					modelId: (body.digestModel as { modelId: string }).modelId,
				}
			: null;

	return streamSSE(c, async (stream) => {
		suspendGraphWatcher(body.kbPath as string);
		let completed = false;
		try {
			await runBatchDigest(
				{
					kbPath: body.kbPath as string,
					filePaths: body.filePaths as string[],
					concurrency,
					...(sourceScanId ? { sourceScanId } : {}),
					...(digestModel ? { digestModel } : {}),
				},
				async (event) => {
					await stream.writeSSE({
						event: event.type,
						data: JSON.stringify(event),
					});
				},
			);
			completed = true;
		} catch (err) {
			await stream.writeSSE({
				event: "error",
				data: JSON.stringify({ message: err instanceof Error ? err.message : String(err) }),
			});
		} finally {
			resumeGraphWatcher(body.kbPath as string, { trigger: completed });
		}
	});
});

// ============= 产物 Artifacts =============

app.get("/api/artifacts", (c) => {
	const conversationId = c.req.query("conversation");
	return c.json({ ok: true, items: listArtifacts(conversationId) });
});

app.get("/api/artifacts/:id", (c) => {
	const id = c.req.param("id");
	if (!isValidArtifactId(id)) {
		return c.json({ ok: false, error: "Invalid artifact id" }, 400);
	}
	const manifest = getArtifact(id);
	if (!manifest) return c.json({ ok: false, error: "Artifact not found" }, 404);
	return c.json({ ok: true, manifest });
});

app.get("/api/artifacts/:id/files/:filename", async (c) => {
	const id = c.req.param("id");
	const filename = c.req.param("filename");
	if (!isValidArtifactId(id)) {
		return c.json({ ok: false, error: "Invalid artifact id" }, 400);
	}
	try {
		const file = resolveArtifactFile(id, filename);
		const body = await readFile(file.path);
		return new Response(body, {
			headers: {
				"Content-Type": file.mimeType,
				"Content-Length": String(file.sizeBytes),
				"Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message.includes("不存在") || message.includes("不在 manifest") ? 404 : 400;
		return c.json({ ok: false, error: message }, status);
	}
});

// ============= 模型认证 =============

app.get("/api/auth/status", async (c) => {
	try {
		return c.json({ ok: true, ...(await getAuthStatus()) });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/auth/set", async (c) => {
	let body: { provider?: unknown; type?: unknown; key?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (body.type !== "api_key" || typeof body.provider !== "string" || typeof body.key !== "string") {
		return c.json({ ok: false, error: "Missing provider/type/key" }, 400);
	}
	try {
		await setAuthKey(body.provider, body.key);
		return c.json({ ok: true });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.post("/api/auth/test", async (c) => {
	let body: { provider?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.provider !== "string") {
		return c.json({ ok: false, error: "Missing provider" }, 400);
	}
	const result = await testAuthConnection(body.provider);
	return c.json(result);
});

// ============= 对话列表与切换 =============

app.get("/api/conversations", async (c) => {
	const kbPath = c.req.query("kb");
	if (!kbPath) {
		return c.json({ ok: false, error: "Missing query param 'kb'" }, 400);
	}
	try {
		const items = await listConversations(kbPath);
		// 新建后未发消息的活跃对话，pi 不会写盘 → list 不含 → UI 找不到。
		// 这里前置一个合成 stub 让 UI 看得到。
		const ctx = getActive();
		if (
			ctx &&
			ctx.kb.path === kbPath &&
			!items.some((i) => i.id === ctx.conversationId)
		) {
			items.unshift({
				id: ctx.conversationId,
				path: "",
				firstMessage: "(新对话)",
				modifiedAt: Date.now(),
			});
		}
		return c.json({ ok: true, items });
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			500,
		);
	}
});

app.post("/api/conversations", async (c) => {
	let body: { kbPath?: unknown; conversationId?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.kbPath !== "string" || typeof body.conversationId !== "string") {
		return c.json({ ok: false, error: "Missing 'kbPath' or 'conversationId'" }, 400);
	}
	try {
		const ctx = await selectConversation(body.kbPath, body.conversationId);
		watchKnowledgeBaseGraph(ctx.kb.path);
		return c.json({
			ok: true,
			active: {
				kb: ctx.kb,
				conversation: {
					id: ctx.conversationId,
					isNew: false,
					messages: piMessagesToUIMessages(ctx.session.state.messages),
				},
				model: extractModelInfo(ctx.session),
			},
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

app.post("/api/conversations/new", async (c) => {
	let body: { kbPath?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	if (typeof body.kbPath !== "string") {
		return c.json({ ok: false, error: "Missing 'kbPath'" }, 400);
	}
	try {
		const ctx = await createNewConversation(body.kbPath);
		watchKnowledgeBaseGraph(ctx.kb.path);
		return c.json({
			ok: true,
			active: {
				kb: ctx.kb,
				conversation: { id: ctx.conversationId, isNew: true, messages: [] },
				model: extractModelInfo(ctx.session),
			},
		});
	} catch (err) {
		return c.json(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			400,
		);
	}
});

// ============= Prompt（agent 事件流） =============

app.post("/api/prompt", async (c) => {
	let body: { message?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ ok: false, error: "Invalid JSON body" }, 400);
	}
	const message = body.message;
	if (typeof message !== "string" || !message.trim()) {
		return c.json({ ok: false, error: "Missing or empty 'message'" }, 400);
	}

	return streamSSE(c, async (stream) => {
		let session;
		let activeForRun;
		try {
			session = await getActiveSession();
			activeForRun = getActive();
		} catch (err) {
			clearPendingKnowledgeContext();
			const adapter = new ToolStatusEventAdapter({
				runId: "unavailable",
				messageId: "unavailable",
			});
			const errorEvent = adapter.failAssistant(err)[0] ?? {
				schemaVersion: 1 as const,
				type: "assistant_error" as const,
				runId: "unavailable",
				messageId: "unavailable",
				seq: 1,
				error: err instanceof Error ? err.message : String(err),
			};
			await stream.writeSSE({
				event: errorEvent.type,
				data: JSON.stringify({ ...errorEvent, hint: "请先在侧栏选择一个知识库" }),
			});
			return;
		}

		const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const messageId = `assistant-${runId}`;
		const sessionId = activeForRun?.conversationId ?? "active-session";
		if (!promptRuns.begin(sessionId, runId)) {
			await stream.writeSSE({
				event: "assistant_error",
				data: JSON.stringify({
					schemaVersion: 1,
					runId,
					messageId,
					seq: 1,
					type: "assistant_error",
					error: "当前对话正在生成，请等待上一条回复完成。",
				}),
			});
			return;
		}

		let aborted = false;
		let streamOpen = true;
		let responseFinished = false;
		const adapter = new ToolStatusEventAdapter({ runId, messageId });
		const writer = new OrderedSseWriter(async ({ event, data }) => {
			if (!streamOpen) return;
			await stream.writeSSE({ event, data });
		});
		const unsubscribe = session.subscribe(async (event) => {
			try {
				for (const contractEvent of adapter.adapt(event)) {
					await writer.writeContract(contractEvent);
				}
			} catch {
				streamOpen = false;
			}
		});
		const onArtifactCreated = async (event: ArtifactCreatedEvent) => {
			if (event.conversationId !== getActive()?.conversationId) return;
			try {
				await writer.writeNamed("artifact_created", {
					id: event.id,
					kind: event.kind,
					title: event.title,
				});
			} catch {
				streamOpen = false;
			}
		};
		artifactEvents.on("artifact_created", onArtifactCreated);
		stream.onAbort(() => {
			aborted = true;
			streamOpen = false;
			writer.close();
			clearPendingKnowledgeContext();
			if (!responseFinished) session.abort?.();
		});

		try {
			const active = getActive();
			const explicitRefs = parseExplicitPageRefs(message);
			const shouldSearch = shouldUseKnowledgeBase(message, Boolean(active));
			if (active) {
				const baseLog = {
					ts: Date.now(),
					sessionId: active.conversationId,
					kbPath: active.kb.path,
					messagePreview: message.slice(0, 120),
					explicitRefs,
				};
				if (shouldSearch) {
					const toolCallId = `${runId}-knowledge-search`;
					await writer.writeContract(adapter.startTool({
						toolCallId,
						toolName: "knowledge_search",
						args: {
							query: message,
							path: active.kb.path,
						},
					}));
					await writer.writeContract(adapter.updateTool({
						toolCallId,
						toolName: "knowledge_search",
						args: {
							query: message,
							path: active.kb.path,
						},
						partialResult: { summary: "正在检索当前知识库" },
					}));
					try {
						const search = await searchKnowledgeBase(active.kb.path, message, {
							explicitRefs,
							totalBudgetChars: contextBudgetFromWindow(extractContextWindow(session)),
						});
						const knowledgeContext = buildKnowledgeContextMessage({
							kb: active.kb,
							search,
						});
						setPendingKnowledgeContext(knowledgeContext);
						const payload = {
							count: search.results.length,
							paths: search.results.map((result) => result.path),
						};
						await writer.writeContract(adapter.endTool({
							toolCallId,
							toolName: "knowledge_search",
							result: {
								summary:
									search.results.length > 0
										? `已检索到 ${search.results.length} 个相关页面`
										: "当前知识库未找到相关页面",
								...payload,
							},
						}));
						await writeRetrievalLog({
							...baseLog,
							triggered: true,
							results: search.results.map((result) => ({
								path: result.path,
								hitReason: result.hitReason,
								score: result.score,
							})),
							wrappedCharCount: message.length + knowledgeContext.length,
							error: null,
						}).catch(() => {});
					} catch (err) {
						const error = err instanceof Error ? err.stack ?? err.message : String(err);
						await writer.writeContract(adapter.endTool({
							toolCallId,
							toolName: "knowledge_search",
							result: {
								error: err instanceof Error ? err.message : String(err),
							},
							isError: true,
						}));
						await writeRetrievalLog({
							...baseLog,
							triggered: true,
							results: [],
							wrappedCharCount: 0,
							error,
						}).catch(() => {});
					}
				} else {
					await writeRetrievalLog({
						...baseLog,
						triggered: false,
						results: [],
						wrappedCharCount: 0,
						error: null,
					}).catch(() => {});
				}
			}
			await session.prompt(message);
			responseFinished = true;
			for (const event of adapter.finishAssistant()) {
				await writer.writeContract(event);
			}
			await writer.flush();
		} catch (err) {
			if (aborted) {
				for (const event of adapter.cancelAssistant("client disconnected")) {
					await writer.writeContract(event);
				}
			} else {
				for (const event of adapter.failAssistant(err)) {
					await writer.writeContract(event);
				}
			}
			await writer.flush();
		} finally {
			clearPendingKnowledgeContext();
			unsubscribe();
			artifactEvents.off("artifact_created", onArtifactCreated);
			promptRuns.end(sessionId, runId);
			writer.close();
		}
	});
});

const PORT = Number(process.env.PORT ?? 8787);
const HOST = localHostOnly(process.env.HOST);

// 阻塞启动直到 bootstrap 完成。首次启动约 1-2s（pi ResourceLoader + 恢复 session），
// 换来前端首次 fetch 一致性。dev 模式 tsx watch 重启也会经历此延迟，可接受。
await bootstrapFromConfig();
const bootstrappedActive = getActive();
if (bootstrappedActive) watchKnowledgeBaseGraph(bootstrappedActive.kb.path);

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
	console.log(`[llm-wiki-agent/server] listening on http://${HOST}:${info.port}`);
	console.log(`  GET    /api/health`);
	console.log(`  POST   /api/echo`);
	console.log(`  POST   /api/prompt`);
	console.log(`  GET    /api/knowledge-bases`);
	console.log(`  POST   /api/knowledge-bases/external`);
	console.log(`  DELETE /api/knowledge-bases/external`);
	console.log(`  GET    /api/knowledge-base`);
	console.log(`  POST   /api/knowledge-base`);
	console.log(`  DELETE /api/knowledge-base`);
	console.log(`  GET    /api/conversations?kb=<path>`);
	console.log(`  POST   /api/conversations`);
	console.log(`  POST   /api/conversations/new`);
	console.log(`  GET    /api/artifacts?conversation=<id>`);
	console.log(`  GET    /api/artifacts/:id`);
	console.log(`  GET    /api/artifacts/:id/files/:filename`);
	console.log(`  GET    /api/config`);
	console.log(`  POST   /api/config`);
});
