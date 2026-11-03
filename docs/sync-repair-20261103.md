# 入口恢复与额度同步策略修复

2026-11-03 实施记录，整合入 [v2.6.3](releases/v2.6.3.md)。下文保留本机修复阶段的验证结果。

本文记录官方额度请求与入口服务；统计页 ModelDial 第三方参考的独立同步问题见[ModelDial 同步修复](modeldial-sync-20261103.md)。

## 实机诊断

- 开始时 Doctor 为 `TaskNotRunning`，任务动作和目录正确，但 Helper 进程为 0、入口不可见。Codex 正在运行，本机调试端口和主页面可访问。
- 宿主从上次实机验收的 26.1027.3384 更新到 26.1027.6604。启动原任务后立即恢复 Active、单实例无窗口 Helper、可见入口，现有选择器及几何接口仍可用，官方额度请求成功。不能把此次缺入口直接归因于新版布局不兼容。
- 原任务没有运行时限，启用三次失败重启；最近停止结果为 `0xFFFFFFFF`。任务操作历史未启用，未找到对应应用崩溃记录，不能确认进程退出原因，也不能断言更新完全无关。未修改系统日志配置、任务触发器或客户端安装目录。

## 已确认的同步问题与修复

普通失败原来只推迟前端自动请求；手动刷新可绕过，Helper 也只缓存五秒。短或缺省 Retry-After 的 429 在另一窗口同样可早于一分钟再次请求。503 的 Retry-After 被忽略。

现由现有 Helper 锁和账号缓存统一执行：

- 所有失败至少等待 60 秒；网络、连接、DNS、TLS、超时等连续临时失败按 60／120／240／480／900 秒退避，封顶 15 分钟。
- 成功或同账号凭证 generation 更新后清除普通退避；换账号独立计算。成功请求仍使用原五秒共享缓存。
- 429／503 解析秒数或 HTTP 日期的 Retry-After，遵守更长的服务端要求；同账号凭证更新不能绕过已确认的服务端截止。
- 失败回包增加 UTC 绝对 `retryAt`，并保留剩余 `retryAfterSeconds`。各窗口及缓存回放使用同一截止，不因再次收到失败而重新加满一分钟。
- 前端对手动、自动及本地请求超时统一冷却；失败继续保留上次成功数据和时间，通过现有刷新按钮反馈重试时间。后台停表、恢复可见和账号请求隔离契约保留，没有新增轮询或连接探针。

后台入口的致命托管异常在原 startup.log 中只记录类型及 HRESULT，不写原始错误消息、凭证或账号数据。强制终止、断电等不会经过此异常处理，因此该记录不保证能解释所有进程退出。

## 验证

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/native_helper_regressions.ps1`：30 组通过，包括新增共享失败截止、递增封顶、成功／凭证重置、429／503 和原有请求隔离。
- `node --test --test-name-pattern='failed refreshes|request deadlines|long official cooldowns|network diagnosis|network metadata|specific network errors|session switch|refresh|auto|focus' tests/native_patch_runtime.cjs`：11 项通过，包含所有失败手动限频、超时恢复、绝对截止缓存回放、重新注入、无效截止回退、旧回包与账号清理。
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/network_helper_regressions.ps1`：52 项通过。
- `python -m pytest -q tests`：62 项通过。首次在源码镜像复制尚未完成时并行启动，且受限浏览器／窗口夹具不能启动，出现三项失败；镜像同步完成并在正常宿主权限下复测全部通过。
- Roslyn GUI 编译、`npm run build:check`、源脚本／打包脚本 `node --check`、`git diff --check` 及三份运行文件的项目／Skill 镜像校验通过。

已备份并部署新 Helper，保留一个原 Codex 根进程，Helper 单实例无窗口。部署后 Doctor 为 Active、无阶段错误、无未检查窗口、入口可见、网络请求成功。实机探针确认入口有真实点击命中，当前官方数据及成功时间存在，一次普通手动刷新完成且无错误；未通过反复请求生产接口制造失败。截图已复核，真实用量不写入公开材料。探针执行时宿主文档在后台，不作为前台动效手感验收。

截图、部署备份及验证保存在本机忽略目录 `.runtime-test/sync-repair-20261103/`。该阶段 Helper SHA-256 为 `D2264159187679769DC29EB5BB7194D845618191553D341A0672715AC5FE69F4`；仅代表当时的官方同步修复构建。包含后续 ModelDial 修复的最终 Helper、安装器版本和 ZIP 校验值见 v2.6.3 发布记录。未进行多日持续运行或完整冷启动验收。
