# 阶段四设计文档：monorepo 合并 + 图谱活地图

> 状态：**已实施完成，主观验收项待验收人判断**
> 日期：2026-06-12
> 前置讨论：本文档由 2026-06-12 的四轮设计对话沉淀而成（战略定位 → 选区设计 → 钉扎持久化 → 生长事件链 → 引擎抽取）。

---

## §0 文档用法

- 本文档是阶段四的**唯一实施依据**。与 PRODUCT.md 冲突时，以 PRODUCT.md §7 的 ADR-20 / ADR-21 为准（两者由同一轮讨论产出，理论上不会冲突）。
- 每个 Step 动手前先读对应小节；实施者每完成一个 Step，按协作约定 commit 并向作者列改动清单。
- ❗ 标记 = 已知坑，实施时必须按写死的对策执行，不要自由发挥。

---

## §1 阶段四总览

### 1.1 背景

两条线在本阶段汇合：

1. **战略线**：llm-wiki 的终局形态已定——"一个产品、两扇门"（产品 = 知识库格式 + 中文素材管线 + 方法论；门一 = Skill，门二 = 工作台）。ADR-16 规划的"agent 并回主仓库"需要一个启动时机。
2. **产品线**：原阶段四"图谱集成"经设计讨论升级为"图谱活地图"——图谱不是嵌进来的 HTML，而是工作台的第二主屏，同时图谱引擎反哺 Skill 的离线 HTML。

两条线汇合的原因：图谱引擎是**两端共享的第一块代码**。共享代码出现的那一刻，"分居两仓库"开始产生真实摩擦（跨仓库依赖、双份维护）——这就是合并时机成熟的信号。

### 1.2 两大目标

1. **monorepo 合并（工程部分）**：本仓库（llm-wiki-agent）整体搬入主仓库（llm-wiki-skill 仓库）成为 workspace 成员。**不发版、不改 README、不对外宣布**——品牌动作（仓库改名、双形态叙事）留给后续阶段。
2. **图谱活地图**：共享图谱引擎 `@llm-wiki/graph-engine` 落地，工作台获得活的图谱视图（活模拟、钉扎、选区提问、生长动画），Skill 离线 HTML 在最后一步切换到引擎产物。

### 1.3 范围

- Step 0：monorepo 搬家 + workspace 根配置 + 全链路冒烟
- Step 1：引擎包骨架 + helpers 纯函数 TS 化 + 测试迁移
- Step 2：工作台图谱视图（静态复现基线）+ 主题 token（山水 / 墨夜第一版）
- Step 3：活模拟 + 钉扎 + 持久化
- Step 4：选区系统 + 对话联动
- Step 5：文件监听 + 重算链 + 生长动画
- Step 6：Skill 离线 HTML 切换引擎产物
- Step 7：总验收 + 墨夜主题打磨 + UX 体感收尾

### 1.4 不包含

- ❌ 仓库改名 / README 双形态叙事 / 对外发布（后续品牌阶段）
- ❌ Tauri 打包（原阶段五，已决策推迟到工作台被真实外部用户使用之后）
- ❌ 跨知识库图谱（"联邦知识库"远期命题）
- ❌ 自由套索圈选（见 D5，明确砍掉）
- ❌ 全部"明确不做清单"见 §8

---

## §2 关键设计决策（D1–D14）

> 每条决策含结论与一句话理由。完整论证过程见设计对话，此处只存可执行结论。

### D1 仓库布局：丙方案（monorepo 一次成型）

agent 仓库整体搬入主仓库子目录 `workbench/`，图谱引擎作为第一个共享包 `packages/graph-engine/`。目标布局：

```
llm-wiki-skill 仓库（未来品牌阶段改名 llm-wiki）
├── SKILL.md / scripts/ / templates/ / platforms/ / deps/ / tests/   ← Skill 主线，不动
├── packages/
│   └── graph-engine/        ← 新：共享图谱引擎（TS）
├── workbench/               ← 原 llm-wiki-agent 全部内容（server/ web/ docs/ PRODUCT.md ...）
├── package.json             ← 新：workspace 根
├── .mise.toml / .nvmrc      ← 从 agent 仓库上移
└── ...
```

- 搬运方式：`git subtree add --prefix=workbench <agent 仓库 URL> main`（保留全部 57 个 commit 历史，路径自动重写到 workbench/ 下）。
- 旧 agent 仓库处置：**保留不动**（不 archive、不加迁移说明），处置推迟到品牌阶段。开发主场即日起切到 monorepo。
- 理由：砖要砌在最终的房子上；同屋檐下 workspace 联调体验最好；主仓库 git 活跃恢复是战略副产物。

### D2 图谱地位：主区域第二视图

- 侧栏新增"图谱"入口；主区域在"对话 ⇄ 图谱"间切换；图谱**绑定当前知识库**（与 ADR-12 会话绑库同构：切库 = 换地图）。
- 对话仍是第一主屏（ADR-2 不动摇）。图谱只接"结构可见"的问题；非结构问题（消化、闲聊）主入口仍是对话。

