/**
 * config.ts - llm-wiki-agent 自身的应用配置
 *
 * 位置：~/.llm-wiki-agent/config.json
 * 内容：UI 偏好、外部知识库登记、默认模型等（**绝不**含 API key —— ADR-13）
 *
 * 设计：
 *   - 文件缺失：返回默认值，不写盘（等真有内容要存再写）
 *   - 文件损坏：抛错，不静默覆盖用户数据
 *   - 写入：原子（先 .tmp 再 rename）
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const APP_DIR = join(homedir(), ".llm-wiki-agent");
export const DEFAULT_KNOWLEDGE_BASE_ROOT = join(homedir(), "llm-wiki");

const CONFIG_FILE = join(APP_DIR, "config.json");

export interface AppConfig {
	version: 1;
	externalKnowledgeBases: string[];
	/** 最后一次使用的 KB 绝对路径。下次启动用于自动恢复（PRODUCT.md §5.1.1）。 */
	lastUsedKbPath?: string;
	showUserGlobalSkills?: boolean;
	modelRoles?: {
		main?: ModelRef | null;
		digest?: ModelRef | null;
	};
	uiPrefs?: {
		sidebarExpandedKbs?: string[];
	};
}

export interface ModelRef {
	provider: string;
	modelId: string;
}

const DEFAULT_CONFIG: AppConfig = {
	version: 1,
	externalKnowledgeBases: [],
};

export async function loadConfig(): Promise<AppConfig> {
	let raw: string;
	try {
		raw = await readFile(CONFIG_FILE, "utf8");
	} catch (err) {
		if (isNotFound(err)) return { ...DEFAULT_CONFIG };
		throw new Error(`读取 ${CONFIG_FILE} 失败：${(err as Error).message}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`${CONFIG_FILE} 格式损坏（不是合法 JSON），请手动修复或删除：${(err as Error).message}`,
		);
	}

	return normalize(parsed);
}

export async function saveConfig(config: AppConfig): Promise<void> {
	await mkdir(dirname(CONFIG_FILE), { recursive: true });
	const tmp = `${CONFIG_FILE}.tmp`;
	await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	await rename(tmp, CONFIG_FILE);
}

function normalize(raw: unknown): AppConfig {
	if (typeof raw !== "object" || raw === null) {
		throw new Error(`${CONFIG_FILE} 顶层不是对象`);
	}
	const obj = raw as Record<string, unknown>;
	const version = obj.version === 1 ? 1 : 1; // 当前只支持 v1，未来加迁移
	const external = Array.isArray(obj.externalKnowledgeBases)
		? obj.externalKnowledgeBases.filter((p): p is string => typeof p === "string")
		: [];
	const lastUsedKbPath =
		typeof obj.lastUsedKbPath === "string" && obj.lastUsedKbPath ? obj.lastUsedKbPath : undefined;
	const showUserGlobalSkills = obj.showUserGlobalSkills === true;
	const modelRoles = normalizeModelRoles(obj.modelRoles);
	const uiPrefs = normalizeUiPrefs(obj.uiPrefs);
	return {
		version,
		externalKnowledgeBases: external,
		lastUsedKbPath,
		showUserGlobalSkills,
		...(modelRoles ? { modelRoles } : {}),
		...(uiPrefs ? { uiPrefs } : {}),
	};
}

function normalizeModelRef(raw: unknown): ModelRef | null | undefined {
	if (raw === null) return null;
	if (typeof raw !== "object" || raw === undefined) return undefined;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.provider !== "string" || typeof obj.modelId !== "string") return undefined;
	if (!obj.provider.trim() || !obj.modelId.trim()) return undefined;
	return { provider: obj.provider.trim(), modelId: obj.modelId.trim() };
}

function normalizeModelRoles(raw: unknown): AppConfig["modelRoles"] | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const obj = raw as Record<string, unknown>;
	const main = normalizeModelRef(obj.main);
	const digest = normalizeModelRef(obj.digest);
	const result: NonNullable<AppConfig["modelRoles"]> = {};
	if (main !== undefined) result.main = main;
	if (digest !== undefined) result.digest = digest;
	return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeUiPrefs(raw: unknown): AppConfig["uiPrefs"] | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const obj = raw as Record<string, unknown>;
	const sidebarExpandedKbs = Array.isArray(obj.sidebarExpandedKbs)
		? obj.sidebarExpandedKbs.filter((value): value is string => typeof value === "string")
		: undefined;
	return sidebarExpandedKbs ? { sidebarExpandedKbs } : undefined;
}

function isNotFound(err: unknown): boolean {
	return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}
