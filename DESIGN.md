---
name: Codex-bar
description: 本机用量浮层的双刻度设计系统
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
    fontSize: "21px"
    fontWeight: 600
    lineHeight: "25.2px"
    letterSpacing: "-0.024em"
  secondary-reading:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: "20.25px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "18px"
    letterSpacing: "-0.008em"
  period:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "11.5px"
    lineHeight: "1"
  body:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: "15px"
  legend:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "9.5px"
    lineHeight: "14px"
  day-label:
    fontFamily: "var(--default-font-family, \"Segoe UI Variable\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif)"
    fontSize: "9px"
    lineHeight: "18px"
rounded:
  panel: "20px"
  track: "8px"
  control: "6px"
  cell: "4px"
spacing:
  panel-inset: "12px"
  track-inset: "2px"
  row-gap: "6px"
  legend-gap: "8px"
components:
  button-apply:
    backgroundColor: "{colors.sand-light-12}"
    textColor: "{colors.sand-light-2}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  button-apply-dark:
    backgroundColor: "{colors.sand-dark-12}"
    textColor: "{colors.sand-dark-2}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  button-ghost:
    rounded: "{rounded.control}"
    padding: "4px 8px"
  period-track:
    backgroundColor: "{colors.sand-light-3}"
    rounded: "{rounded.track}"
    padding: "{spacing.track-inset}"
  endpoint-input:
    rounded: "{rounded.control}"
    height: "25px"
    padding: "0 6px"
  primary-reading:
    labelMinWidth: "64px"
    columnGap: "8px"
  daily-bar:
    rounded: "{rounded.cell}"
    height: "46px"
---

# Design System: Codex-bar

## Overview

**Creative North Star: "本机用量 · 双刻度"**

以用户实机反馈后的双刻度方案为视觉依据：两个主要指标上下分行，标签在左、数值在右且共用右边界，取消静态语义记号。紧凑的 Sand 浅深表面承接侧栏中的短时观察，详细口径按需披露。

本文记录 2026-11-04 候选渲染层已经采用的令牌与组件。令牌以前置表为准；主题选择沿用宿主，面板颜色由局部 Sand 令牌控制，不把旧版半透明宿主材质继续作为本轮要求。

**Key Characteristics:**
- 上下分行的双主读数，每行标签左对齐、数值右对齐。
- 同心圆角、对称内边距与低噪声分隔。
- 数据色语义稳定，缺失与错误明确可见。
- 开合可打断，文字不缩放，完成后清理临时样式。

## Colors

中性使用 Sand 十二级，浅深主题分别对应 `sand-light-*` 与 `sand-dark-*`；这些值来自当前作用域内的 CSS，不是全局主题替换。

### Primary

主交互使用 Sand 主文字与浮层表面的反相组合；选中时间使用中性滑块，不引入额外品牌色。

### Secondary

非缓存输入使用浅灰／深灰，缓存输入使用固定绿，输出使用浅深蓝。每日柱从下向上为缓存、非缓存、输出；构成横条从左向右为非缓存、缓存、输出。非缓存段无缓存底座时加细边，构成横条最左段也保留细边。

**The Stable Data Color Rule.** 灰只表达非缓存输入，绿只表达缓存输入，蓝只表达输出；数据色用于图形，读数文字使用中性 ink。

警示使用 red 的文字、底和边框组合，不拿缓存绿表示成功。Sidecar 中额外生成的色带只服务预览，不是新增生产颜色。

### Neutral

Sand 1 用于宿主背景语境，2 为浮层实底，3 为内嵌和轨道，4／5 表达悬停／按下，6 为细分隔，7 为边框，8 为浮层外边。12 为主文字，11 为次文字；10 只用于未来日期等非正文元素。

## Typography

字体继承宿主 `--default-font-family`，缺失时使用前置表中的系统字体栈。数字使用等宽数字 `tabular-nums`，不为本轮引入字体资源。

主读数、次读数及正文的三层尺度分别对应 `primary-reading`、`secondary-reading`、`body`。标题、时间选项、图例、日标使用各自较紧凑的角色；单位可以降级，数值本身不能为塞进并排列而缩小。