### D3 一个引擎、两个宿主

- 引擎包 `@llm-wiki/graph-engine`：数据进、画布出，构建双产物（ESM 给工作台 React；IIFE 单文件给离线 HTML 打包）。
- 宿主差异通过 **capabilities 能力注入**表达（见 §4.5），引擎核心零分叉，没有任何"如果是离线 HTML 就…"的判断。
- React 侧是 ~30 行薄壳组件（useRef 容器 + useEffect 生命周期），React 管壳、引擎管画布内部。

### D4 主题：一对官方主题，跟随工作台

- 浅色「数字山水」（品牌签名，离线 HTML 默认）+ 深色「墨夜」（同一国风语法的夜间变体：黑底、白墨、朱砂点睛）。
- 图谱主题**跟随工作台浅/深切换**，不提供独立的图谱主题选择。明确不做主题商店。
- 主题实现为 CSS token 层（颜色、纹理、字体变量），留扩展位但只维护两个官方主题。

### D5 选区：结构化四式，砍掉自由套索

空间邻近 ≠ 语义相关（力导向布局位置是算法产物），自由画圈必然圈出无语义保证的集合，**不做**。只提供四种自带语义保证的选择方式：

| 方式 | 操作 | 语义保证 |
|---|---|---|
| 选一页 | 点节点 | 就是这一页 |
| 选一簇 | 点社区色块/标签 | Louvain 聚类，内部链接密集 |
| 选一页+语境 | 选中后点"+邻居" | 沿真实 wikilink 扩一跳 |
| 手动挑几页 | Shift+逐个点 | 用户明确自选 |

### D6 选区动作：结构事实先行，动作随性质变，本质 = 已有工作流的空间入口

- 选区面板先显示**结构事实**（N 页、M 条内部链接、跨几个社区、孤立数），再按选区性质给 2–4 个动作按钮 + 自由输入框：
  - 单社区 → 总结这一簇（digest）/ 找知识缺口（lint 局部）/ 生成主题页
  - 两社区 → 为什么没联系 / 找潜在桥梁 / 对比这两块（comparisons）
  - 互不相连的多选 → 探索潜在联系 / 对比异同（**不**提供"总结这一簇"——那是伪问题）
  - 孤岛页 → 把它链入知识库
- **选区 = 批量 `@`**：发送时选区展开为结构化文本（页面清单 + 链接关系 + 社区归属），沿用现有 `/api/prompt` 文本通道，**不加新参数**；页面正文由 agent 按需 `read`（与阶段二 `@` 语义、ADR-19 检索路线一致）。
- UI 上选区在输入框呈现为一个胶囊 chip：`@[选区:Agent工程 · 12页]`，可点击回图谱重看。
- 发送目标：默认**当前活跃对话**；面板留"在新对话中打开"次按钮。

### D7 跨库图谱：不做

图谱能跨库而对话不能（ADR-12）会撕裂圈选提问的心智；跨库联系频繁出现说明分库方式该调。留给远期"联邦知识库"命题。

### D8 钉扎交互：活模拟 + 松手即钉 + 双击解钉

- 工作台图谱运行实时力模拟（d3-force：斥力 + 弹簧力 + 向心力）。
- 拖动时**低温运行**（alphaTarget ≈ 0.1–0.2）：直接邻居被弹簧温和带动让位，隔层微颤，远处不动；松手后冷却归零，全图入睡（❗ 确保 alphaMin 配置正确，图绝不能永远蠕动）。
- 松手即钉（设 fx/fy），亮朱砂图钉角标；双击解钉，节点飘回算法位置。
- 钉住的节点是后续自动布局的锚点：新节点在锚点间自动找位置——手动与自动不抢方向盘。
- "重置布局"按钮：解开全部钉 + 清文件 + 重跑模拟；交互为**重置后 toast 撤销**，不做事前确认弹窗。
- 被拖动节点的**邻居**因物理被带动的新位置**不写入持久化**（只存用户的主观决策）。

### D9 钉扎持久化：库文件，只存钉的，路径为 key

- 存储位置：知识库根下 `.wiki-graph-layout.json`（与 `.wiki-cache.json` 同级同风格）。
- 原则：**"对知识的主观组织进库文件；浏览状态（缩放/平移/折叠）留本机 localStorage"**。此原则适用于今后所有同类问题。
- 格式见 §4.1。只存钉住的节点；key 用**库内相对路径**；坐标用**模型坐标**（❗ 不是屏幕坐标，否则缩放平移后错位）。
- 路径 key 天然解决 PR #44 的"指纹作废"病根：图谱重建后路径未变的钉扎自动存活；被删页面在下次图谱数据重建时惰性清理；改名 = 钉扎丢失（可接受退化，不做改名跟踪）。
- 写入：前端松手时调后端 API，整文件覆写，防抖（拖动过程不写盘）。文件损坏 = 当作不存在，从零开始，不崩溃。
- 并发：工作台单实例（PRODUCT.md §6.7）；Skill 侧只读不写此文件。
- Obsidian 共存忽略清单（PRODUCT.md §6.4）与 init 生成的 `.gitignore` 模板**不需要**改动逻辑，但 agent 读写文件清单（§6.4"agent 读写的文件"）需补 `.wiki-graph-layout.json`。

