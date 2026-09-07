import { execFile } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { DEFAULT_KNOWLEDGE_BASE_ROOT } from "./config.js";
import { expandUserPath, registerExternalKnowledgeBase } from "./knowledge-bases.js";

const execFileAsync = promisify(execFile);

export interface CreateWikiResult {
	name: string;
	path: string;
	stdout: string;
	stderr: string;
}

export interface InitExistingWikiResult {
	path: string;
	stdout: string;
	stderr: string;
	backedUpFiles: string[];
}

export class InitConflictError extends Error {
	statusCode = 409;
	constructor(public conflicts: string[]) {
		super(`目标目录已有将被初始化覆盖的文件：${conflicts.join(", ")}`);
	}
}

const INIT_WRITTEN_FILES = [
	".gitignore",
	".wiki-schema.md",
	"index.md",
	"log.md",
	path.join("wiki", "overview.md"),
	"purpose.md",
	".wiki-cache.json",
];

export function truncateOutput(text: string): string {
	return text.length > 4096 ? text.slice(0, 4096) + "\n...[truncated]" : text;
}

export function validateWikiName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("知识库名不能为空");
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("知识库名不能包含路径分隔符");
	}
	if (trimmed === "." || trimmed === "..") {
		throw new Error("知识库名不能是 . 或 ..");
	}
	return trimmed;
}

function assertInside(baseDir: string, target: string): void {
	const resolvedBase = path.resolve(baseDir);
	const resolvedTarget = path.resolve(target);
	if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
		throw new Error("目标路径不在默认知识库根目录内");
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	const info = await stat(filePath).catch(() => null);
	return Boolean(info?.isFile());
}

export function initScriptCandidates(homeDir = homedir()): string[] {
	const skillDirs = [
		path.join(homeDir, ".codex", "skills", "llm-wiki"),
		path.join(homeDir, ".codex", "skills", "llm-wiki-skill"),
		path.join(homeDir, ".claude", "skills", "llm-wiki-skill"),
		path.join(homeDir, ".claude", "skills", "llm-wiki"),
	];
	return skillDirs.flatMap((skillDir) => [
		path.join(skillDir, "init-wiki.sh"),
		path.join(skillDir, "scripts", "init-wiki.sh"),
	]);
}

async function findInitScript(): Promise<string | null> {
	const candidates = initScriptCandidates();
	for (const candidate of candidates) {
		if (await fileExists(candidate)) return candidate;
	}
	return null;
}

export async function createWiki(nameInput: string, purposeInput: string): Promise<CreateWikiResult> {
	const name = validateWikiName(nameInput);
	const scriptPath = await findInitScript();
	if (!scriptPath) {
		throw new Error("llm-wiki 未安装。请先安装到 ~/.codex/skills/llm-wiki/ 或 ~/.claude/skills/llm-wiki-skill/。");
	}

	const targetPath = path.join(DEFAULT_KNOWLEDGE_BASE_ROOT, name);
	assertInside(DEFAULT_KNOWLEDGE_BASE_ROOT, targetPath);
	await mkdir(DEFAULT_KNOWLEDGE_BASE_ROOT, { recursive: true });

	const { stdout, stderr } = await execFileAsync(
		scriptPath,
		[targetPath, purposeInput.trim() || name, "中文"],
		{
			timeout: 60_000,
			env: {
				HOME: homedir(),
				PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
			},
			maxBuffer: 1024 * 1024,
		},
	);

	return {
		name,
		path: targetPath,
		stdout: truncateOutput(stdout),
		stderr: truncateOutput(stderr),
	};
}

export async function initExistingWiki(
	rawPath: string,
	purposeInput: string,
	overwrite = false,
): Promise<InitExistingWikiResult> {
	const absolutePath = path.resolve(expandUserPath(rawPath));
	const info = await stat(absolutePath).catch(() => null);
	if (!info?.isDirectory()) throw new Error(`目标路径不是目录：${absolutePath}`);

	const purpose = purposeInput.trim();
	if (!purpose) throw new Error("研究方向不能为空");

	const conflicts = await findInitConflicts(absolutePath);
	if (conflicts.length > 0 && !overwrite) {
		throw new InitConflictError(conflicts);
	}

	const backedUpFiles =
		conflicts.length > 0 ? await backupConflicts(absolutePath, conflicts) : [];
	const scriptPath = await findInitScript();
	if (!scriptPath) {
		throw new Error("llm-wiki 未安装。请先安装到 ~/.codex/skills/llm-wiki/ 或 ~/.claude/skills/llm-wiki-skill/。");
	}

	const { stdout, stderr } = await execFileAsync(scriptPath, [absolutePath, purpose, "中文"], {
		timeout: 60_000,
		env: {
			HOME: homedir(),
			PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
		},
		maxBuffer: 1024 * 1024,
	});

	await registerExternalKnowledgeBase(absolutePath);
	return {
		path: absolutePath,
		stdout: truncateOutput(stdout),
		stderr: truncateOutput(stderr),
		backedUpFiles,
	};
}

async function findInitConflicts(targetPath: string): Promise<string[]> {
	const conflicts: string[] = [];
	for (const relPath of INIT_WRITTEN_FILES) {
		const info = await stat(path.join(targetPath, relPath)).catch(() => null);
		if (info?.isFile()) conflicts.push(relPath);
	}
	return conflicts;
}

async function backupConflicts(targetPath: string, conflicts: string[]): Promise<string[]> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupRoot = path.join(targetPath, ".llm-wiki-agent-backup", timestamp);
	const backedUp: string[] = [];
	for (const relPath of conflicts) {
		const src = path.join(targetPath, relPath);
		const dest = path.join(backupRoot, relPath);
		await mkdir(path.dirname(dest), { recursive: true });
		await copyFile(src, dest);
		backedUp.push(dest);
	}
	return backedUp;
}
