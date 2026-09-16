# Codex Usage Card

Codex Usage Card 在 Codex 桌面端侧栏账号行上方显示用量与剩余额度。它不修改 Codex 安装目录，不改变主题和模型列表，也不会记录或输出 API Key。

## 一键安装

要求：Windows 11、PowerShell 7，以及能够正常启动的 Codex 桌面端。卡内自检使用标准安装位置 `%ProgramFiles%\PowerShell\7\pwsh.exe`。

在 PowerShell 7 中运行：

```powershell
$installer = Join-Path $env:TEMP 'install-codex-usage-card.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/DrFanghaiz/codex-usage-card/v2.1.0/install.ps1' -OutFile $installer; Unblock-File -LiteralPath $installer; & $installer
```

安装器会校验发布包的 SHA-256，把 Skill 安装到 `$CODEX_HOME\skills`（未设置时为 `$env:USERPROFILE\.codex\skills`），把无窗口修复器部署到 `$env:LOCALAPPDATA\CodexUsageCard`，并注册当前用户的计划任务 `Codex Usage Card`。从旧版升级时，只迁移路径与动作完全匹配的旧任务。安装完成后会输出 `ActivationState`、`StageCodes` 和 `CardVisible` 等只读验收结果；Codex 未运行时显示等待状态，不把已完成安装误报为失败。

