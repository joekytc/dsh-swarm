# 结果评审

## 来源包

- Brief：`.briefpilot/graph-html-redesign/design-brief.json`
- DESIGN.md：`.briefpilot/graph-html-redesign/DESIGN.md`
- 已选策略：东方编辑部 × 数字山水
- 目标工具：generic

## 评审证据

- 证据类型：local_file + screenshot_reference
- 证据路径：`.briefpilot/graph-html-redesign/oriental-editorial-atlas.html`
- 视觉证据：`/tmp/oriental-atlas-desktop.png`、`/tmp/oriental-atlas-tablet.png`、`/tmp/oriental-atlas-mobile.png`、`/tmp/oriental-atlas-mobile-lower.png`
- 摘要：本地 HTML 页面已打开并截图检查。桌面宽度 1440、平板宽度 768、手机宽度 375 均无控制台错误、无横向溢出。页面整体采用米白纸面、墨色文字、朱砂强调、青绿/夜青辅助，包含左侧文献索引、中间图谱、右侧札记详情、搜索、筛选、置信度、状态切换和响应式降级。

## 保留点

- 视觉方向基本命中：首屏明显比 demo 更像成熟产品，东方编辑部气质来自文献索引、纸面、朱砂线、札记详情，而不是廉价纹样。
- 信息结构完整：左侧导航、中间图谱、右侧详情三栏清楚，搜索、社区、学习队列、推荐起点、图例、洞察、相邻节点都有入口。
- 设计 token 大体遵循 DESIGN.md：米白、墨色、朱砂、青绿、夜青、旧地图线和细边框体系一致。
- 落地性较好：单文件 HTML，无外部网络资源；图谱、状态面板和交互用 vanilla HTML/CSS/JS 实现。
- 技术检查通过：桌面、平板、手机截图无横向溢出；控制台无错误。

## 问题

| 严重程度 | Brief 依据 | 问题 | 证据 | 建议修改 |
|---|---|---|---|---|
| medium | `review-checklist.md`：触控目标至少 44px；`DESIGN.md` Responsive Behavior | 移动端部分按钮高度只有 36px，低于 44px 触控目标。 | 浏览器检查显示 `.segmented button` 和 `.state-button` 在 375px 下高 36px，`空` 按钮宽 34px。 | 将所有移动端交互按钮 `min-height` 调整到 44px；状态按钮在窄屏下用 2x2 或单行横向滚动，不要缩成 34x36。 |
| medium | `design-brief.json`：首屏要看出“东方编辑部 × 数字山水”；移动端可降级但不能丢主信息 | 手机首屏只看到标题和文献索引，中央图谱和数字山水舞台要下滑很久才出现，移动端第一眼缺少“数字山水”。 | `/tmp/oriental-atlas-mobile.png` 首屏只显示 topbar、搜索、社区和学习队列，未露出图谱。 | 移动端在文献索引上方或标题下方加入一张紧凑“图谱预览卡”，或把主内容顺序改为标题 → 图谱预览 → 文献索引 → 详情。 |
| low | `DESIGN.md` Components：Node 有 disabled/unavailable、error 状态；Buttons 有 pressed、disabled、error 状态 | 状态覆盖主要集中在 loading/empty/error，按钮和节点的 disabled/unavailable 展示不够明确。 | 源码有 loading/empty/error 和 selected/focus/hover，但未看到清楚的 disabled/unavailable 示例。 | 增加一个不可用节点或不可用来源示例，并补 `.is-disabled` / `[disabled]` 的视觉规则。 |
| low | `review-checklist.md`：截图/GIF 有记忆点，适合 README | 桌面首屏很稳，但“数字山水”的视觉记忆点仍偏背景层，整体更像东方编辑部而不是混合方向。 | `/tmp/oriental-atlas-desktop.png` 中图谱背景线条克制，山水/星图层次存在但不强。 | 可以适度强化中图的地貌层：增加 1-2 层更有识别度的等高线/星点路径，但保持低对比，不遮挡节点。 |

## 视觉评审

- 状态：available_model_image
- 来源：本地 HTML 截图 `/tmp/oriental-atlas-desktop.png`、`/tmp/oriental-atlas-tablet.png`、`/tmp/oriental-atlas-mobile.png`、`/tmp/oriental-atlas-mobile-lower.png`
- 说明：已使用截图进行视觉检查。桌面版符合度高；移动端无横向溢出，但首屏策略弱化了图谱主角，部分按钮小于 44px。

## 决定

- 决定：tweak
- 策略是否保留：true
- 策略变化原因：无需改变策略，问题是局部响应式和状态覆盖不完整。
- 提示意图：targeted_modification

## 下一轮提示摘要

保留：

- 保留米白纸面、墨色文字、朱砂强调、青绿/夜青辅助的视觉系统。
- 保留左侧文献索引、中间知识舆图、右侧札记详情的桌面三栏结构。
- 保留状态面板、置信度图例、社区导航、学习队列和推荐起点。
- 保留无外部依赖、单文件 HTML、vanilla CSS/JS 的落地方式。

修改：

- 修正移动端触控目标，所有按钮和可点卡片至少 44px 高，窄按钮至少 44px 宽。
- 调整移动端内容顺序或增加图谱预览卡，让 375px 首屏能看到“数字山水图谱”的存在。
- 增加 disabled/unavailable 节点、来源或按钮状态示例。
- 稍微强化中央图谱的山水/星图视觉记忆点，但不要遮挡节点和边。

验收检查：

- 375px 截图首屏能看到标题、关键状态和图谱预览，不只看到文献索引。
- 所有 `button/input/a` 在移动端可点击区域不小于 44px。
- 1440、768、375 三档无横向滚动，无控制台错误。
- loading、empty、error、selected、focus、disabled/unavailable 状态都能被看见或触发。
