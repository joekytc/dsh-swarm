// tests/services/ocr-cli.test.ts
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OCR_PACKAGE,
  OCR_MANAGED_PROVIDER_NAME,
  INSTALL_GUIDANCE,
  probeOcr,
  runOcr,
  managedProviderReady,
  wireManagedProvider,
} from '../../src/services/ocr-cli.js';

type ExecCb = (
  err: (Error & { stdout?: string; stderr?: string }) | null,
  out?: { stdout: string; stderr: string },
) => void;

/** 真 execFile 是回调风格（实现侧经 promisify 包装），fake 必须提供回调签名才兼容 promisify。 */
const fakeExec = (handler: (bin: string, args: readonly string[], opts: unknown, cb: ExecCb) => void) =>
  ((bin: unknown, args: unknown, opts: unknown, cb: ExecCb) => {
    handler(bin as string, args as readonly string[], opts, cb);
  }) as unknown as typeof execFile;

const tmpHome = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe('probeOcr', () => {
  it('env OCR_OCR_BIN 优先定位且 --version 探活成功（取 stdout 首行）', async () => {
    const bin = join(tmpHome('ocr-cli-bin-'), 'ocr');
    const calls: string[][] = [];
    const r = await probeOcr({
      env: { OCR_OCR_BIN: bin },
      execFileFn: fakeExec((b, args, _o, cb) => {
        calls.push([b, ...args]);
        cb(null, { stdout: 'ocr 1.2.3\nmore\n', stderr: '' });
      }),
    });
    expect(r).toEqual({ installed: true, version: 'ocr 1.2.3', binPath: bin });
    expect(calls).toEqual([[bin, '--version']]);
  });

  it('定位不到 → installed=false 且 binPath=null', async () => {
    const home = tmpHome('ocr-cli-none-');
    const r = await probeOcr({ env: {}, homedirFn: () => home });
    expect(r).toEqual({ installed: false, version: '', binPath: null });
  });

  it('--version 探活抛错（含 ENOENT）→ installed=false 且保留 binPath', async () => {
    const bin = join(tmpHome('ocr-cli-enoent-'), 'ocr');
    const r = await probeOcr({
      env: { OCR_OCR_BIN: bin },
      execFileFn: fakeExec((_b, _a, _o, cb) => cb(Object.assign(new Error('ENOENT'), { stdout: '', stderr: '' }))),
    });
    expect(r).toEqual({ installed: false, version: '', binPath: bin });
  });

  it('扫描定位按 homedir 隔离缓存，不同 home 不串路径', async () => {
    const home1 = tmpHome('ocr-cache-a-');
    mkdirSync(join(home1, '.local', 'bin'), { recursive: true });
    const ocrPath = join(home1, '.local', 'bin', 'ocr');
    writeFileSync(ocrPath, '#!/bin/sh\n');
    const fake = fakeExec((_b, _a, _o, cb) => cb(null, { stdout: 'v1\n', stderr: '' }));
    const hit = await probeOcr({ env: {}, homedirFn: () => home1, execFileFn: fake });
    expect(hit).toEqual({ installed: true, version: 'v1', binPath: ocrPath });
    const home2 = tmpHome('ocr-cache-b-');
    const miss = await probeOcr({ env: {}, homedirFn: () => home2, execFileFn: fake });
    expect(miss).toEqual({ installed: false, version: '', binPath: null });
  });

  // 回归：GUI 安装成功但状态仍判未安装——标准 nvm 布局是 versions/node/<ver>/bin，而非 current 软链
  it('标准 nvm versions 布局（无 current 软链）→ 定位成功', async () => {
    const home = tmpHome('ocr-nvm-layout-');
    const ocrPath = join(home, '.nvm', 'versions', 'node', 'v22.22.2', 'bin', 'ocr');
    mkdirSync(join(ocrPath, '..'), { recursive: true });
    writeFileSync(ocrPath, '#!/bin/sh\n');
    const fake = fakeExec((_b, _a, _o, cb) => cb(null, { stdout: 'ocr 0.4.2\n', stderr: '' }));
    const r = await probeOcr({ env: {}, homedirFn: () => home, execFileFn: fake });
    expect(r).toEqual({ installed: true, version: 'ocr 0.4.2', binPath: ocrPath });
  });

  it('多版本共存 → 按版本号数值序取最新（非字符串序）', async () => {
    const home = tmpHome('ocr-nvm-multi-');
    const newDir = join(home, '.nvm', 'versions', 'node', 'v22.22.2', 'bin');
    const oldDir = join(home, '.nvm', 'versions', 'node', 'v9.1.0', 'bin');
    mkdirSync(newDir, { recursive: true });
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(newDir, 'ocr'), '#!/bin/sh\n');
    writeFileSync(join(oldDir, 'ocr'), '#!/bin/sh\n');
    const fake = fakeExec((_b, _a, _o, cb) => cb(null, { stdout: 'new\n', stderr: '' }));
    const r = await probeOcr({ env: {}, homedirFn: () => home, execFileFn: fake });
    expect(r.binPath).toBe(join(newDir, 'ocr'));
  });

  it('PATH 环境目录兜底定位（home 下无任何 nvm/固定目录）', async () => {
    const home = tmpHome('ocr-path-home-');
    const pathDir = tmpHome('ocr-path-bin-');
    const ocrPath = join(pathDir, 'ocr');
    writeFileSync(ocrPath, '#!/bin/sh\n');
    const fake = fakeExec((_b, _a, _o, cb) => cb(null, { stdout: 'via-path\n', stderr: '' }));
    const r = await probeOcr({ env: { PATH: pathDir }, homedirFn: () => home, execFileFn: fake });
    expect(r).toEqual({ installed: true, version: 'via-path', binPath: ocrPath });
  });
});

