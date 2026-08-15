import { describe, it, expect, beforeAll } from 'vitest';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

describe('client bundle (ModuleLoader format)', () => {
  let exports: Record<string, unknown> | undefined;
  const registrations: Array<{ kind: string; key?: string; opts?: Record<string, unknown>; hasComponent?: boolean }> = [];

  beforeAll(async () => {
    const result = await build({
      entryPoints: [join(process.cwd(), 'client', 'index.ts')],
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      external: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-runtime/client', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-layout/client'],
      jsx: 'automatic',
      loader: { '.css': 'text' },
      write: false,
      target: 'es2020',
    });
    const code = result.outputFiles[0].text;
    // 模拟 client 模块系统：factory(require, module, exports) 执行 CJS 包体
    const factory = new Function('require', 'module', 'exports', code);
    const mod = { exports: {} };
    factory(require, mod, mod.exports);
    exports = mod.exports as Record<string, unknown>;
  });

  it('exports the client plugin contract (name/inject/apply)', () => {
    expect(exports?.name).toBe('kanban-board');
    expect(exports?.inject).toEqual(expect.arrayContaining(['slots']));
    expect(typeof exports?.apply).toBe('function');
  });

  it('apply registers the kanban board into conversation.view', () => {
    const fakeCtx = {
      slots: {
        inject(key: string, cb: () => () => void) {
          registrations.push({ kind: 'inject', key });
          expect(key).toBe('conversation.view');
          cb(); // 声明已存在 → 立即执行注册
          return () => {};
        },
        register(opts: Record<string, unknown>, comp: unknown) {
          registrations.push({ kind: 'register', opts, hasComponent: typeof comp === 'function' });
          return () => {};
        },
      },
    };
    (exports!.apply as (ctx: unknown) => void)(fakeCtx);
    expect(registrations.some((r) => r.kind === 'inject' && r.key === 'conversation.view')).toBe(true);
    const reg = registrations.find((r) => r.kind === 'register');
    expect(reg?.opts).toMatchObject({ name: 'conversation.view', id: 'kanban', order: 20, label: '看板' });
    expect(reg?.hasComponent).toBe(true);
    expect(registrations.some((row) => ['shell.overlay', 'sidebar', 'details'].some((n) => row.opts?.name === n))).toBe(false);
  });
});
