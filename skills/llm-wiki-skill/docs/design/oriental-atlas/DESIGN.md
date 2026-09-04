---
version: alpha
name: LLM Wiki Oriental Editorial Atlas
description: 东方编辑部与数字山水混合的知识图谱视觉系统。
colors:
  background: "#F4EFE4"
  surface: "#FFFDF7"
  text: "#241F1A"
  muted_text: "#6F6559"
  border: "#D8CDBB"
  primary_action: "#8B2E24"
  success: "#3E6B4B"
  warning: "#B7791F"
  danger: "#A23B2A"
  info: "#315F72"
  ink: "#241F1A"
  rice_paper: "#F8F1E4"
  vellum: "#E9DDC9"
  cinnabar: "#8B2E24"
  jade: "#4B7564"
  mountain_line: "#CFC4B1"
  constellation: "#315F72"
  mist: "#ECE5D8"
typography:
  display:
    fontFamily: "Noto Serif SC"
    fontSize: "32px"
    fontWeight: "700"
    lineHeight: "1.18"
  title:
    fontFamily: "Noto Serif SC"
    fontSize: "22px"
    fontWeight: "700"
    lineHeight: "1.28"
  heading:
    fontFamily: "Noto Sans SC"
    fontSize: "16px"
    fontWeight: "700"
    lineHeight: "1.45"
  body:
    fontFamily: "Noto Sans SC"
    fontSize: "14px"
    fontWeight: "400"
    lineHeight: "1.65"
  caption:
    fontFamily: "Noto Sans SC"
    fontSize: "12px"
    fontWeight: "400"
    lineHeight: "1.45"
  label:
    fontFamily: "Noto Sans SC"
    fontSize: "12px"
    fontWeight: "700"
    lineHeight: "1.2"
rounded:
  sm: "6px"
  md: "10px"
  lg: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "36px"
components:
  button-primary:
    backgroundColor: "#8B2E24"
    textColor: "#FFFDF7"
    borderColor: "#8B2E24"
  panel:
    backgroundColor: "#FFFDF7"
    textColor: "#241F1A"
    borderColor: "#D8CDBB"
  chip:
    backgroundColor: "#E9DDC9"
    textColor: "#241F1A"
    borderColor: "#D8CDBB"
  canvas:
    backgroundColor: "#F4EFE4"
    textColor: "#241F1A"
    borderColor: "#CFC4B1"
  warning-card:
    backgroundColor: "#F8E8C4"
    textColor: "#241F1A"
    borderColor: "#B7791F"
design_system:
  reference_direction:
    id: enterprise_data_workspace
---

## Overview

这套视觉系统用于 llm-wiki 的知识图谱 HTML。目标是把图谱从“功能 demo”提升为“可长期使用的高级知识地图”，同时保持搜索、筛选、panel、row、metadata、source、detail 等工作台能力。Reference direction: `enterprise_data_workspace`，并用 `premium_visual_showcase` 的克制展示机制强化中央图谱的首屏舞台感。

## Visual Theme

主题是“东方编辑部 × 数字山水”。东方感来自中文编辑排版、文献索引、朱砂批注、纸本地图和档案馆层级；数字感来自图谱节点、关系路径、社区地貌、轻微星图发光和数据状态。不要把东方感做成装饰贴纸，也不要把数字山水做成游戏 UI。

## Colors

底色使用米白、宣纸和旧地图册的暖中性色，避免纯白。正文使用墨色 `#241F1A`，弱文本使用 `#6F6559`。主要行动和选中状态使用朱砂 `#8B2E24`，信息状态使用夜青 `#315F72`，成功状态使用青绿 `#3E6B4B`，warning 使用琥珀 `#B7791F`，danger 使用更重的朱红 `#A23B2A`。

中央图谱可以出现极淡的山水等高线、雾层和社区色块，但所有背景色都必须低对比，不能压过节点、边和标签。

## Typography

标题和关键章节可用中文 serif 气质，正文和控件用清晰 sans。不要依赖外部付费字体或网络字体；实现时优先系统字体 fallback。标题要像出版物目录，不要像 marketing hero。节点标签和 metadata 要短、稳、可截断，英文、数字和置信度标签要保持等宽或紧凑节奏。

## Layout

整体仍是三层工作台：左侧索引导航，中间图谱画布，右侧详情抽屉。左侧像“文献目录”，中间像“知识舆图”，右侧像“批注札记”。顶栏不要像临时 toolbar，而要像产品标题区，展示知识库名称、当前视图、GitHub/项目入口和图谱状态。

13 寸屏优先保证图谱和详情可读，panel 宽度要克制。窄屏时不要硬塞三栏，可把左侧导航折叠，详情抽屉变成底部或全屏 detail view。

## Elevation & Depth

深度来自纸张叠层、细边框、轻阴影和局部墨色压边，不来自厚重玻璃拟态。图谱画布是最底层的地图纸，节点像贴在地图上的索引点，详情 panel 像覆盖其上的札记卡。hover 和 selected 可以增加一层极轻阴影或朱砂描边，但不能让页面变脏。

## Shapes

形状要克制：panel 使用 10px 到 18px 圆角，节点可以是圆角卡片、印签或小型地图标注。状态 chip 使用 pill。不要使用过多不规则手绘边框；如果使用 rough.js 质感，只用于少量重点元素，避免整页显得像草稿。