### D10 位置层 / 结构层分权

| 层 | 内容 | 谁说了算 | 拖动改变它吗 |
|---|---|---|---|
| 位置层 | 节点摆哪、钉不钉 | 用户 | 改变 |
| 结构层 | 颜色、社区归属、连线 | 知识库里的真实 wikilink | 完全不变 |

- 拖 A 进别的社区团块，A 颜色不变——视觉语言自行消解"拖动改分类"的误解。
- 想真正改变社区归属 = 改知识：通过选区提问让 agent 建立真实链接写回 wiki，下次重算颜色才变。**想改图的样子，动手拖；想改知识的结构，开口问。**
- 水墨团块按"成员聚集主体"晕染，**不追离群钉点**（否则团块拉成变形虫）；拖动中团块淡化，松手定格后再重新晕染。

### D11 混合布局：预计算起点 + 低温入睡 + 活会话坐标策略

- **冷启动**：打开图谱时初始位置 = 构建期预计算坐标（build-graph-data 现有能力）+ 钉扎文件钉位；活模拟在此起点低温微调数秒后入睡。保证：每次打开长相稳定、与离线 HTML 初始视图一致、肌肉记忆不失效。
- **活会话**（❗ 防"布局漂移"）：图谱开着时收到重算结果，**既有未钉节点保持当前画面位置不动**（不采用新一轮预计算坐标），新增节点由活模拟在现有布局的缝隙中安置。预计算坐标**只用于冷启动**——否则每次重算老节点集体跳位，画面失控。
- 推论：跨会话重新打开时布局可能与上次会话末态不同（新一轮预计算）——这是力导向图常态（Obsidian 同），钉扎就是给用户的稳定工具。

### D12 重算链：监听文件系统，不监听"消化"

- 变化源至少五个：批量/单篇消化、结晶、agent 补链（选区提问闭环的终点）、lint 修复、Obsidian 手改。只盯"消化"会让地图说谎。
- 底座：后端监听当前知识库目录（`.md` 与 `.wiki-schema.md`），**防抖 ~5s** 合并零星变化；**自家批量流程（批量消化）开始时挂起监听、done 后立即触发一次**。
- ❗ **监听排除清单**：`.wiki-tmp/`（Skill 运行时临时目录，消化过程狂写，不排除会被自家流程刷爆）、`.git/`、`.obsidian/`、`node_modules/`、`.DS_Store`，以及自家生成物 `.wiki-graph-layout.json`、`wiki/graph-data.json`、`wiki/knowledge-graph.html`。与 PRODUCT.md §6.4 忽略清单对齐。
- 监听器生命周期跟随当前 KB：切库时停掉旧库监听、启动目标库监听（与会话切换同一时机）。
- 重算 = 子进程跑现有 `build-graph-data.sh` 全量管线（❗ 不重写、不做增量图计算）。重算期间旧图谱照常显示与交互；新数据就绪才换场，绝不白屏。
- 重算进行中又有新触发：排队合并（单飞行任务 + 最多一个 pending，跑完再跑一次）。
- 重算完成后与旧版数据对比产出**差异清单（diff）**——diff 即动画剧本。

### D13 生长动画：diff 队列，图谱可见时消费

- SSE 推 `graph_updated` 事件（含 diff 与统计）。前端三分支：
  - 图谱视图可见 → 播放生长动画
  - 图谱不可见 → 侧栏图谱入口亮安静徽标；diff 入挂起队列，**打开图谱时从旧布局开场补播**（最高价值一幕：批量消化完才打开图谱看成果）
  - 用户正在拖节点 → 挂起，松手后播
- 动画剧本（按 diff 四类）：新节点从**语义锚点**（其邻居位置）发芽、由活模拟安置（呼应 D11：既有未钉节点不动），孤岛从空白处淡入；新边墨线描画；换社区节点颜色渐变（以 §4.3 社区对齐后的真实变化为准）；删除节点淡出；全新社区诞生 → 团块晕染浮现。
- 节奏：错峰发芽（间隔几十 ms），总时长**压在 2–3 秒内**；点击画布立即定格；尊重系统 `prefers-reduced-motion`（开了直接定格，零配置）。
- 工作台重启后不补播（动画是体验不是持久化资产），直接显示最新状态。

### D14 引擎抽取：新骨架、旧器官

现有 graph-wash 代码按四级资产处理。事实依据：已验证 `graph-wash.js` / `graph-wash-helpers.js` 两个运行时文件 **0 处使用 d3 / rough**（纯手写几何引擎）；Step 2 已核查 `header.html` 内联脚本，同样 **0 处使用 d3 / rough**，仅命中 `graph-data` JSON script。Step 6 因此移除 `d3.min.js` / `rough.min.js` 与旧 `graph-wash*.js`，marked / purify 保留：

