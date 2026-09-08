// src/services/ocr-cli.ts
/** ocr CLI runner（@alibaba-group/open-code-review 命令行）：二进制定位、探活、执行与托管 provider 配置。
 * 踩坑警告：插件进程 PATH 常缺 npm 全局 bin 目录，不能裸依赖 PATH 找 ocr（社区方案踩过）——
 * 故按常见 npm 全局 bin 目录逐个探测并进程内缓存定位结果。 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export const OCR_PACKAGE = '@alibaba-group/open-code-review';
export const OCR_MANAGED_PROVIDER_NAME = 'dsh-managed';
export const INSTALL_GUIDANCE = [
    `未检测到 ocr CLI（${OCR_PACKAGE}）。`,
    `请二选一安装：在 GUI 配置面板点击「安装 ocr」按钮；或在终端执行 \`npm install -g ${OCR_PACKAGE}\`。`,
    '安装后执行 `ocr --version` 验证。',
    '托管模式下 ocr 的模型 provider 由本插件统一接管配置，无需手工登录。',
].join('');
const BIN_NAME = 'ocr';
/** 常见 npm 全局 bin 目录：nvm current 为跨版本软链，homebrew/local 前缀按平台惯例全覆盖 */
const scanBinDirs = (home) => [
    join(home, '.nvm', 'current', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.local', 'bin'),
];
/** 进程内缓存按 homedir 隔离，避免注入不同 home 时串路径；命中后仍需 existsSync 复核（文件可能已被删）。 */
let cached = null;
function resolveBin(deps = {}) {
    const env = deps.env ?? process.env;
    const fromEnv = env.OCR_OCR_BIN;
    if (fromEnv)
        return fromEnv; // 显式指定优先，不进缓存
    const home = deps.homedirFn ? deps.homedirFn() : homedir();
    if (cached && cached.homedir === home && existsSync(cached.binPath))
        return cached.binPath;
    for (const dir of scanBinDirs(home)) {
        const candidate = join(dir, BIN_NAME);
        if (existsSync(candidate)) {
            cached = { homedir: home, binPath: candidate };
            return candidate;
        }
    }
    return null; // 未命中不缓存，留待下次重扫
}
export async function probeOcr(deps = {}) {
    const binPath = resolveBin(deps);
    if (!binPath)
        return { installed: false, version: '', binPath: null };
    try {
        const run = promisify(deps.execFileFn ?? execFile);
        // 始终传 options 对象：保持 (bin, args, opts, cb) 四参调用形态，promisify 包装的回调式 fake/真实现均兼容
        const { stdout } = await run(binPath, ['--version'], {});
        return { installed: true, version: stdout.split('\n')[0].trim(), binPath };
    }
    catch {
        // 探活失败（含 ENOENT）：定位结果仍保留，供上层展示/诊断
        return { installed: false, version: '', binPath };
    }
}
export async function runOcr(args, opts, deps = {}) {
    const binPath = resolveBin(deps);
    if (!binPath)
        return { stdout: '', stderr: INSTALL_GUIDANCE, error: 'ocr-not-installed' };
    const run = promisify(deps.execFileFn ?? execFile);
    try {
        const { stdout, stderr } = await run(binPath, args, {
            cwd: opts.cwd,
            timeout: opts.timeoutMs ?? 600_000,
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
        });
        return { stdout, stderr };
    }
    catch (err) {
        // 绝不抛出：非零退出/超时/ENOENT 统一转结果对象（promisify 拒因自带 stdout/stderr）
        const e = err;
        return {
            stdout: typeof e.stdout === 'string' ? e.stdout : '',
            stderr: typeof e.stderr === 'string' ? e.stderr : '',
            error: e.message ?? String(err),
        };
    }
}
export function managedProviderReady(deps = {}) {
    try {
        const home = deps.homedirFn ? deps.homedirFn() : homedir();
        const cfg = JSON.parse(readFileSync(join(home, '.opencodereview', 'config.json'), 'utf8'));
        return cfg.provider === OCR_MANAGED_PROVIDER_NAME && typeof cfg.model === 'string' && cfg.model.length > 0;
    }
    catch {
        return false; // 文件不存在/解析失败/字段缺失一律视为未就绪
    }
}
export async function wireManagedProvider(a, deps = {}) {
    // ocr 官方非交互配置：五组 config set 按序写入自定义 provider
    const steps = [
        ['provider', ['config', 'set', 'provider', OCR_MANAGED_PROVIDER_NAME]],
        ['model', ['config', 'set', 'model', a.model]],
        ['providers.dsh-managed.url', ['config', 'set', 'providers.dsh-managed.url', a.baseUrl]],
        ['providers.dsh-managed.protocol', ['config', 'set', 'providers.dsh-managed.protocol', a.protocol]],
        ['providers.dsh-managed.api_key', ['config', 'set', 'providers.dsh-managed.api_key', a.apiKey]],
    ];
    const home = deps.homedirFn ? deps.homedirFn() : homedir();
    for (const [name, args] of steps) {
        const r = await runOcr(args, { cwd: home, timeoutMs: 120_000 }, deps);
        if (r.error)
            return { ok: false, log: `config set ${name} 失败: ${r.error} ${r.stderr.slice(0, 500)}`.trim() };
    }
    return { ok: true, log: 'ocr managed provider wired: dsh-managed' };
}
