# Codex Usage Card

Codex Usage Card 在 Codex 桌面端列表侧栏底部提供一行额度入口，默认收起，点击向上展开详情。现在仅支持官方 ChatGPT 账户额度，已移除 API 余额版本。它不修改 Codex 安装目录，不改变主题和模型列表，也不会记录或输出 API Key。

## 一键安装

要求：Windows 11、PowerShell 7，以及能够正常启动的 Codex 桌面端。卡内自检使用标准安装位置 `%ProgramFiles%\PowerShell\7\pwsh.exe`。

在 PowerShell 7 中运行：

```powershell
$installer = Join-Path $env:TEMP 'install-codex-usage-card.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/DrFanghaiz/codex-usage-card/v2.3.0/install.ps1' -OutFile $installer; Unblock-File -LiteralPath $installer; & $installer
```

安装器会校验发布包的 SHA-256，把 Skill 安装到 `$CODEX_HOME\skills`（未设置时为 `$env:USERPROFILE\.codex\skills`），把无窗口修复器部署到 `$env:LOCALAPPDATA\CodexUsageCard`，并注册当前用户的计划任务 `Codex Usage Card`。从旧版升级时，只迁移路径与动作完全匹配的旧任务。安装完成后会输出 `ActivationState`、`StageCodes` 和 `CardVisible` 等只读验收结果；Codex 未运行时显示等待状态，不把已完成安装误报为失败。

如果只安装 Skill，不立即部署控件：

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" --repo 'DrFanghaiz/codex-usage-card' --path 'skills/codex-usage-card'
```

安装后重新启动 Codex，使新 Skill 出现在可用 Skill 列表中。

## 工作方式

- 新版界面的初始数据和几何契约见 [`spec.md`](docs/quota-sidebar-v3/spec.md)，后续已确认的外观与动画以[当前设计方案](docs/codex-bar-proposal-20260926.html)为准；发布验证见 [v2.3.0 验证记录](docs/releases/v2.3.0.md)。官方模式沿用 Helper 校验后的真实额度窗口；原生单窗口数据仍可作为回退来源，未知窗口逐条呈现。
- 入口上沿按宿主头像实际矩形对齐，兼容宿主自身缩放；footer 在 `.sidebar-navigation` 中正常留位。弹层打开时按实测列表列宽取 `min(272px, 列宽 − 16px)`，不越出列表列，矮窗口可内部滚动。官方横线表示已用，高 2px，L2 方案填充至少 3px。浅色轨道 `#E2D8C4`、填充 `#8E4617`，额度数字字重 600；时间环为 10px/描边 2.75。深色填充结合宿主前景调亮，表面与文字优先使用宿主 token。
- 折叠侧栏入口使用 20px 自绘仪表，1.33px 轮廓、三枚轻刻度与轴心，背景和图标色与宿主导航一致。指针显示官方剩余额度：左 0%、上 50%、右 100%；多窗口采用剩余最少者，悬停说明窗口。随现有刷新回包更新并平滑转动，不额外轮询；失败保留上次值，无数据隐藏指针。
- 页面可见时使用唯一的自适应单次计时器：最近聚焦 5 分钟内每 2 分钟、聚焦后 5 分钟至 1 小时每 5 分钟、闲置 1–4 小时每 15 分钟、超过 4 小时每 30 分钟；若额度值刚发生变化则维持 5 分钟档。页面隐藏时立即停表，恢复可见或重新聚焦时按新鲜度补刷新。失败重试继续服从至少 60 秒及服务端 `Retry-After` 冷却，不监听键盘、不扫描进程或会话文件。
- 官方时间圆环从真实重置时间戳按 7 天或 5 小时窗口计算，复用同一个单次计时器按分钟更新，不额外请求网络。只有原生重置文字而没有时间戳时保留文字与空轨道，不猜测周期。
- 登录配置短暂不完整时通过文件系统事件等待恢复，不做每秒轮询，也不会永久退出。
- 按用户要求恢复 v1.9 的启动逻辑：Helper 启动时记录并保护已经打开的 Codex；之后从官方入口新启动且缺少调试端口的主进程，在核实会话、PID、创建时间和路径后自动结束，最多等待 5 秒退出，再携带动态 loopback 调试参数重开一次，不再弹出确认框。同一进程身份最多处理一次；网络、登录及额度错误不触发重启。
- 桌面“Codex（额度卡）”入口保留为可选项，由无窗口启动器查询当前用户注册的 Codex 包和主应用 ID，通过 Windows 包激活接口携带动态 loopback 调试参数启动，保留 MSIX 程序包身份；客户端更新后无需改快捷方式。已有 Codex 时只尝试唤回，无论该窗口是否带调试端口；没有现有进程时启动一次。Codex++ 等已带端口的启动保持不变。
- 自动重启等待原进程退出后，会提交替代启动，由 Codex 自己处理单实例竞争；短暂的转发进程不会取消重开。启动诊断保存在 `%LOCALAPPDATA%\CodexUsageCard\startup.log`，仅记录阶段、PID 和失败信息，不记录账号或命令行；`relaunch-returned` 只代表启动调用返回，实际入口状态以 doctor 为准。
- Codex 更新、重启、调试端口变化或页面重载后，后台修复器会重新发现页面并注入控件。
- 侧栏收起后，同一入口移入导航栏底部帮助按钮上方；展开后回到列表底部。找不到有效宿主锚点时入口隐藏，观察器在锚点恢复后重新挂载。