如果只安装 Skill，不立即部署控件：

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" --repo 'DrFanghaiz/codex-usage-card' --path 'skills/codex-usage-card'
```

安装后重新启动 Codex，使新 Skill 出现在可用 Skill 列表中。

## 工作方式

- 官方账户模式优先复用 Codex 原生额度组件；原生卡缺失时由无窗口修复器获取经过校验的真实官方额度窗口。官方卡采用定稿布局：Pro 两行 248 × 72px，Plus 三行 248 × 96px。Plus 仅在官方同时返回真实 `5h` 与 `Weekly` 时显示主次两行额度，未知多窗口形状继续完整呈现真实窗口。
- 官方卡使用暖纸底、棕色填充、无衬线字体和柔和投影，无渐变；保留轻量按压反馈、刷新旋转和用量变化过渡。横条表示已用额度，主条 3px、副条 1.5px，并保留同等最小填充宽度；圆环表示周期已流逝比例，右侧显示绝对重置日期或 5h 重置时刻。移除重复的剩余比例和倒计时。窄侧栏适度收紧字号和间距，高对比及强制颜色模式保留系统适配。API 卡继续使用随宿主主题变化的雾面配色。
- API 模式显示一张“API 剩余”自定义卡，主数字和细线表示每日剩余额度，并支持手动刷新、陈旧数据时间和服务端冷却反馈。
- 页面可见时使用唯一的自适应单次计时器：最近聚焦 5 分钟内每 2 分钟、聚焦后 5 分钟至 1 小时每 5 分钟、闲置 1–4 小时每 15 分钟、超过 4 小时每 30 分钟；若额度值刚发生变化则维持 5 分钟档。页面隐藏时立即停表，恢复可见或重新聚焦时按新鲜度补刷新。失败重试继续服从至少 60 秒及服务端 `Retry-After` 冷却，不监听键盘、不扫描进程或会话文件。
- 官方时间圆环从真实重置时间戳按 7 天或 5 小时窗口计算，复用同一个单次计时器按分钟更新，不额外请求网络。只有原生重置文字而没有时间戳时保留文字与空轨道，不猜测周期。
- 登录配置短暂不完整时通过文件系统事件等待恢复，不做每秒轮询，也不会永久退出。
- 直接从官方 ChatGPT 入口启动时，后台修复器会识别本次新出现且未开放调试端口的 `OpenAI.Codex` 主进程，快速重启一次并附加动态 loopback 调试端口；Codex++ 等已带端口的启动保持不变。
- Codex 更新、重启、调试端口变化或页面重载后，后台修复器会重新发现页面并注入控件。
- 侧栏收起、账号行不存在时自动隐藏卡片，重新展开后恢复。

Codex 必须暴露本机调试端口，修复器才能向页面注入控件。安装或升级 Helper 前已经存在的无调试会话不会被强制关闭，需要关闭后重新从官方入口启动一次。若官方彻底删除调试入口、阻止启动参数或改变内部额度组件契约，修复器会明确失效，不会用猜测规则伪装成功。

## 设置、提醒与可靠性

- 卡片右上角的设置按钮提供低额度提醒、恢复提醒、系统通知、提醒阈值和 12 小时制设置。官方卡固定显示已用比例；API 卡默认突出剩余量，并提供紧凑模式和透明度设置。API 卡默认保留模糊效果，可选择跟随系统或不透明；高对比和强制颜色始终使用实色。
- 默认剩余 20%、10% 提醒，各额度窗口分别去重；一次下降越过多档只提示一次。恢复提醒独立开关，官方模式需真实回包显示重置时间推进且额度增加，API 模式依据真实剩余比例回升。没有后台历史记录或趋势图，只保存当前提醒去重所需的最近状态。Helper 重启后随机会话标记更新，提醒重新计数。
- 提醒在有可见 Codex 页面并收到额度更新时触发。设置与通知去重使用本机浏览器存储和 Web Locks；系统通知需显式开启，宿主未授权时仍保留卡内提示。页面全部隐藏时继续沿用停表策略，不承诺关闭客户端后的后台通知。
- 官方与 API 明确区分刷新中、已更新、额度未变化、登录失效、服务端限流和超时。手动刷新成功后，按钮短暂显示勾号和对应结果；失败显示警示图标，悬停或键盘聚焦可查看完整说明。已有数据的官方/API卡保留原值，错误信息通过浮层呈现，不撑高卡片；首屏无数据仍有状态说明。反馈不延迟数据，也不额外禁用按钮。悬停卡片可查看最近成功更新时间。
- 页面请求超过 25 秒会结束等待并允许重试；每次请求有独立编号，迟到的旧回复不能结束新请求或覆盖其状态。隐藏页恢复时会检查原始截止时间，重注入不会延长等待。Helper 的 HTTP 请求和活动调试命令都有 15 秒总期限，卡住后沿用重连流程；空闲连接不增加轮询。账号切换先隐藏旧数据，收到新会话数据后恢复；同账号令牌或配置更新不清空提醒去重状态。
- 设置中可以运行只读自检、复制脱敏结果，以及打开公开最新版本说明。自检逐个检查 Codex 主窗口，全部卡片可见才报告成功，缺卡或未检查不会被其他窗口的成功掩盖。
- Helper 同时连接发现的多个主窗口，并通过页面目标事件接入同进程新窗口；并发刷新复用 5 秒请求缓存，服务端限流跨窗口共享。单窗口断线会重新发现整组页面。独立新进程的额外调试端口在下一次发现时接入。
- 重连时不会重放历史自检与刷新请求；同账号配置变化后仍遵循服务端未到期的冷却时间。
- 安装器先核实精确任务身份，再备份旧文件和任务配置。复制或启动检查失败会恢复旧版；运行目录与 Skill 目录的 `backups` 保留回滚证据。安装完成和卡片实际可见分别报告。

开发回归：`node --test tests/native_patch_runtime.cjs`（Playwright + Edge）；Windows PowerShell 5.1 运行 `tests/native_helper_regressions.ps1` 和 `tests/installer_regressions.ps1`。Python 测试继续使用下方命令。

## 2.1 更新

官方卡统一采用上述定稿，旧“紧凑／剩余”显示偏好不再改变官方布局；官方设置保留提醒、自检和时间制式。API 卡保留可选紧凑模式与透明度设置，有真实总限额时紧凑模式显示已用比例，无总限额时保留完整数据。设置采用紧凑分组列表，已有数据刷新时不再新增“刷新中”行。

界面统一使用组件范围内的 Tailwind CSS、Lucide 图标和 Motion 动效。手动刷新区分“已更新”“额度未变化”和失败原因；超时后可重试，迟到的旧回复不会覆盖新请求，错误浮层不改变卡片高度。主窗口识别不再依赖窗口标题，适配客户端标题变化。

## 命令行自检

安装后可随时运行：

```powershell
& "$env:USERPROFILE\.codex\skills\codex-usage-card\scripts\doctor.ps1"
```

Doctor 只检查精确计划任务、无窗口 Helper、Codex 本机调试页面和真实可见卡，不读取或输出凭据、账户标识或原始 API 响应。`CardVisible = $null` 表示当时无法检查页面；`CardVisible = $false` 才表示已检查主页面但没有发现受支持的可见卡。

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

`build` 同步项目与 Skill 的两份部署脚本；不要直接编辑生成的 `native_patch.js`。数据校验和真实额度语义保持不变。Motion 用于设置、通知和官方/API 卡交互，并响应减少动态效果和页面隐藏。官方卡保留定稿布局、配色与尺寸；数字即时更新，横条平滑过渡，刷新不增加高度。

```powershell
python -m compileall -q codex_quota
python -m pytest -q tests
node --check native-patch\native_patch.js
```

完整维护流程与安全约束见 [`skills/codex-usage-card/SKILL.md`](skills/codex-usage-card/SKILL.md)。