主读数保持负字距并统一右对齐，次读数用 `margin-left:-.008em` 校正视觉左缘。图例色块与开关圆点保留半像素的纵向光学校正。长估算允许在破折号之后换行，上下界各自保持成组。

## Layout

浮层从官方额度按钮上方的统计入口向右展开，沿当前宿主几何定位并限制在视口内。当前宿主参考宽度是 260 CSS px：官方按钮 `aria-controls` 关联的真实菜单可见，且菜单 `role=menu`、`aria-labelledby` 匹配时，读取可见宽度并按按钮 CSS 缩放换算为 CSS 宽度，缓存供后续开合使用。首次原生菜单尚未出现时沿用当前宿主 `--spacing × 65`；此时没有可供读取的原生菜单矩形。

面板左右对称内边距对应 `panel-inset`。两个主指标上下排列，每行左侧为标签、右侧为数值；提示跨整行放在下方，次读数仍为两列。每日图后接默认折叠的构成和模型，低频内容进入设置。单日范围隐藏日图；本周固定七格。自选编辑器纵向排列开始／结束行，快捷时长与精细调整均为草稿，Apply 才提交。

**The Concentric Corners Rule.** 同心圆角按外层圆角减去内缩量递减，保持面板、轨道、控件与数据格之间的几何关系。

没有额外的宽屏布局断点；缩放通过真实宿主 CSS 几何处理。设置正文的最大高度为 `min(404px, available-height - 42px)`，纵向可滚，隐藏滚动条，外层仍受视口约束。

## Elevation & Depth

本轮浮层使用 Sand 实底与细外边，`backdrop-filter:none`。阴影继承宿主下拉浮层 token，缺失时使用源码中的小阴影；时间滑块用一层轻微阴影，内容分区主要依赖调性和细分隔。旧版 90% 透明度与 blur(8px) 是历史测量和旧实现，不再作为当前面板材质。

**The Material With Content Rule.** 材质与内容共同进入和退出；中断或反向从当前可见状态继续，结束清理临时样式与动画。

设置进入和返回均为 260ms 高度过渡，切换前量取当前可见高，结束清理临时内联样式。其余动作沿用现有 Motion／WAAPI：时间滑块 240ms、日明细 140ms。不得缩放文字；减少动态效果或进入后台时立即完成并清理。

## Shapes

面板、轨道／日历、按钮／输入、格／柱分别对应前置表的四级圆角（20 → 8 → 6 → 4）。外层面板圆角沿用当前宿主 `--radius-2xl`，20px 是本机已确认参考值；小型数据图形的圆角由父级裁切，堆叠段之间不留缝。焦点使用中性两像素轮廓与两像素间距。

## Components

### Buttons

Apply 为 ink 实心按钮；其余主要是透明背景的文字或图标按钮，悬停使用 Sand 4，按下使用 Sand 5。焦点轮廓保持可见，动画期间允许再次操作。不存在本轮新增的彩色行动按钮或信息 chip。

### Time navigation and inputs

今日／本周／自选共用三格轨道和持久滑块，按 `left` 插值移动。开始与结束纵向排列，日期、秒级时间和日历按钮保留原生输入语义及明确标签；5／10／30／60min 快捷与细调滑轨不触发请求，Apply 才提交。

### Reading blocks

不再显示本机估算区间或账号变化的静态示意符号，含义由标签、估算符号及百分比／百分点单位表达。主读数下只保留必要的数据覆盖／校正状态，Token 与 API 口径拆分放在设置。首读骨架与真实行的结构、行高一致；刷新保留旧数字与原结果时间，失败保留原因与恢复入口。

### Daily chart and composition

日柱轨道高度由 `daily-bar` 控制，本周固定显示周一至周日。无记录用基线上的虚线短桩；未来日期保留空位、降低基线和日标层级，以非按钮节点呈现。点日期只更新该日明细，不查询、不改变主读数区间。柱选中使用 ink 混合描边，浅灰在无缓存段时保留可见边界。图例始终有文字。

### Disclosures and settings

构成、模型默认折叠，行文字与计数保持统一小字阶。设置聚合参考套餐、周基准、Token／API 拆分、ModelDial、价格、口径限制、提醒偏好与诊断；来源和提示可继续展开，正文在自身区域滚动。

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