## Components

- Search input：default 清爽，hover 增加边框深度，pressed 或 active 显示朱砂细线，disabled 置灰但保留说明，focus 必须有可见 outline，error 显示明确文本。
- Node：default 显示类型和短标签，hover 显示关系提示，focus 支持 keyboard 导航，selected 使用朱砂描边和轻微光晕，disabled/unavailable 降低透明度但保留可读标签，error 数据节点要显示警示而不是消失。
- Edge：按置信度和权重区分线型；EXTRACTED 稳定，INFERRED 更细或虚线，AMBIGUOUS 用 warning 语义，UNVERIFIED 不应和确认关系混淆。
- Detail panel：包含 source、metadata、neighbors、notes 和 actions；row 高度稳定，长文本渐进展开。
- Buttons：primary action 用朱砂，default/hover/pressed/disabled/focus/error 状态都要设计；次要按钮只用墨色或细边框。
- Data states：loading 显示地图纸上的轻量占位；empty 解释如何生成图谱；success 可以用短状态条；error 给出资源或数据失败原因；permission/unavailable 虽然本地 HTML 很少发生，也要有占位样式。

## Atlas Grammar

图谱画布必须像知识舆图，而不是一组浮动信息卡。普通节点默认是地图地名：轻量点位、短标题、低面板感，只承担定位和识别。重要节点是索引签条：用于推荐起点、搜索命中、核心节点和高权重节点，标题更完整，边框和纸面层次更明确。选中节点是朱砂批注：用朱砂描边、批注光晕和右侧札记栏形成呼应，但不能遮住相邻节点。

密度越高，节点越要减负。少量节点可以保留签条和短元信息；中量节点收为紧凑标签；大量节点只保留点位和少量重点标签。推荐起点、搜索命中和选中节点在任何密度下都不能降级成不可识别的点。

小地图是地图册右下角的方位图，不是第二张图谱。它使用低对比山水线和社区点位，当前视口用朱砂细框，选中节点用印点标记。小地图只负责定位、反馈当前视口和辅助回到空间关系，不能在视觉重量上抢过中央画布。

学习队列像书签条或札记条，不像横向 chip。每条最多两行标题，左侧用细线或色点表达类型，第二行承载类型、来源或札记状态。空队列只给真实空态，不放静态示例。

右侧详情分为常驻札记态和阅读态。首次打开或未选中时，它展示“从这里开始”的预览或当前范围提示；用户点击节点后进入阅读态，标题、来源路径、正文、wikilink 和代码块都要顺畅阅读。关闭阅读或回到全图时，画布重新成为主角。

首次打开必须是软引导：全局图保持中立，不自动选中推荐起点；推荐起点只以索引签条、弱高亮和右侧预览出现。用户点击推荐起点后，才进入选中节点、邻域高亮和阅读态。

## Responsive Behavior

桌面采用三栏，平板采用可折叠左栏和右侧抽屉，移动端采用“搜索/列表/详情优先”的降级结构。触控目标至少 44px，touch 状态不能只靠 hover。长标签、长来源名和多社区列表必须截断或折行，不允许横向撑破页面。

## Motion & Feedback

动效要像翻页、批注浮现、地图层级淡入，而不是弹跳和炫光。节点 hover 可以有 120-180ms 的轻微提升；抽屉打开使用 220-280ms。必须支持 reduced motion：关闭雾层流动、节点漂浮和过强光晕，只保留颜色、边框和透明度变化。

## Content Voice

文案像一位清楚的中文编辑：短句、具体、不卖弄。按钮和状态文案要告诉用户下一步，例如“查看相邻节点”“加入学习队列”“没有匹配结果，清除筛选”。不要用空泛的“AI-powered insight”“探索无限可能”。

## Do's and Don'ts

Do:

- 用文献目录、批注、札记、地图和索引隐喻建立高级感。
- 让中央图谱有山水/星图舞台感，但只作为信息的背景层。
- 明确区分 loading、empty、success、error、permission 和 unavailable。
- 保证 keyboard、focus、44px touch、对比度和 reduced motion。
- 使用真实 source、detail、metadata、panel 和 row 信息证明产品成熟。

Don't:

- 不复制任何具体品牌、logo、页面、专有字体或视觉系统。
- 不做只有氛围、没有产品功能结构的展示页。
- 不堆泛化 AI 渐变、玻璃拟态、荧光蓝紫和随机卡片。
- 不把中国风做成纹样贴图或毛笔字堆叠。
- 不让背景地形线、雾层、发光遮挡节点标签和关系边。

## Reference Direction

主参考方向是 `enterprise_data_workspace`。使用它的机制：高密度但清楚的工作台、搜索、filter、panel、row、metadata、source detail、状态和可重复使用效率。辅助参考 `premium_visual_showcase` 的机制：让核心对象在首屏可被检视，用克制的视觉舞台提升记忆点。只借机制，不复制任何外部品牌资产。

## Agent Guidance

生成设计时先出 2-3 个视觉 variant，再深入一个方向。所有 variant 都必须保留真实产品结构：左侧索引、中间图谱、右侧详情、搜索、筛选、洞察、图例或学习队列入口。不要生成纯展示图。实现建议优先通过 CSS token、背景层、节点样式、panel 样式和状态样式改造现有自包含 HTML，不要求引入大型框架或外部依赖。
