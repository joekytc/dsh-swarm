// src/dispatcher/context-dedup.ts
/** buildContext 父链 metadata 注入瘦身（PR1 注入去重，纯函数）：
 * 1) review_evidence 整键剥离——issues 已由返工卡 body「本轮修复清单」单一信息源承载（P0-3）；
 * 2) 超长数组截断 20 条 + 计数尾注（changed_files 等）；超长字符串截断 2000 字符。
 * 防御性通用规则，不感知业务键语义；原 metadata 不修改。 */
const MAX_ARRAY = 20;
const MAX_STRING = 2000;

export function slimParentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'review_evidence') continue;
    if (Array.isArray(v)) {
      out[k] = v.length > MAX_ARRAY ? [...v.slice(0, MAX_ARRAY), `…(+${v.length - MAX_ARRAY} more)`] : v;
    } else if (typeof v === 'string' && v.length > MAX_STRING) {
      out[k] = v.slice(0, MAX_STRING) + '…(truncated)';
    } else {
      out[k] = v;
    }
  }
  return out;
}