Codex 必须暴露本机调试端口，修复器才能向页面注入控件。可以继续使用官方入口，后台会为新启动的客户端补上端口。安装或升级 Helper 前已经存在的无调试会话不会被结束，需要在方便时关闭后重新从官方入口启动一次；桌面“Codex（额度卡）”也可直接带参数启动。无可连接进程时后台等待窗口显示或激活事件，避免依赖可能被普通用户权限拒绝的系统进程跟踪，不轮询或不断重启尝试恢复。若官方彻底删除调试入口、阻止启动参数或改变内部额度组件契约，修复器会明确失效，不会用猜测规则伪装成功。

历史上的 v1.0–v1.7 只挂接已经开放端口的客户端；启动脚本或 Codex++ 从第一次启动就附带连接参数时，可以一次打开便加载额度卡。v1.8 才加入普通入口的自动二次重启。恢复前一种体验需要入口在第一次启动时传入参数，单独回退控件 UI 不会给普通启动补上端口。

## 设置、提醒与可靠性

- 常驻额度入口使用轻玻璃背景和浅边框；真实 Pro 单本周与 Plus 双窗口使用 32px 图形入口（仅本周绘条），其他数据及窄栏保留 30px 文字入口，底距随宿主实测重新推导。展开弹层与收起条统一使用宿主小圆角，采用 90% 宿主表面色、8px 模糊及无边框；不支持模糊或高对比度环境回退不透明 + 0.8px 边框。设置在同一原生 popover 中替换额度内容，保留低额度提醒、恢复提醒、系统通知、阈值、12 小时制和只读自检；开关使用自绘轨道及原生 checkbox 语义。旧紧凑模式与透明度偏好不再改变新控件。收起额度条与展开卡共用 P1 无描边胶囊徽章：Pro 为暖赭柔底，Plus 为中性柔底；整体无渐变或遮罩。官方 Pro/Plus 展开态采用 X-A：本周 20px 焦点数字和细条，5h 缩小为副行；头部保留刷新与设置，收起按钮固定在右下并与设置共用中心轴。重置时间随可用宽度换行；亦可用 Escape 或外部点击关闭。
- 默认剩余 20%、10% 提醒，各额度窗口分别去重；一次下降越过多档只提示一次。恢复提醒独立开关，需真实官方回包显示重置时间推进且额度增加。没有后台历史记录或趋势图，只保存当前提醒去重所需的最近状态。Helper 重启后随机会话标记更新，提醒重新计数。
- 提醒在有可见 Codex 页面并收到额度更新时触发。设置与通知去重使用本机浏览器存储和 Web Locks；系统通知需显式开启，宿主未授权时仍保留卡内提示。页面全部隐藏时继续沿用停表策略，不承诺关闭客户端后的后台通知。
- 额度状态显示在原标题和刷新图标处，不在底部常驻更新时间或额外增加状态行。成功反馈约 2 秒；失败保留上次成功数值，悬停或键盘聚焦刷新按钮可查看原因和上次成功时间，读屏仍可获取完整状态。无数据写明“暂不可用”。低额度除状态点外还显示剩余数值。
- 页面请求超过 25 秒会结束等待并允许重试；每次请求有独立编号，迟到的旧回复不能结束新请求或覆盖其状态。隐藏页恢复时会检查原始截止时间，重注入不会延长等待。Helper 的 HTTP 请求和活动调试命令都有 15 秒总期限，卡住后沿用重连流程；空闲连接不增加轮询。账号切换先隐藏旧数据，收到新会话数据后恢复；同账号令牌或配置更新不清空提醒去重状态。
- 设置中可以运行只读自检、复制脱敏结果，以及打开公开最新版本说明。自检逐个检查 Codex 主窗口，全部入口可见才报告成功，缺入口或未检查不会被其他窗口的成功掩盖。
- Helper 同时连接发现的多个主窗口，并通过页面目标事件接入同进程新窗口；并发刷新复用 5 秒请求缓存，服务端限流跨窗口共享。单窗口断线会重新发现整组页面。独立新进程的额外调试端口在下一次发现时接入。
- 重连时不会重放历史自检与刷新请求；同账号配置变化后仍遵循服务端未到期的冷却时间。
- 安装器先核实精确任务身份，再备份旧文件和任务配置。复制或启动检查失败会恢复旧版；运行目录与 Skill 目录的 `backups` 保留回滚证据。安装完成和卡片实际可见分别报告。

