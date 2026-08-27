// src/domain/memory.ts
// 记忆层领域纯函数（无 @deepseek-ai/* import）：learnings 数据模型 + 索引块 + 加权排序 + repoSlug。
import type { BoardState } from './types.js';
import { buildChecklistSlug } from '../wiki/page-path.js';

export interface LearningEntry {
  title: string;    // 一句话经验，≤80 字符
  lesson: string;   // 教训正文（非空）
  evidence: string; // 证据：chain/task id 或会话引用（非空，防编造）
  tags: string[];   // 自由形式字符串数组，可空；仅校验形态
}

export function validateLearning(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['learning must be an object'];
  const l = raw as Record<string, unknown>;
  for (const [label, key] of [['title', 'title'], ['lesson', 'lesson'], ['evidence', 'evidence']] as const) {
    if (typeof l[key] !== 'string' || (l[key] as string).trim().length === 0) errors.push(`learning.${label} must be a non-empty string`);
  }
  if (typeof l['title'] === 'string' && l['title'].length > 80) errors.push('learning.title must be <= 80 chars');
  if (l['tags'] !== undefined && !Array.isArray(l['tags'])) errors.push('learning.tags must be an array of strings');
  if (Array.isArray(l['tags']) && (l['tags'] as unknown[]).some((v) => typeof v !== 'string')) errors.push('learning.tags must be an array of strings');
  return errors;
}

export function formatLearningBody(entry: LearningEntry, created = new Date()): string {
  const date = created.toISOString().slice(0, 10);
  const lines: string[] = [
    '---',
    `title: "${entry.title}"`,
    'type: learning',
    entry.tags.length > 0 ? `tags: [${entry.tags.join(', ')}]` : 'tags: []',
    `created: ${date}`,
    '---',
    '',
    `# 【Learning】${entry.title}`,
    '',
    '## 教训',
    entry.lesson,
    '',
    '## 证据',
    entry.evidence,
  ];
  if (entry.tags.length > 0) lines.push('', '## 适用场景', ...entry.tags.map((t) => `- ${t}`));
  return lines.join('\n');
}

export interface MemoryIndexEntry { kind: 'learning' | 'doc'; title: string; path: string; }

export function buildMemoryIndexBlock(entries: MemoryIndexEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines: string[] = ['## KB 记忆索引（自动注入）'];
  for (const e of entries) {
    const title = e.title.length > 60 ? e.title.slice(0, 60) + '…' : e.title;
    lines.push(`- ${e.kind === 'learning' ? 'Learning' : '清单/计划/结果'}：[#/page/${e.path}](#/page/${e.path}) ${title}`);
  }
  lines.push('（需全文调 planning_memory_recall）');
  return lines.join('\n');
}

export function weightedRank<T>(items: T[], scoreOf: (t: T) => number, timeOf: (t: T) => number): T[] {
  if (items.length === 0) return items;
  const scores = items.map(scoreOf);
  const times = items.map(timeOf);
  const sMin = Math.min(...scores), sMax = Math.max(...scores);
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const sRange = sMax - sMin || 1;
  const tRange = tMax - tMin || 1;
  const rank = (x: T) => 0.7 * ((scoreOf(x) - sMin) / sRange) + 0.3 * ((timeOf(x) - tMin) / tRange);
  return [...items].sort((a, b) => rank(b) - rank(a));
}

export function buildRepoSlug(workspaceDir: string): string {
  const base = workspaceDir.replace(/\/+$/, '').split('/').pop() ?? '';
  return buildChecklistSlug(base);
}

// buildLearningBrief / resolveLearningChainId 由 Task 4 追加（引用 BoardState）
export type { BoardState };
