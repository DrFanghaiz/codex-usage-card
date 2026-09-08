# Codex Usage Card

Codex Usage Card 在 Codex 桌面端侧栏账号行上方显示用量与剩余额度。它不修改 Codex 安装目录，不改变主题和模型列表，也不会记录或输出 API Key。

## 一键安装

要求：Windows 11、PowerShell 7，以及能够正常启动的 Codex 桌面端。卡内自检使用标准安装位置 `%ProgramFiles%\PowerShell\7\pwsh.exe`。

在 PowerShell 7 中运行：

```powershell
$installer = Join-Path $env:TEMP 'install-codex-usage-card.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/DrFanghaiz/codex-usage-card/v2.0.0/install.ps1' -OutFile $installer; Unblock-File -LiteralPath $installer; & $installer
```

安装器会校验发布包的 SHA-256，把 Skill 安装到 `$CODEX_HOME\skills`（未设置时为 `$env:USERPROFILE\.codex\skills`），把无窗口修复器部署到 `$env:LOCALAPPDATA\CodexUsageCard`，并注册当前用户的计划任务 `Codex Usage Card`。从旧版升级时，只迁移路径与动作完全匹配的旧任务。安装完成后会输出 `ActivationState`、`StageCodes` 和 `CardVisible` 等只读验收结果；Codex 未运行时显示等待状态，不把已完成安装误报为失败。

如果只安装 Skill，不立即部署控件：

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" --repo 'DrFanghaiz/codex-usage-card' --path 'skills/codex-usage-card'
```

安装后重新启动 Codex，使新 Skill 出现在可用 Skill 列表中。

## 工作方式

- 官方账户模式优先复用 Codex 原生额度组件；原生卡缺失时由无窗口修复器获取经过校验的真实官方额度窗口。Pro 单周窗口沿用 A2 三行结构，并在标题旁显示 `Pro`；Plus 仅在官方同时返回真实 `5h` 与 `Weekly` 时使用 X 三行结构：标题显示 `Plus`，5 小时窗口占主行，页脚左侧显示 5h 倒计时，右侧显示周百分比与周重置日。两种账号在正常侧栏宽度下同高。
- 卡片把已用百分比、弹性 2px 进度轨道与剩余比例连成一条阅读动线。Plus X 不显示重复的 5h 绝对时刻、周进度轨、分隔线或第四行；窄侧栏只重排页脚，不缩小字体或丢失信息。官方没有返回 5h 时绝不补造；非 Pro/Plus 或未知多窗口形状继续完整呈现真实窗口。官方和 API 控件保持侧栏色温，通过明度差与受控彩度形成柔和的表面层次；强调色用于进度和操作，不给整张卡染色。前景色会按最终合成背景校验并修正对比度。控件采用轻雾面、弱高光和淡阴影，按主题与样式表变化更新配色，缓存不变结果，不增加轮询或修改全局主题。控件单独启用背景模糊，不受系统减少透明度影响；其他界面仍跟随系统设置。高对比及系统强制颜色模式使用实色背景。
- API 模式显示一张“API 剩余”自定义卡，主数字和细线表示每日剩余额度，并支持手动刷新、陈旧数据时间和服务端冷却反馈。
- 页面可见时使用唯一的自适应单次计时器：最近聚焦 5 分钟内每 2 分钟、聚焦后 5 分钟至 1 小时每 5 分钟、闲置 1–4 小时每 15 分钟、超过 4 小时每 30 分钟；若额度值刚发生变化则维持 5 分钟档。页面隐藏时立即停表，恢复可见或重新聚焦时按新鲜度补刷新。失败重试继续服从至少 60 秒及服务端 `Retry-After` 冷却，不监听键盘、不扫描进程或会话文件。
- Plus X 的分钟级倒计时复用同一个单次计时器在本地按分钟边界重算，不额外请求网络；因此网络刷新仍按自适应档位运行。
- 登录配置短暂不完整时通过文件系统事件等待恢复，不做每秒轮询，也不会永久退出。
- 直接从官方 ChatGPT 入口启动时，后台修复器会识别本次新出现且未开放调试端口的 `OpenAI.Codex` 主进程，快速重启一次并附加动态 loopback 调试端口；Codex++ 等已带端口的启动保持不变。
- Codex 更新、重启、调试端口变化或页面重载后，后台修复器会重新发现页面并注入控件。
- 侧栏收起、账号行不存在时自动隐藏卡片，重新展开后恢复。

Codex 必须暴露本机调试端口，修复器才能向页面注入控件。安装或升级 Helper 前已经存在的无调试会话不会被强制关闭，需要关闭后重新从官方入口启动一次。若官方彻底删除调试入口、阻止启动参数或改变内部额度组件契约，修复器会明确失效，不会用猜测规则伪装成功。

## 2.0 更新

- 卡片右上角的设置按钮提供官方卡已用／剩余主数字、低额度提醒、恢复提醒、系统通知、提醒阈值、12 小时制和透明度设置。API 卡继续默认突出剩余量。保留当前模糊效果为默认，可选择跟随系统或不透明；高对比和强制颜色始终使用实色。
- 默认剩余 20%、10% 提醒，各额度窗口分别去重；一次下降越过多档只提示一次。恢复提醒独立开关，官方模式需真实回包显示重置时间推进且额度增加，API 模式依据真实剩余比例回升。没有后台历史记录或趋势图，只保存当前提醒去重所需的最近状态。Helper 重启后随机会话标记更新，提醒重新计数。
- 提醒在有可见 Codex 页面并收到额度更新时触发。设置与通知去重使用本机浏览器存储和 Web Locks；系统通知需显式开启，宿主未授权时仍保留卡内提示。页面全部隐藏时继续沿用停表策略，不承诺关闭客户端后的后台通知。
- 官方与 API 明确区分刷新中、登录失效、服务端冷却及保留旧数据的失败状态；悬停卡片可查看最近成功更新时间。账号切换先隐藏旧数据，收到新会话数据后恢复；同账号令牌或配置更新不清空提醒去重状态。
- 设置中可以运行只读自检、复制脱敏结果，以及打开公开最新版本说明。自检逐个检查 Codex 主窗口，全部卡片可见才报告成功，缺卡或未检查不会被其他窗口的成功掩盖。
- Helper 同时连接发现的多个主窗口，并通过页面目标事件接入同进程新窗口；并发刷新复用 5 秒请求缓存，服务端限流跨窗口共享。单窗口断线会重新发现整组页面。独立新进程的额外调试端口在下一次发现时接入。
- 重连时不会重放历史自检与刷新请求；同账号配置变化后仍遵循服务端未到期的冷却时间。
- 安装器先核实精确任务身份，再备份旧文件和任务配置。复制或启动检查失败会恢复旧版；运行目录与 Skill 目录的 `backups` 保留回滚证据。安装完成和卡片实际可见分别报告。

开发回归：`node --test tests/native_patch_runtime.cjs`（Playwright + Edge）；Windows PowerShell 5.1 运行 `tests/native_helper_regressions.ps1` 和 `tests/installer_regressions.ps1`。Python 测试继续使用下方命令。

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

```powershell
python -m compileall -q codex_quota
python -m pytest -q tests
node --check native-patch\native_patch.js
```

完整维护流程与安全约束见 [`skills/codex-usage-card/SKILL.md`](skills/codex-usage-card/SKILL.md)。
