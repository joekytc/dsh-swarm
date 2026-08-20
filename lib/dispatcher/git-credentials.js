// src/dispatcher/git-credentials.ts
import { execFileSync } from 'node:child_process';
/**
 * R20 D(execute) git 凭据注入（M4）：使 D 会话的 git ls-remote/push 可用。
 *
 * 机制：D 会话的 bash 每次调用都是新 shell（无环境持久），故 env 变量不可跨调用。
 * 采用 repo-local http extraheader（AUTHORIZATION: basic），写入 <repo>/.git/config——
 * 持久跨 bash 调用、由插件进程（web app 侧，不受 D 会话沙箱限制）注入。
 *
 * 鉴权按托管方区分：
 * - GitLab PAT（glpat- 前缀）→ basic base64("oauth2:<PAT>")（GitLab 规范，实测 ls-remote 通过）；
 * - 其余（GitHub 等）→ basic base64("x-access-token:<PAT>")。
 * D 会话为 danger-full-access（用户决策 Q4），HOME 可写，故 git 的 credential.helper
 * （store/osxkeychain 等）不再触发 "credential storage lock"，无需中和。
 *
 * PAT 来源（按优先级）：DSH 凭据服务 ctx.credentials（$DSH_HOME/.credentials.yaml 的
 * KANBAN_GIT_PAT/GIT_PAT）→ 进程 env（KANBAN_GIT_PAT > GIT_PAT > GH_TOKEN > GITHUB_TOKEN）。
 * 未配置 PAT 时不注入（回退用户已有 git 凭据/SSH）。
 */
/** D 会话可用 git PAT 的 env 变量名（按优先级）。 */
export const GIT_PAT_ENV_NAMES = ['KANBAN_GIT_PAT', 'GIT_PAT', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** 从进程 env 解析非空 PAT；无则返回 null。 */
export function resolveGitPat(env) {
    for (const name of GIT_PAT_ENV_NAMES) {
        const v = env[name];
        if (v && v.trim())
            return v.trim();
    }
    return null;
}
/** 经 DSH 凭据服务解析 PAT（$DSH_HOME/.credentials.yaml / env / .env，见 dsh-credentials-local 分层）；无则回退进程 env。 */
export async function resolveGitPatFromCtx(ctx, env) {
    const creds = ctx.get?.('credentials');
    if (creds?.resolve) {
        for (const name of GIT_PAT_ENV_NAMES) {
            try {
                const r = await creds.resolve(name);
                if (r?.value && r.value.trim())
                    return r.value.trim();
            }
            catch { /* 单个引用解析失败继续下一个 */ }
        }
    }
    return resolveGitPat(env);
}
/** PAT → http extraheader 值：GitLab(glpat-*) 用 oauth2 前缀，其余 x-access-token。 */
export function gitAuthHeader(pat) {
    const prefix = pat.startsWith('glpat-') ? 'oauth2:' : 'x-access-token:';
    return 'AUTHORIZATION: basic ' + Buffer.from(prefix + pat).toString('base64');
}
/**
 * 注入 repo-local http extraheader。返回 { ok, detail }（失败不抛——注入失败仅告警，
 * D 仍可执行；用户自带凭据/SSH 的仓库不受影响）。
 */
export function injectGitCredentials(repoDir, pat) {
    const targets = [];
    try {
        const url = execFileSync('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
        if (url.startsWith('http://') || url.startsWith('https://'))
            targets.push(url);
    }
    catch {
        // 非 git 仓库或无 origin：注入目标为空
    }
    if (targets.length === 0)
        return { ok: false, detail: 'no http remote origin' };
    try {
        const header = gitAuthHeader(pat);
        for (const target of targets) {
            // git config <section>.<subsection>.<variable>：http.<url>.extraheader
            execFileSync('git', ['-C', repoDir, 'config', '--local', `http.${target}.extraheader`, header]);
        }
        return { ok: true, detail: targets.join(',') };
    }
    catch (err) {
        return { ok: false, detail: String(err) };
    }
}