| 级 | 内容 | 处理 |
|---|---|---|
| A 直接搬 | graph-wash-helpers.js ~1325 行纯函数 + tests/js 配套测试 | TS 化，**逻辑一行不改**，测试迁移保绿 |
| B 拆开搬 | graph-wash.js ~1008 行中的"画法"（节点视觉分层、团块晕染、阅读态） | 画法保留；骨架（全局单例、直接操作 document）换成可实例化引擎 |
| C 留给宿主 | header.html ~2001 行壳与样式 | 壳归宿主自理；视觉样式抽成主题 token 共享 |
| D 新写 | 力模拟+钉扎、选区、diff 动画、React 壳、capabilities | 本阶段新增 |

- ❗ A 级 TS 化纪律：先 1:1 翻译保测试绿，禁止"顺手优化"逻辑。
- ❗ 手绘感"沸腾效应"：图形路径生成一次即缓存，动画帧只改 transform，**绝不每帧重算路径**。
- 力模拟依赖 `d3-force` 单模块（几 KB），不引入完整 d3；离线 HTML 打包清单里的完整版 `d3.min.js` 与 `rough.min.js` 已在 Step 6 移除（marked / purify 保留，阅读态在用）。
- 不做 SVG/Canvas 双渲染后端（几百节点 SVG 足够；canvas 是将来性能实测不足时的事）。
- 不把引擎做成对外发布的通用图谱库。

---

## §3 新增依赖

| 依赖 | 位置 | 用途 | 备注 |
|---|---|---|---|
| `d3-force` | packages/graph-engine | 力模拟（斥力/弹簧/向心） | 单模块几 KB；唯一确定新增 |
| `concurrently` | monorepo 根 | 原 agent 根 devDependency 上移 | 非新增，位置迁移 |

**候补（默认不装，触发条件见 §7）**：`chokidar`（若 Node 22 原生 `fs.watch` recursive 在 macOS 实测不可靠才引入）。

构建工具：引擎包双产物（ESM + IIFE）优先用 workbench/web 已有的 Vite 体系（`vite build --lib` 两种 format），**不新增打包器**。

---

## §4 数据与接口契约

> 路径与字段为**建议命名**，实施时如需调整，在 commit message 里说明并回填本文档。

### 4.1 `.wiki-graph-layout.json`（新，知识库根目录）

```json
{
  "version": 1,
  "pins": {
    "wiki/topics/agent-engineering.md": { "x": 412.5, "y": -88.2 },
    "wiki/entities/karpathy.md": { "x": 130.0, "y": 245.7 }
  },
  "updatedAt": "2026-06-12T10:23:00Z"
}
```

- key = 库内相对路径；坐标 = 模型坐标；只含钉住的节点。
- 读不出 / 格式不符 → 当作空文件处理。

### 4.2 `graph-data.json`（现有，格式不变）

由 `build-graph-data.sh` 产出，工作台后端子进程调用。引擎包内为其补 TS 类型定义（`types.ts`），类型是契约的单一事实源。

### 4.3 diff 结构（引擎包内定义并实现）

```ts
interface GraphDiff {
  addedNodes: NodeId[];          // 新增节点（生长动画主角）
  removedNodes: NodeId[];        // 删除节点（淡出）
  recoloredNodes: Array<{ id: NodeId; from: CommunityId; to: CommunityId }>;
  addedEdges: EdgeId[];          // 新边（墨线描画）
  removedEdges: EdgeId[];
  newCommunities: CommunityId[]; // 对齐后仍无法匹配的全新社区（团块浮现动画）
  stats: { nodeCount: number; edgeCount: number; communityCount: number };
}
```

diff 计算工具放引擎包（跟着数据类型走），后端调用。

❗ **diff 必须先做社区对齐再判变色**：Louvain 重跑后社区编号可能整体洗牌（"3 号社区"变"1 号"），直接比对编号会满屏误报变色。算法：新旧社区按**成员重叠率**（Jaccard）贪心配对，配对成功的沿用旧编号语义，配对后成员真正换了归属的才进 `recoloredNodes`；无法配对的新社区进 `newCommunities`。

### 4.4 后端 API（workbench/server 新增）

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/graph` | **只读**：返回当前 KB 的 graph-data；无数据时返回 `{ needsBuild: true }`，**不**在 GET 里触发构建 |
| POST | `/api/graph/rebuild` | 异步触发重算（与监听触发走同一单飞行队列），立即返回；完成经 SSE `graph_updated` 通知 |
| GET | `/api/graph/layout` | 返回钉扎文件内容（无文件返回空 pins） |
| PUT | `/api/graph/layout` | 整文件覆写钉扎 |

前端首开流程：GET 得 `needsBuild` → 显示"构建中" → 自动 POST rebuild → 收到 `graph_updated` 后 GET 取数渲染。构建可能秒级到几十秒（大库），全程不阻塞请求。

SSE 新事件（沿用现有 `/api/events` 通道）：

```
event: graph_updated
data: { "diff": GraphDiff | null, "rebuiltAt": "..." }
```

引入节奏：Step 2 先上**最简版**（`diff: null`，仅作"构建完成"通知）；Step 5 扩展携带真实 diff。

### 4.5 引擎 API（`@llm-wiki/graph-engine` 门面）

```ts
const engine = createGraphEngine(container: HTMLElement, {
  data: GraphData,
  pins: PinMap,
  theme: "shan-shui" | "mo-ye",
  capabilities: {
    persistPins?: (pins: PinMap) => Promise<void>; // 工作台→PUT 后端；离线→localStorage 适配器
    onAsk?: (selection: Selection) => void;        // 不传 → 选区面板不显示提问动作
    onOpenPage?: (path: string) => void;           // 工作台→右抽屉；离线→内置阅读态
  }
});