describe('runOcr', () => {
  it('透传 args 并返回 stdout/stderr，默认 opts 含 cwd/超时/缓冲上限/windowsHide', async () => {
    const bin = join(tmpHome('ocr-run-bin-'), 'ocr');
    const seen: { bin: string; args: readonly string[]; opts: Record<string, unknown> }[] = [];
    const r = await runOcr(['chat', '--flag'], { cwd: '/tmp/wd' }, {
      env: { OCR_OCR_BIN: bin },
      execFileFn: fakeExec((b, args, opts, cb) => {
        seen.push({ bin: b, args, opts: opts as Record<string, unknown> });
        cb(null, { stdout: 'hello\n', stderr: 'warn\n' });
      }),
    });
    expect(r).toEqual({ stdout: 'hello\n', stderr: 'warn\n' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.bin).toBe(bin);
    expect(seen[0]!.args).toEqual(['chat', '--flag']);
    expect(seen[0]!.opts).toMatchObject({
      cwd: '/tmp/wd',
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  });

  it('执行抛错 → 绝不抛出，error 含消息且 stdout 保留 err.stdout', async () => {
    const bin = join(tmpHome('ocr-run-err-'), 'ocr');
    const r = await runOcr(['x'], { cwd: '/tmp' }, {
      env: { OCR_OCR_BIN: bin },
      execFileFn: fakeExec((_b, _a, _o, cb) =>
        cb(Object.assign(new Error('boom'), { stdout: 'partial-out', stderr: 'partial-err' }))),
    });
    expect(r.error).toBe('boom');
    expect(r.stdout).toBe('partial-out');
    expect(r.stderr).toBe('partial-err');
  });

  it('定位失败 → error=ocr-not-installed 且 stderr 为安装指引', async () => {
    const home = tmpHome('ocr-run-none-');
    const r = await runOcr(['x'], { cwd: home }, { env: {}, homedirFn: () => home });
    expect(r).toEqual({ stdout: '', stderr: INSTALL_GUIDANCE, error: 'ocr-not-installed' });
    expect(INSTALL_GUIDANCE).toContain('npm install -g');
    expect(INSTALL_GUIDANCE).toContain(OCR_PACKAGE);
    expect(INSTALL_GUIDANCE).toContain('ocr --version');
  });
});

describe('managedProviderReady', () => {
  const withConfig = (content: string | null): { env: NodeJS.ProcessEnv; homedirFn: () => string } => {
    const home = tmpHome('ocr-ready-');
    if (content !== null) {
      mkdirSync(join(home, '.opencodereview'), { recursive: true });
      writeFileSync(join(home, '.opencodereview', 'config.json'), content);
    }
    return { env: {}, homedirFn: () => home };
  };

  it('provider=dsh-managed 且 model 非空 → true', () => {
    const deps = withConfig(JSON.stringify({ provider: OCR_MANAGED_PROVIDER_NAME, model: 'glm-5' }));
    expect(managedProviderReady(deps)).toBe(true);
  });

  it('provider 为其他值 → false', () => {
    const deps = withConfig(JSON.stringify({ provider: 'official', model: 'glm-5' }));
    expect(managedProviderReady(deps)).toBe(false);
  });

  it('model 为空串 → false', () => {
    const deps = withConfig(JSON.stringify({ provider: OCR_MANAGED_PROVIDER_NAME, model: '' }));
    expect(managedProviderReady(deps)).toBe(false);
  });

  it('配置文件不存在 → false', () => {
    const deps = withConfig(null);
    expect(managedProviderReady(deps)).toBe(false);
  });

  it('JSON 解析失败 → false', () => {
    const deps = withConfig('not-json{');
    expect(managedProviderReady(deps)).toBe(false);
  });
});

describe('wireManagedProvider', () => {
  const input = { baseUrl: 'https://gw.example.com/v1', protocol: 'openai' as const, apiKey: 'sk-test', model: 'glm-5' };

  it('五组 config set 依次执行且全部成功 → ok=true', async () => {
    const calls: { args: readonly string[]; opts: Record<string, unknown> }[] = [];
    const r = await wireManagedProvider(input, {
      env: { OCR_OCR_BIN: '/fake-ocr' },
      execFileFn: fakeExec((_b, args, opts, cb) => {
        calls.push({ args, opts: opts as Record<string, unknown> });
        cb(null, { stdout: '', stderr: '' });
      }),
    });
    expect(r).toEqual({ ok: true, log: 'ocr managed provider wired: dsh-managed' });
    expect(calls.map((c) => c.args)).toEqual([
      ['config', 'set', 'provider', 'dsh-managed'],
      ['config', 'set', 'model', 'glm-5'],
      ['config', 'set', 'providers.dsh-managed.url', 'https://gw.example.com/v1'],
      ['config', 'set', 'providers.dsh-managed.protocol', 'openai'],
      ['config', 'set', 'providers.dsh-managed.api_key', 'sk-test'],
    ]);
    expect(calls[0]!.opts).toMatchObject({ timeout: 120_000 });
  });

  it('第 3 步失败 → ok=false，后续两步未执行，log 含步骤名/error/stderr 截 500', async () => {
    const calls: string[][] = [];
    const r = await wireManagedProvider(input, {
      env: { OCR_OCR_BIN: '/fake-ocr' },
      execFileFn: fakeExec((_b, args, _o, cb) => {
        calls.push([...args]);
        if (args[2] === 'providers.dsh-managed.url') {
          cb(Object.assign(new Error('bad-gw'), { stdout: '', stderr: 'refused-' + 'x'.repeat(600) }));
        } else {
          cb(null, { stdout: '', stderr: '' });
        }
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.log).toContain('providers.dsh-managed.url');
    expect(r.log).toContain('bad-gw');
    expect(r.log).toContain('refused');
    expect(r.log.length).toBeLessThan(600);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual(['config', 'set', 'providers.dsh-managed.url', 'https://gw.example.com/v1']);
  });
});
