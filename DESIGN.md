---
name: Codex-bar
description: 本机用量浮层的视觉与交互规范
colors:
  sand-light-1: "#fdfdfc"
  sand-light-2: "#f9f9f8"
  sand-light-3: "#f1f0ef"
  sand-light-4: "#e9e8e6"
  sand-light-5: "#e2e1de"
  sand-light-6: "#dad9d6"
  sand-light-7: "#cfceca"
  sand-light-8: "#bcbbb5"
  sand-light-9: "#8d8d86"
  sand-light-10: "#82827c"
  sand-light-11: "#63635e"
  sand-light-12: "#21201c"
  sand-dark-1: "#111110"
  sand-dark-2: "#191918"
  sand-dark-3: "#222221"
  sand-dark-4: "#2a2a28"
  sand-dark-5: "#31312e"
  sand-dark-6: "#3b3a37"
  sand-dark-7: "#494844"
  sand-dark-8: "#62605b"
  sand-dark-9: "#6f6d66"
  sand-dark-10: "#7c7b74"
  sand-dark-11: "#b5b3ad"
  sand-dark-12: "#eeeeec"
  chart-input-light: "#d8dce0"
  chart-input-dark: "#4a5058"
  chart-cache: "#30a46c"
  chart-output-light: "#0d74ce"
  chart-output-dark: "#70b8ff"
  warning-light: "#ce2c31"
  warning-dark: "#ff9592"
  warning-bg-light: "#feebec"
  warning-bg-dark: "#3b1219"
  warning-border-light: "#f4a9aa"
  warning-border-dark: "#8c333a"
typography:
  primary-reading:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: "1.1"
    letterSpacing: "-0.022em"
  secondary-reading:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16.5px"
  title:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "-0.01em"
  period:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "11px"
    lineHeight: "1"
  body:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "15px"
  legend:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "10.5px"
    lineHeight: "15px"
  day-label:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "9px"
    lineHeight: "18px"
rounded:
  panel: "22px"
  track: "9px"
  control: "6px"
  cell: "4px"
spacing:
  panel-inset: "12px"
  grid-columns: 4
  grid-gutter: "8px"
  component-gap: "8px"
  item-gap: "12px"
  group-gap: "16px"
  track-inset: "2px"
  row-gap: "8px"
  legend-gap: "8px"
components:
  button-apply:
    textColor: "{colors.sand-light-12}"
    rounded: "{rounded.control}"
    padding: "2px"
  button-apply-dark:
    textColor: "{colors.sand-dark-12}"
    rounded: "{rounded.control}"
    padding: "2px"
  button-ghost:
    rounded: "{rounded.control}"
    padding: "4px 8px"
  period-track:
    backgroundColor: "{colors.sand-light-3}"
    rounded: "{rounded.track}"
    padding: "{spacing.track-inset}"
  endpoint-input:
    rounded: "{rounded.control}"
    height: "28px"
  daily-bar:
    rounded: "{rounded.cell}"
    height: "46px"
---

# Design System: Codex-bar

## Overview

以 [新版视觉预览](docs/local-usage-preview-20261117.html) 为界面依据。左对齐的大字额度估算领先，账号采样和 Token／API 等值随读数顺序展示。设置按提醒、参考和维护分组。当前生产界面采用下述布局与字阶。

## Colors

中性使用 Sand 十二级，浅深主题分别对应 `sand-light-*` 与 `sand-dark-*`；这些值来自当前作用域内的 CSS，不是全局主题替换。

### Primary

主交互使用 Sand 主文字与浮层表面的反相组合；选中时间使用中性滑块，不引入额外品牌色。

### Secondary

非缓存输入使用浅灰／深灰，缓存输入使用固定绿，输出使用浅深蓝。每日柱从下向上为缓存、非缓存、输出；构成横条从左向右为非缓存、缓存、输出。非缓存段无缓存底座时加细边，构成横条最左段也保留细边。

**The Stable Data Color Rule.** 消耗图形用灰、绿、蓝区分非缓存输入、缓存输入和输出。账号采样行使用有明确标签的绿色数字，采样不足和覆盖缺口有文字状态。

警示使用 red 的文字、底和边框组合，不拿缓存绿表示成功。Sidecar 中额外生成的色带只服务预览，不是新增生产颜色。

### Neutral

Sand 1 用于宿主背景语境，2 为浮层实底，3 为内嵌和轨道，4／5 表达悬停／按下，6 为细分隔，7 为边框，8 为浮层外边。12 为主文字，11 为次文字；10 只用于未来日期等非正文元素。

## Typography

字体继承宿主 `--default-font-family`，缺失时使用前置表中的系统字体栈。数字使用等宽数字 `tabular-nums`，不为本轮引入字体资源。

主读数、次读数及正文的三层尺度分别对应 `primary-reading`、`secondary-reading`、`body`。标题、时间选项、图例、日标使用各自较紧凑的角色；单位可以降级，数值本身不能为塞进并排列而缩小。

