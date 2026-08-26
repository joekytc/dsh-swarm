import { describe, it, expect } from 'vitest';
import { isTestFile, isTestableSource } from '../../src/domain/tdd-classify.js';

describe('isTestFile', () => {
  it('识别 *.test.* / *.spec.* / __tests__/ / tests/ 为测试文件', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/b.spec.jsx')).toBe(true);
    expect(isTestFile('src/__tests__/c.js')).toBe(true);
    expect(isTestFile('tests/util.test.vue')).toBe(true);
    expect(isTestFile('src/App.vue')).toBe(false);
    expect(isTestFile('src/index.ts')).toBe(false);
    expect(isTestFile('package.json')).toBe(false);
  });
});

describe('isTestableSource', () => {
  it('ts/tsx/js/jsx/vue 等为需测试源码；测试文件/文档/配置不是', () => {
    expect(isTestableSource('src/App.vue')).toBe(true);
    expect(isTestableSource('src/App.jsx')).toBe(true);
    expect(isTestableSource('src/util.js')).toBe(true);
    expect(isTestableSource('src/App.tsx')).toBe(true);
    expect(isTestableSource('src/a.test.ts')).toBe(false); // 测试文件不算源码
    expect(isTestableSource('README.md')).toBe(false);
    expect(isTestableSource('package.json')).toBe(false);
    expect(isTestableSource('src/a.css')).toBe(false);
  });
});
