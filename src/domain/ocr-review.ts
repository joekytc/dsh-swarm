// src/domain/ocr-review.ts
/** OCR 委派子命令类型：预览 / 规则 / 托管评审。 */
export type OcrSub = 'preview' | 'rule' | 'managed';

/** OCR 调用可选参数集合。 */
export interface OcrArgsInput {
  repo?: string;
  from?: string;
  to?: string;
  commit?: string;
  paths?: string[];
}

/** 构造 OCR CLI 参数：preview/rule 走 delegate，managed 走 review 并恒带 JSON 输出。 */
export function buildOcrArgs(sub: OcrSub, a: OcrArgsInput): string[] {
  if (sub === 'preview') {
    const args = ['delegate', 'preview'];
    if (a.from) args.push('--from', a.from);
    if (a.to) args.push('--to', a.to);
    if (a.repo) args.push('--repo', a.repo);
    return args;
  }
  if (sub === 'rule') {
    return ['delegate', 'rule', ...(a.paths ?? [])];
  }
  const args = ['review'];
  if (a.commit) args.push('--commit', a.commit);
  else if (a.from || a.to) {
    if (a.from) args.push('--from', a.from);
    if (a.to) args.push('--to', a.to);
  }
  args.push('--format', 'json');
  return args;
}

/** 预览结果归一化结构。 */
export interface PreviewResult {
  mode: string;
  files: { path: string; status: string }[];
  excluded: { path: string; reason: string }[];
  mergeBase: string | null;
}

/** 解析失败的兜底结果。 */
const UNKNOWN_PREVIEW: PreviewResult = { mode: 'unknown', files: [], excluded: [], mergeBase: null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 元素字段别名读取（path/filePath）。 */
function pathOf(el: Record<string, unknown>): string {
  return String(el.path ?? el.filePath ?? '');
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

/** 解析 delegate preview 的 JSON 输出，失败或结构异常时回退 unknown。 */
export function parsePreviewJson(stdout: string): PreviewResult {
  let obj: unknown;
  try {
    obj = JSON.parse(stdout);
  } catch {
    return UNKNOWN_PREVIEW;
  }
  if (!isRecord(obj)) return UNKNOWN_PREVIEW;
  const mergeBase = obj.merge_base ?? obj.mergeBase;
  return {
    mode: String(obj.mode ?? 'unknown'),
    files: asArray(obj.files).map((el) => ({ path: pathOf(el), status: String(el.status ?? '') })),
    excluded: asArray(obj.excluded).map((el) => ({ path: pathOf(el), reason: String(el.reason ?? '') })),
    mergeBase: mergeBase == null ? null : String(mergeBase),
  };
}

/** 托管评审结果归一化结构。 */
export interface ManagedResult {
  status: string;
  comments: { path: string | null; line: number | null; severity: string | null; message: string }[];
}

/** 解析 managed review 的 JSON 输出，失败时回退 unknown。 */
export function parseManagedJson(stdout: string): ManagedResult {
  let obj: unknown;
  try {
    obj = JSON.parse(stdout);
  } catch {
    return { status: 'unknown', comments: [] };
  }
  if (!isRecord(obj)) return { status: 'unknown', comments: [] };
  const comments = asArray(obj.comments).map((el) => {
    const rawLine = el.line ?? el.startLine;
    const line = Number(rawLine);
    const message = String(el.content ?? el.message ?? el.body ?? '');
    return {
      path: el.path == null && el.filePath == null ? null : pathOf(el),
      line: Number.isNaN(line) ? null : line,
      severity: el.severity == null && el.level == null ? null : String(el.severity ?? el.level),
      message: message.slice(0, 2000),
    };
  });
  return { status: String(obj.status ?? 'unknown'), comments };
}

/** 建议切换托管评审的文件数阈值。 */
export const SUGGEST_MANAGED_FILES = 50;

/** 文件数严格超过阈值时建议托管评审。 */
export function shouldSuggestManaged(fileCount: number): boolean {
  return fileCount > SUGGEST_MANAGED_FILES;
}

/** 评审主题清洗：小写化，非字母数字连续折叠为 -，去首尾 -，空则回退 review。 */
function sanitizeTopic(topic: string): string {
  const cleaned = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'review';
}

/** 生成独立评审页命名空间路径：projects/<slug>/reviews/<topic>-<ymd>/。 */
export function reviewPagePath(repoSlug: string, topic: string, ymd: string): string {
  return `projects/${repoSlug}/reviews/${sanitizeTopic(topic)}-${ymd}/`;
}

/** 独立评审页命名空间路径匹配规则。 */
const REVIEW_NS_RE = /^projects\/[a-z0-9-]+\/reviews\/[a-z0-9-]+-[0-9]{4}-[0-9]{2}-[0-9]{2}\//;

/** 判定路径是否为合法的独立评审页命名空间路径。 */
export function isStandaloneReviewNamespacePath(pagePath: string): boolean {
  if (!pagePath || pagePath.startsWith('/') || pagePath.includes('..')) return false;
  return REVIEW_NS_RE.test(pagePath);
}