本机主读数左对齐，26px、700 字重。账号读数、Token 与 API 等值采用 11px。其他设备的说明随账号读数合排，Token 和 API 等值独立成组。长估算允许在破折号后换行，窄空间下保留两端读数。

## Layout

浮层从官方额度按钮上方的统计入口向右展开，限制在视口内。默认宽度与本机原生头像菜单一致，为 228 CSS px。头像菜单打开时读取其布局宽度，按头像按钮的关联属性识别菜单，供后续展开使用。

窄浮层采用四列栅格、左右各 12px、列距 8px。统计、日历和设置复用相同的水平边距。标题与分段控件通栏，刷新在标题右侧，更新时间和本机控件版本在页脚。卡片随当前内容调整高度，视口不足时保留上下各 12px 安全距离。统计及设置正文可在浮层内滚动，隐藏滚动条，保留滚轮和键盘操作。

今日优先展示实际 Token 构成比例，本周直接展示固定七格的每日图。点击 Token／API 等值摘要可展开准确计数、缓存命中率、模型和核验信息。点主读数上方的区间标签可用原结果的起止时间开启草稿。当前范围和覆盖情况仍以真实返回为准。

## Elevation & Depth

浮层使用 Sand 实底与轻阴影，选中的分段按钮由中性底板标识。内容分区主要依赖调性和细分隔。

**The Material With Content Rule.** 材质与内容共同进入和退出；中断或反向从当前可见状态继续，结束清理临时样式与动画。

设置往返、折叠和展开均从当前可见的上下边缘接续，收尾后清理临时样式。入场中收到用量结果时同步过渡高度，期间进入设置会保留当前边缘、横向位置和透明度。动画尺寸按 CSS 缩放比例换算，文字和图标保持原大小。时间范围、快捷时长、设置分组的选中底板使用同一套 220ms 位移过渡。日明细为 140ms。减少动态效果或进入后台时立即完成并清理。

## Shapes

面板、轨道／日历、按钮／输入、格／柱分别对应前置表的四级圆角（22 → 9 → 6 → 4）。小型数据图形的圆角由父级裁切，堆叠段之间不留缝。焦点使用中性两像素轮廓与两像素间距。

## Components

### Buttons

“应用”是日期组最后一行的文字按钮。其余主要是透明背景的文字或图标按钮，悬停使用 Sand 4，按下使用 Sand 5。焦点轮廓保持可见，动画期间允许再次操作。不存在本轮新增的彩色行动按钮或信息 chip。

### Time navigation and inputs

浮层每次打开默认进入「今日」。10 分钟／今日／本周／自选共用四格轨道，每格高 24px。开始和结束各占一行，共用日期、秒级时间和日历按钮的列线。日历在对应行下方展开。30 分钟、1 小时、3 小时、5 小时的快捷选项以及精细调整均保存为草稿，点击“应用”后查询。

### Reading blocks

浮层用百分比显示本机额度估算，用百分点显示账号采样变化。采样覆盖不完整时在同一行标“部分”。Token 与 API 口径拆分放在设置。首读骨架保留主读数和图形的位置，回包后随真实内容自然收合。刷新保留旧数字与原结果时间，失败保留原因与恢复入口。

### Daily chart and composition

日柱轨道高度由 `daily-bar` 控制，本周固定显示周一至周日。无记录用基线上的虚线短桩；未来日期保留空位、降低基线和日标层级，以非按钮节点呈现。点日期只更新该日明细，不查询、不改变主读数区间。选中底板与对应日期柱共用中心线，柱使用 ink 混合描边。浅灰在无缓存段时保留可见边界。各颜色的语义由构成图例和明细提供。

### Disclosures and settings

设置通过「提醒」「参考」「维护」三个分段切换。提醒页提供低额度、额度恢复以及适用的系统通知开关。参考页展示档位、ModelDial、OpenAI 价格和按需展开的估算口径。维护页提供自检、可用的诊断复制和版本说明。

## Do's and Don'ts

### Do:

- **Do** 保持主读数上下堆叠；长范围按上下界分组换行。
- **Do** 使用 Sand 11／12 作为正文层级，保留标签和文字图例。
- **Do** 在草稿提交前保留原结果及其真实时间。
- **Do** 将来源、参考档位、价格与诊断集中在设置中。
- **Do** 遵守减少动态效果、键盘焦点与强制颜色模式。

### Don't:

- **Don't** 把本机估算、账号百分点变化或 API 等值改称真实本机扣量或实付费用。
- **Don't** 用数据色给读数文字着色，或把无记录与采样不足填成零。
- **Don't** 让浅灰段无边界地贴住面板底色；无缓存底座时保留描边。
- **Don't** 把未来日期生成为可聚焦或可点击的按钮。
- **Don't** 恢复四个内容页签、旧 footer 额度卡、独立窗口或居中大 Modal。

来源：[产品事实](PRODUCT.md)、[本轮视觉指令](docs/codex-implementation-brief-20261104.md)、[目标界面](docs/local-usage-dual-scale-20261104.html)、[实际渲染源码](native-patch/native_patch.source.js)。本文记录实现，不替代测试、实机部署或发布证据。