开发回归：`node --test tests/native_patch_runtime.cjs`（Playwright + Edge）；Windows PowerShell 5.1 运行 `tests/native_helper_regressions.ps1`、`tests/launcher_regressions.ps1`、`tests/startup_window_regressions.ps1` 和 `tests/installer_regressions.ps1`。窗口事件测试使用自行退出的不可见探针，不关闭真实 Codex。Python 测试继续使用下方命令。

实机包激活检查：已有带调试端口的 Codex 时，可用 Windows PowerShell 5.1 运行 `tests/packaged_activation_smoke.ps1`。它调用生产激活函数并读取返回进程的真实包身份，保留原客户端；完整冷启动仍需退出后从官方入口验收。

## 2.3 更新

本版仅支持官方 ChatGPT 账户额度，移除 API 余额卡与相关请求链。使用 API Key 登录的用户将看到“暂不可用”，不会显示虚构的官方额度。

折叠侧栏入口改为与导航一致的动态仪表，指针显示剩余额度。设置页按显示/提醒分组，切换与收起可中途打断；图标模式关闭时材质与内容共同淡出，修复白色方块和快速切页跳变。

完成通知授权、真实数据校验、账户切换、连接超时、重复注入与安装进程身份等修复；保留同账户服务端冷却和失败时的上次成功数据。普通官方入口启动逻辑、MSIX 包身份及已打开会话保护保持。

## 命令行自检

安装后可随时运行：

```powershell
& "$env:USERPROFILE\.codex\skills\codex-usage-card\scripts\doctor.ps1"
```

Doctor 只检查精确计划任务、无窗口 Helper、Codex 本机调试页面和真实可见入口，不读取或输出凭据、账户标识或原始 API 响应。`CardVisible` 保留原字段名：新版入口可见即正常，弹层无需展开，额度请求失败不会误报安装失败。`$null` 表示页面未检查；`$false` 表示已检查但入口不可见。旧版客户端仍支持旧卡检测。

## 卸载

只有在明确需要卸载时运行：

```powershell
& "$env:USERPROFILE\.codex\skills\codex-usage-card\scripts\uninstall.ps1"
```

卸载脚本只删除该 Skill 部署的精确计划任务、进程、三个原生运行文件和自检脚本，保留 `backups`，不操作 Codex 客户端或其他进程。

## 开发验证

界面源码现在位于 `native-patch/native_patch.source.js`。Tailwind CSS 使用 `cq:` 前缀并关闭全局重置；Lucide 图标和 Motion 动画随界面一起构建到 `native_patch.js`，目标电脑不需要 Node.js 或 CDN。

```powershell
npm ci
npm run build
npm run build:check
```

`build` 同步项目与 Skill 的两份部署脚本；不要直接编辑生成的 `native_patch.js`。 构建使用已有 esbuild 压缩空白与语法，保留源码标识符和许可证，并写入规范化源码 SHA-256。额度更新横条使用 transform 过渡，隐藏节点直接清理动画；首次挂载避免重复宿主查询。2026-10-05 完整自检已修复通知授权竞态、严格额度校验、账户切换回包、重复注入及安装进程身份等问题；结果与部署边界见 [项目方案自检记录](docs/codex-bar-proposal-20260926.html#full-audit)。早期性能测量见 [2026-09-29 自检报告](docs/audit-20260929.md)。请求、冷却、提醒去重和账户隔离沿用现有链路。列表列模式使用现有 Motion spring 预计算轨迹，再由原生 WAAPI 播放共享元素动画，带速度反向；侧栏图标模式复用同一 spring，卡片保持轮廓、向入口轻移至多 6px，材质与内容共同淡出，避免白色方块；淡入中进入设置承接当前透明度与位移，设置页复用同一 spring 与 WAAPI，保留两页至连续过渡完成，中途返回、收起或重开承接当前显示状态。刷新使用原生旋转及 opacity 状态交接。设置按“显示 / 提醒”分组，标签与控件分别对齐，详见 [设置页更新记录](docs/settings-navigation-20260929.md)。所有动效响应减少动态效果，不宣称整款客户端始终保持固定帧率。

```powershell
python -m compileall -q codex_quota
python -m pytest -q tests
node --check native-patch\native_patch.js
```

完整维护流程与安全约束见 [`skills/codex-usage-card/SKILL.md`](skills/codex-usage-card/SKILL.md)。
