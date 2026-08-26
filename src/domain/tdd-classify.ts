// src/domain/tdd-classify.ts
/** 需测试的源码扩展名（TDD 硬要求判定口径：含 js/jsx/vue）。 */
const TESTABLE_SOURCE_EXT: ReadonlySet<string> = new Set(['ts', 'tsx', 'js', 'jsx', 'vue', 'rs', 'py', 'go', 'java']);

export function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

/** 命中 *.test.* / *.spec.* / __tests__/ / tests/ 即测试文件。 */
export function isTestFile(path: string): boolean {
  const base = path.split('/').pop() ?? '';
  if (/(\.test\.|\.spec\.)/i.test(base)) return true;
  if (/__tests__\//.test(path) || /(^|\/)tests\//.test(path)) return true;
  return false;
}

/** 需测试的源码：非测试文件且扩展名在约定集合内。 */
export function isTestableSource(path: string): boolean {
  return !isTestFile(path) && TESTABLE_SOURCE_EXT.has(extOf(path));
}
