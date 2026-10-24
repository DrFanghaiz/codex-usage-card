# 官方快捷方式参数自动恢复（2026-10-24）

已集成现有 Helper 并部署本机，随 v2.5.0 发布。维护模块沿用 `scripts/official_shortcuts.ps1`；官方快捷方式仍直接指向注册的包应用，不新增启动脚本或改为 EXE 目标。

## 行为与边界

- Helper 启动扫描一次；监听当前用户桌面、Programs、Quick Launch 的快捷方式变化，1 秒去抖、单个后台维护进程。临时失败按 2 / 10 / 30 秒有界重试，自身写入与回滚事件不会无限重置预算。
- 只识别当前注册的官方包应用目标，补齐 `--remote-debugging-address=127.0.0.1 --remote-debugging-port=0`。其他参数、PIDL、图标等元数据不变；正确入口不写入。冲突参数、不同目标、重解析路径跳过，损坏恢复记录不继续修改。
- 更新程序重建同一官方入口时，先保存新版原件并更新恢复基线，旧备份保留；卸载不把新版图标恢复成旧版。所有写入继续使用内容哈希校验及单条事务回滚。
- 安装、修复、回滚、卸载共用命名互斥锁。安装锁覆盖启动与自检直至提交或回滚；卸载先停 Helper，无条件进入带锁恢复流程。维护子进程取得锁后重新验证父 PID 与创建时间，避免卸载后再次补参；不强杀正在写入的维护事务。
- 遵循 Windows PowerShell 执行策略，不修改或绕过策略。更新器直接自动重启、Helper 尚未运行、极短时间内点击尚未修复的链接、宿主不再支持参数，均不保证免二次重启。

## 验证

所有参数丢失、快捷方式重建、异常与回滚场景均使用隔离文件或无副作用模块，没有人为移除真实桌面入口参数。

| 检查 | 实际结果 |
| --- | --- |
| `tests/official_shortcut_regressions.ps1` | PowerShell 7 与 Windows PowerShell 5.1 各 39 通过、0 失败 |
| `tests/installer_regressions.ps1` | 两种 PowerShell 各 50 通过、0 失败 |
| `tests/shortcut_monitor_regressions.ps1` | Windows PowerShell 5.1：30 通过、0 失败，含真实隐藏维护子进程调用 |
| `tests/native_helper_regressions.ps1` | Windows PowerShell 5.1：24 组通过、0 失败 |
| `python -m pytest -q tests` | 60 通过、1 跳过（可选浏览器运行时检查） |
| Roslyn `csc.exe /codepage:65001 /target:winexe /optimize+` | 编译通过；现有 .NET Framework 引用，不新增依赖；产物 NotSigned |
| 源码/模块镜像与 diff 检查 | 一致、通过 |

实机部署后：计划任务 `Codex Usage Card` 为 Running；doctor 为 Active，1 个无窗口 Helper、1 个主窗口、1 个可见额度入口，最近请求无错误。启动日志记录 `official-shortcuts-checked`。客户端 PID 与启动时间保持不变；桌面原官方快捷方式 SHA-256 前后完全相同。

- Helper SHA-256：`F276F74A38E54CC089726C0A11FB6265AEEA690B4BEC28FFB3AF7A8F6BB92FB0`
- Helper 源码 SHA-256：`7E43E024A7BC6730030763D37EC5E34CDECD73AF35997552C66EE221D07FD1A0`
- 维护模块 SHA-256：`329922ADED43298EB9DA3BECF0512E18580DFE5BAD1D1BE4E6008F139D41A916`
- UI bundle 未改：`D969A17188DAEE1F584CD688C0B0C0A405DFFF6B81B55F53A629308E5F3A3950`
- 部署备份、doctor 与哈希证据：项目 `.runtime-test/shortcut-repair-20261024/`。

未执行真实 ChatGPT/Codex 升级对照，也未制造真实快捷方式丢参；自动恢复效果由原生 ShellLink 隔离测试及监控测试确认。
