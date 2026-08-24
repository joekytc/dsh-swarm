import { KanbanProvider } from './services/kanban-provider.js';
import { Config } from './config.js';
import { registerMainSessionTools } from './tools/main-session-tools.js';
import { installRolePresets } from './roles/preset-installer.js';
import { registerKanbanHttp } from './routes/kanban-http.js';
import { startDispatcher } from './dispatcher/dispatcher.js';
export const name = 'dsh-swarm';
export { Config };
// P1-9：无 inject——KanbanProvider 只用文件系统（FileEventStore），不依赖 ctx.storage 等任何服务。
/** 可选服务延迟装配：插件 apply 时各服务可能尚未提供（cordis 注入顺序），轮询 ctx.get 直至可用再接线。 */
function wireWhenAvailable(ctx, name, fn, timeoutMs = 60000) {
    if (ctx.get(name)) {
        fn();
        return () => { };
    }
    const timer = setInterval(() => {
        if (ctx.get(name)) {
            clearInterval(timer);
            clearTimeout(to);
            fn();
        }
    }, 500);
    const to = setTimeout(() => clearInterval(timer), timeoutMs);
    return () => { clearInterval(timer); clearTimeout(to); };
}
/** 等待多个服务同时可用后再接线（如 tools 先于 kanban 出现时，单服务轮询会过早执行）。 */
function wireAllAvailable(ctx, names, fn, timeoutMs = 60000) {
    const ready = () => names.every((name) => Boolean(ctx.get(name)));
    if (ready()) {
        fn();
        return () => { };
    }
    const timer = setInterval(() => {
        if (ready()) {
            clearInterval(timer);
            clearTimeout(to);
            fn();
        }
    }, 500);
    const to = setTimeout(() => clearInterval(timer), timeoutMs);
    return () => { clearInterval(timer); clearTimeout(to); };
}
export function apply(ctx, config) {
    // cordis 4：Service 构造即注册（super(ctx,'kanban') 调 ctx.reflect.provide），无需手动 provide。
    const provider = new KanbanProvider(ctx, config);
    // D22：把包内角色裁剪 preset 组合安装到 $DSH_HOME/.agent-presets/（真实 API 下唯一可发现的自定义根）。
    const installed = installRolePresets();
    console.info('[dsh-swarm] role presets installed: ' + (installed.length ? installed.join(',') : 'none'));
    // 可选服务接线均延迟到服务可用后：
    // - Web GUI 数据桥（GET /kanban/board + POST /kanban/action，仅 webServer 存在时挂载）
    wireWhenAvailable(ctx, 'webServer', () => registerKanbanHttp(ctx, provider, config));
    // - P1-3 主会话工具面（spec_card_view/edit/approve + kanban 只读子集 + 前缀路由工具）
    wireAllAvailable(ctx, ['tools', 'kanban'], () => registerMainSessionTools(ctx, config));
    // - 调度层：事件唤醒 V（R20）+ 每任务 agent runner + 看门狗（仅 agents 可用时启动）
    wireAllAvailable(ctx, ['agents', 'kanban'], () => startDispatcher(ctx, config));
}
