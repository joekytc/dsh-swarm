import { homedir } from 'node:os';
import { KanbanProvider } from './services/kanban-provider.js';
import { Config } from './config.js';
import { registerMainSessionTools } from './tools/main-session-tools.js';
import { installRolePresets } from './roles/preset-installer.js';
import { registerKanbanHttp } from './routes/kanban-http.js';
import { startDispatcher } from './dispatcher/dispatcher.js';
import { ConfigProvider } from './services/config-provider.js';
export const name = 'dsh-swarm';
export { Config };
// P1-9：无 inject——KanbanProvider 只用文件系统（FileEventStore），不依赖 ctx.storage 等任何服务。
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
    // Task 8：ConfigProvider 在 apply 中创建一次（override 存放于 storageDir，$DSH_HOME 占位符在此解析），
    // 全链路（KanbanProvider/HTTP 桥/主会话工具/调度器）共享同一实例实现配置面板热生效。
    const storageDir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? homedir());
    const configProvider = new ConfigProvider(ctx, config, storageDir);
    // Task 6：KanbanProvider 持 ConfigProvider 引用，kb_url base 经 getter 热读取（配置面板改后无需重建）。
    const provider = new KanbanProvider(ctx, config, configProvider);
    // D22：把包内角色裁剪 preset 组合安装到 $DSH_HOME/.agent-presets/（真实 API 下唯一可发现的自定义根）。
    const installed = installRolePresets();
    console.info('[dsh-swarm] role presets installed: ' + (installed.length ? installed.join(',') : 'none'));
    // LLM 运行时延迟取用：registerKanbanHttp 内部消费（llm-catalog 枚举），接线时 llm 服务已就绪。
    const llm = () => ctx.get('llm');
    // 可选服务接线均延迟到服务可用后：
    // - Web GUI 数据桥（GET /kanban/board + POST /kanban/action + 配置读写 + llm-catalog，仅 webServer 存在时挂载）
    //   llm 需在 webServer 就绪且 llm 就绪后取，wireAllAvailable 双服务轮询比单服务更稳。
    wireAllAvailable(ctx, ['webServer', 'llm'], () => registerKanbanHttp(ctx, provider, configProvider, llm(), config));
    // - P1-3 主会话工具面（spec_card_view/edit/approve + kanban 只读子集 + 前缀路由工具）
    //   Task 8：收 ConfigProvider，wiki 客户端与全部配置读点经 getEffective() 调用时热读取。
    wireAllAvailable(ctx, ['tools', 'kanban'], () => registerMainSessionTools(ctx, configProvider));
    // - 调度层：事件唤醒 V（R20）+ 每任务 agent runner + 看门狗（仅 agents 可用时启动）
    // Task 7：startDispatcher 收 ConfigProvider（模型链/wiki 热生效）。
    wireAllAvailable(ctx, ['agents', 'kanban'], () => startDispatcher(ctx, configProvider));
}