engine.applyDiff(diff: GraphDiff): Promise<void>;  // 生长动画，resolve 于动画结束/被跳过
engine.focusNode(path: string): void;              // 对话联动高亮
engine.select(selector: SelectionInput): void;
engine.setTheme(theme: ThemeId): void;
engine.destroy(): void;
```

### 4.6 引擎包目录结构

```
packages/graph-engine/
├── src/
│   ├── model/      ← A级：helpers 纯函数 TS 化（atlas 模型/视口/小地图/密度）
│   ├── render/     ← B级：绘制重组（节点视觉分层、团块晕染、阅读态部件）
│   ├── sim/        ← D级：d3-force 封装 + 钉扎
│   ├── select/     ← D级：选区系统（四式选择 + 结构事实计算）
│   ├── anim/       ← D级：diff 生长动画
│   ├── themes/     ← C级：shan-shui / mo-ye token
│   ├── diff.ts     ← diff 计算
│   ├── types.ts    ← graph-data / pins / diff 类型（契约单一事实源）
│   └── index.ts    ← createGraphEngine 门面
├── test/           ← 迁移自主仓库 tests/js/*.test.js
└── package.json
```

---

## §5 八个 Step 详细设计

### Step 0：monorepo 搬家

**前置**（❗ 流程顺序）：先把 agent 仓库的 `stage-4-design` 分支合入其 `main`（设计文档必须随 subtree 进主仓库，否则搬过去的是没有阶段四设计的旧 main）。

**范围**：
1. 主仓库新建分支 `stage-4`，执行 `git subtree add --prefix=workbench <agent 仓库 GitHub URL> main`（保留全历史）
2. 主仓库根新建 `package.json`：
   - workspaces: `["workbench/server", "workbench/web", "packages/*"]`
   - scripts：`dev` / `dev:server` / `dev:web` / `typecheck`（从原 agent 根 package.json 上移，workspace 路径改写）
   - devDependencies：`concurrently`
   - ❗ **不设 `"type": "module"`**——主仓库 `tests/js/*.test.js` 是 CommonJS（`require` + 双出口），根上声明 ESM 会让它们全炸
3. ❗ **检查子包 module 类型**（原 agent 根 package.json 声明了 `"type": "module"`，删除它之前必须确认）：workbench/server、workbench/web 各自 package.json 是否自带 `"type": "module"`，**缺则补在子包内**（不上提到根）；以 `npm run dev` + `typecheck` 实跑为准
4. `workbench/package.json` 删除（其内容已上移）；`.mise.toml` / `.nvmrc` 上移到根
5. 检查 `.gitignore` 合并（根新增 node_modules 等通用项；workbench 原有忽略项保留）
6. ❗ 隐私检查：subtree 进来的内容 grep 本地用户目录绝对路径，有则清理后再 commit

**验收**：
1. 主仓库根 `npm install && npm run dev` 一行拉起工作台前后端，浏览器 5180 正常对话
2. 主仓库原有测试照常绿：`bash tests/regression.sh`（或至少 `node --test tests/js/*.test.js` 全过）
3. `npm run typecheck` 通过
4. `git log --oneline workbench/ | head` 能看到原 agent 仓库历史

### Step 1：引擎包骨架 + helpers TS 化（M0）

**范围**：
1. 建 `packages/graph-engine`（目录结构见 §4.6），Vite lib 模式配置双产物
2. `templates/graph-styles/wash/graph-wash-helpers.js` → `src/model/` 按职责拆成若干 TS 模块（atlas 模型 / 视口数学 / 小地图映射 / 密度策略 / 标签文案），**1:1 翻译，逻辑零改动**
3. `tests/js/graph-wash-helpers.test.js` 等迁移为引擎包测试（断言不改）
4. `types.ts`：graph-data / pins / diff 类型定义
5. ❗ 此 Step 不动 `templates/` 原文件——旧模板继续服役到 Step 6

**验收**：引擎包 `npm test` 全绿（迁移断言数量 ≥ 原测试）；`npm run build` 产出 ESM + IIFE 两份产物。

### Step 2：工作台图谱视图——静态复现（M1，安全网）

**范围**：
1. `src/render/`：从 graph-wash.js 搬运绘制逻辑，重组为可实例化结构（构造时挂容器、destroy 可清理）；先实现**静态渲染**（预计算布局，无模拟）
2. `themes/`：从 header.html 抽视觉 token，山水主题完整、墨夜主题第一版（先保证深色工作台下不突兀，精修在 Step 7）；❗ 顺手核查 header.html 内联脚本是否使用 d3 / rough（结论记入本文档 D14，决定 Step 6 打包清单）
3. workbench/web：侧栏"图谱"入口 + 主区域"对话 ⇄ 图谱"视图切换 + React 薄壳组件
4. workbench/server：`GET /api/graph`（只读）+ `POST /api/graph/rebuild`（异步构建 + SSE 通知，行为见 §4.4 首开流程）
5. 阅读态：图谱内点节点 → 通过 `onOpenPage` 调工作台右抽屉（不用引擎内置阅读态）

**验收**：
1. 工作台打开真实知识库图谱，与旧版离线 HTML 同屏对照，布局/节点分层/团块/小地图视觉一致（人工对照 + 截图存档）
2. 切换知识库 → 图谱跟随切换；无图谱数据的库显示"构建中"再出图
3. 浅/深主题切换，图谱跟随山水/墨夜

### Step 3：活模拟 + 钉扎 + 持久化（M2）

**范围**：
1. `sim/`：d3-force 接入；混合布局（D11：预计算起点 + 低温入睡）；拖动低温让位（D8 参数）；❗ rough/手绘路径缓存（D14 沸腾对策——若 B 级搬运中存在随机抖动绘制，路径一次生成挂节点，帧只更新 transform）
2. 钉扎：松手即钉 + 朱砂图钉角标 + 双击解钉 + 重置布局（toast 撤销）
3. 持久化：`GET/PUT /api/graph/layout`；前端松手防抖写入；§4.1 文件格式
4. 团块行为：拖动中淡化、定格后重晕染、不追离群点（D10）
5. 顺手查证：`init-wiki.sh` 生成的知识库 `.gitignore` 对 `.wiki-cache.json` 的处理方式，`.wiki-graph-layout.json` 与之对齐（倾向**不排除**——钉扎是用户资产，应可随知识库进版本管理；查证结果回填本条）

**实施定稿**：
- 拖动手感参数：`coldStartAlpha=0.08`、`lowHeatAlphaTarget=0.15`、`alphaMin=0.003`、`alphaDecay=0.14`、`velocityDecay=0.58`；斥力 `strength=-34` / `distanceMax=220`；X/Y 回中强度 `0.052`；碰撞 `strength=0.64` / `iterations=2`。拖动时直接邻居参与让位，远处节点冻结，松手后 `alphaTarget=0`。
- `.wiki-graph-layout.json` 与 `.wiki-cache.json` 对齐为知识库资产：`init-wiki.sh` 生成的知识库 `.gitignore` 仅忽略 `.wiki-tmp/`，不忽略 layout 文件。

**验收**：
1. 拖节点：邻居让位流畅、远处不动、松手 1–2s 后全图静止（不蠕动）
2. 钉住节点 → 刷新页面 / 重启工作台 → 钉位还原；双击解钉 → 文件中该条删除
3. 拖 A 进异色团块：A 颜色不变、团块不追
4. 重置布局 → toast 撤销可恢复
5. 手动损坏 `.wiki-graph-layout.json` → 图谱正常打开（当作无钉）

### Step 4：选区系统 + 对话联动（M3）

**范围**：
1. `select/`：四式选择（D5）+ 选区结构事实计算（页数/内部链接数/社区数/孤立数）
2. 选区面板：结构事实 + 按性质生成的动作按钮（D6 映射表）+ 自由输入 + "发送/新对话中打开"
3. 工作台联动：`onAsk` → 切到对话视图，输入框出现选区胶囊；发送时胶囊展开为结构化文本（页面清单 + 链接关系 + 社区归属）走现有 `/api/prompt`
4. 反向联动：对话中 agent 引用 wiki 页面 → 若图谱视图打开，`focusNode` 高亮（"引用"的判定**复用阶段二既有的 wiki 链接识别**，不另发明检测逻辑）
5. 离线 HTML 不传 `onAsk` → 引擎自动隐藏提问动作（capabilities 验证点）

**实施定稿**：选区在输入区显示胶囊 `@[选区:<标题> · <页数>页]`；发送时展开为结构化文本，包含选区摘要（页数、内部链接数、社区数、孤立数）、页面清单（类型 / 社区 / 路径）、内部链接列表、动作与自由输入。对话历史保留胶囊态，展开内容作为发送 payload，不把几十行结构化文本直接刷屏。

**验收**：
1. 点社区 → 面板显示"N 页 · M 条内部链接" → 点"总结这一簇" → 对话收到选区上下文，agent 输出的总结明确引用选区内页面
2. Shift 多选 3 个互不相连节点 → 面板显示"无相互链接"，动作为"探索潜在联系"，**没有**"总结这一簇"
3. 选两个社区 → 动作含"为什么没联系"；agent 回答后引导建链 → agent 写回 wikilink → 触发重算（Step 5 完成后回归验证颜色变化闭环）
4. 发送默认进当前对话；"新对话中打开"开新线程

### Step 5：文件监听 + 重算链 + 生长动画（M4）

**范围**：
1. workbench/server：当前 KB 目录监听（Node 原生 `fs.watch` recursive，封装一层适配器；❗ 实测不可靠再换 chokidar，见 §7）；防抖 ~5s；批量消化 start 挂起 / done 立即触发
2. 重算任务：单飞行 + 排队合并；子进程跑 `build-graph-data.sh`；完成后 diff（引擎包 `diff.ts`）
3. `graph_updated` 扩展携带真实 diff（Step 2 的最简版升级）；前端 diff 队列（可见消费 / 不可见徽标 + 补播 / 拖动中挂起）
4. `anim/`：生长动画（语义锚点发芽、错峰、墨线描边、变色渐变、淡出；≤3s；点击定格；`prefers-reduced-motion`）

**验收**：
1. 批量消化 10 篇（图谱视图关着）→ 完成后侧栏徽标亮 → 打开图谱 → 从旧布局开场播放生长（新节点从邻居处发芽）→ 3s 内定格
2. 图谱开着时在 Obsidian 手动新建一篇含 wikilink 的页面 → ~5s 后图谱自动长出新节点
3. 批量消化进行中不触发逐篇重算（日志确认挂起）；done 后恰好一次重算
4. 动画播放中点击画布 → 立即定格；系统开启"减少动态效果"→ 直接定格
5. 正在拖动节点时收到 `graph_updated` → 松手后才播

**实施定稿**：macOS + Node 22 下原生 `fs.watch` recursive 两轮实测可收到嵌套目录创建、嵌套 Markdown 创建 / 修改 / 删除事件；部分修改可能以 `rename` 形式到达，因此实现不依赖事件类型，只要命中非排除路径就触发防抖重算。未引入 chokidar。

### Step 6：Skill 离线 HTML 切换引擎产物（M5）

**范围**：
1. `build-graph-html.sh` 改造：拼接 `engine.iife.js` + 主题 CSS + graph-data + 启动脚本（创建 engine；capabilities：persistPins → localStorage 适配器【沿用现有 per-wiki 命名空间机制】、onOpenPage 不传 → 用引擎内置阅读态）
2. 生成时读 `.wiki-graph-layout.json` 把钉位烤进初始布局
3. 打包清单：移除 `d3.min.js`（完整版，运行时从未使用）与旧 `graph-wash*.js`；保留 marked / purify；新增 engine.iife.js
4. 旧模板 `templates/graph-styles/wash/` 标记 deprecated（保留一个版本周期再删）
5. 主仓库回归测试与东方设计合同测试对新产物跑通（断言按新 DOM 结构最小修订）

**验收**：
1. 真实知识库跑 `build-graph-html.sh` → 双击产物 HTML 离线打开，视觉与工作台一致（山水主题）
2. 工作台里钉好的布局，在导出 HTML 的初始视图中生效
3. 离线 HTML 内可拖动（localStorage 持久，刷新仍在），**无**提问按钮（capabilities 生效）
4. `bash tests/regression.sh` 全绿

### Step 7：总验收 + 墨夜打磨 + 收尾

**范围**：墨夜主题精修（黑底/白墨/朱砂的完整视觉走查）、动画节奏与拖动手感参数调优、§6 总验收剧本完整跑一遍、PRODUCT.md 进度回填、（可选）旧 agent 仓库内加一条不对外的开发笔记。

---

## §6 总验收标准

1. **monorepo**：主仓库根一行 `npm run dev` 起工作台；Skill 主线测试全绿；两边互不破坏
2. **静态基线**：工作台图谱与旧版离线 HTML 视觉一致（Step 2 截图存档为证）
3. **钉扎**：拖动让位流畅、松手即钉、重启还原、Obsidian 旁路修改不破坏钉扎文件
4. **选区**：四式选择可用；动作随选区性质变化；"两簇为何没联系 → agent 建链 → 重算后颜色真变"全闭环跑通
5. **生长**：批量消化后打开图谱可见补播动画；Obsidian 手改 ~5s 内自动反映；批量期间不抖动重算
6. **离线 HTML**：新产物双击可用、钉位生效、无提问按钮、回归测试绿
7. **主题**：工作台浅/深切换图谱跟随山水/墨夜，深色模式下无违和

---

## §7 风险与 TBD

| 编号 | 风险/待定 | 对策/何时定 |
|---|---|---|
| R1 | 根 package.json 的 module 类型破坏主仓库 CommonJS 测试 | 已写死：根不设 type，ESM 声明留在子包（Step 0 ❗） |
| R2 | 手绘路径每帧重算导致"沸腾"+性能塌方 | 已写死：路径一次生成缓存，帧只改 transform（Step 3 ❗） |
| R3 | `fs.watch` recursive 在 macOS 的可靠性 | 已定稿：Node 22 原生 recursive 实测可用；事件类型不稳定但事件可达，按非排除路径统一触发重算；未引入 chokidar |
| R4 | subtree 合并带入本地绝对路径 / 隐私内容 | 已定稿：Step 0 隐私清理通过；后续每 commit 执行 staged 内容本地路径扫描 |
| R5 | 选区注入大社区（如 30 页）时上下文过大 | 首版只注入清单+结构（正文 agent 按需 read）；实测 token 仍超 → 注入端做清单截断 + 提示 agent 分批读 |
| R6 | 力模拟在 500+ 节点的帧率 | 首版接受（个人库几百页内）；实测掉帧 → 布局计算挪 Web Worker；canvas 后端为更远期备选 |
| R7 | 旧测试断言绑死旧 DOM 结构，Step 6 迁移成本 | 允许按新 DOM 最小修订断言，但"东方设计合同"语义级断言（分层/签条/批注存在性）必须保留 |
| R8 | Louvain 重跑社区编号洗牌 → recolored 满屏误报 | 已写死：diff 先按成员重叠率（Jaccard）做新旧社区贪心配对，再判真实变色；无法配对的进 `newCommunities`（§4.3 ❗） |
| TBD-4.1 | 拖动手感参数（alphaTarget / 衰减时长 / 让位半径） | 已定稿：参数见 Step 3 实施定稿；主观手感交验收人判断 |
| TBD-4.2 | 选区胶囊展开文本的具体模板 + 对话历史显示策略 | 已定稿：模板见 Step 4 实施定稿；历史保留胶囊态，发送 payload 展开结构化文本 |

---

## §8 明确不做清单（汇总）

| 不做 | 原因 |
|---|---|
| 自由套索圈选 | 空间邻近无语义保证（D5） |
| 跨库图谱 | 撕裂会话绑库心智（D7） |
| 多套布局方案 / 主题商店 | 维护负债、稀释签名（D4/D9） |
| 页面改名钉扎跟踪 | 丢了重钉，成本不值（D9） |
| 修饰键临时拖动模式 | 双击解钉已覆盖（D8） |
| 图谱指纹作废机制 | 被路径 key 取代（D9） |
| 增量图计算 | 全量+diff 简单一个量级（D12） |
| 动画速度/开关设置项 | 默认调好是产品责任；系统 reduced-motion 除外（D13） |
| 知识库成长历史回放 | 远期传播玩具，不进阶段四（D13） |
| SVG/Canvas 双渲染后端 | 规模未到；过早抽象（D14） |
| 引擎通用库化对外发布 | 它是器官不是轮子（D14） |
| 重写 build-graph-data.sh | Skill 能力优先（ADR-16/D12） |
| Tauri 打包 | 推迟到工作台有真实外部用户后 |

---

## 附：与 PRODUCT.md 的对应

- 本文档对应 PRODUCT.md §4"阶段四"与 §7 ADR-20（monorepo 合并）、ADR-21（图谱引擎与活地图）。
- 实施期间的决策变更：先改本文档相应小节并在 changelog 留痕，再改代码。

## Changelog

- 2026-06-12 v3（实施回填）：阶段四落地后补齐定稿事实
  - D12 监听排除清单补自家生成物三项：`.wiki-graph-layout.json`、`wiki/graph-data.json`、`wiki/knowledge-graph.html`
  - D14 回填 header.html 内联脚本 d3/rough 审计结论；Step 6 已移除 d3/rough 与旧 graph-wash 打包项
  - Step 3 回填拖动手感参数与 `.wiki-graph-layout.json` 的 gitignore 对齐结论；Step 4 回填选区胶囊/展开 payload 模板；Step 5 回填 fs.watch 实测结论
  - §7 将 R3/R4 与 TBD-4.1/TBD-4.2 更新为已定稿状态
- 2026-06-12 v2（自审修订）：修复 5 个实质缺口 + 收紧 2 处事实表述
  - D11 补活会话坐标策略：既有未钉节点不随重算跳位，新节点活模拟安置，预计算坐标仅用于冷启动（防布局漂移）
  - §4.3 补 diff 社区对齐（Jaccard 配对，防 Louvain 编号洗牌导致满屏误报变色）+ `newCommunities` 字段；新增 R8
  - §4.4 统一 GET 只读 / POST 异步构建；`graph_updated` 分两步引入（Step 2 最简版、Step 5 带 diff）
  - D12 补监听排除清单（`.wiki-tmp/` 等，防 Skill 消化刷爆监听）+ 切库监听生命周期
  - Step 0 补前置（stage-4-design 先合入 agent main，否则设计文档不随 subtree 进主仓库）+ 子包 module 类型检查列为明确动作
  - D14 / Step 2 / Step 6 收紧"0 处 d3/rough"表述：已验证两个运行时 JS；header.html 内联待 Step 2 核实，d3.min.js 移除以核实为前提
  - Step 3 补 init `.gitignore` 对 layout 文件的对齐查证；Step 4 注明引用识别复用阶段二既有逻辑；TBD-4.2 扩展对话历史胶囊显示策略
- 2026-06-12 v1：首版。由四轮设计对话（战略 / 选区 / 钉扎 / 生长 / 引擎抽取）沉淀，含 D1–D14 决策、8 Step、API 契约、验收剧本、风险清单。
