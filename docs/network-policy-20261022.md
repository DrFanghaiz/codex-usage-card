# 网络策略改进与验收（2026-10-22）

本记录保留 2026-10-22 的实现及实机验收结果；该网络改进现随 v2.5.0 发布，源码安装器与 Skill 资产已同步。

## 行为

- 额度请求仍由独立 Helper 发出，不共享 Codex 的 Electron 会话。新安装明确保存 `system/default`，由 Windows 决定系统代理。
- 升级缺少配置时，按原先的进程 HTTPS、用户 HTTPS、进程 HTTP、用户 HTTP、旧加密文件、系统默认顺序迁移一次；随后仅读取保存的配置。已有 Helper 的安装不会因残留旧任务重新引入旧目录代理。
- `scripts/configure_network.ps1` 显式切换 System / Proxy，原子保存并备份原配置，不改系统代理、环境变量、快捷方式或 Codex 会话。只支持 HTTP 代理协议，HTTPS 目标使用 CONNECT；拒绝端口 0、非根路径、查询和片段。地址含认证信息时由 DPAPI CurrentUser 加密保存。
- 卸载保留网络配置与旧加密文件。安装失败先停止新 Helper，再清理本次创建且未被修改的配置，恢复旧文件及任务。
- 既有额度回包携带脱敏网络诊断；UI 在请求编号门禁后接受，账户重置及重新注入时清空。doctor 在各主窗口中选择最新有效记录，不为诊断额外联网。
- 分别提示代理不可达、407 代理认证、DNS、TLS、超时、401 登录失效、403 拒绝访问、429 限流和配置错误。失败保留上次成功额度；账户隔离、请求合并、缓存和服务端冷却保持。
- 诊断端点只含协议、主机及端口。系统模式不额外解析 PAC，显示由 Windows 决定。缺少代理端点的配置失败仍保留错误信息。

## 验证

| 验证命令或方式 | 结果 |
| --- | --- |
| `node --test tests/native_patch_runtime.cjs`（已有 Playwright + Edge，设置 NODE_PATH） | 42 通过，0 失败 |
| `powershell.exe -NoProfile -File tests/native_helper_regressions.ps1` | 24 组通过 |
| `powershell.exe -NoProfile -File tests/network_helper_regressions.ps1` | 52 项通过，含本地 HTTPS CONNECT 的 407 回包 |
| `tests/network_configuration_regressions.ps1`（PS7 / PS5.1） | 各 15 通过 |
| `tests/installer_regressions.ps1`（PS7 / PS5.1） | 各 47 通过 |
| `python -m pytest -q tests --tb=short` | 60 通过；1 项因首次未设置 NODE_PATH 跳过 |
| 设置 NODE_PATH 后补跑 `tests/test_doctor.py -k test_clipped_entry_visibility_in_browser` | 该项通过，全部 Python 用例均完成验证 |
| `npm run build:check`、修改的 PowerShell 语法解析、`git diff --check` | 通过 |
| Roslyn `/target:winexe /platform:anycpu /optimize+` 全量构建 | 成功；签名状态仍为 NotSigned |
| 真实资产隔离安装（`-SkipTaskRegistration`） | 5 个运行文件与 system/default 配置正确，不创建任务或快捷方式 |

实机发现并修复了 PowerShell 7.6.2 自动将 JSON ISO 时间转换为 DateTime，导致 doctor 丢弃有效记录的问题。现在支持 `DateKind` 的版本明确使用 String，5.1 保持原解析参数；真实 CDP JSON 帧回归覆盖两套 PowerShell。

## 实机结果

只重载精确匹配的 `Codex Usage Card` 任务。Codex PID `30456` 与创建时间 `2026-10-22T17:52:04.1300320+08:00` 在部署前后保持一致。

最终 doctor：`Active`、1 个无窗口 Helper、1/1 主窗口入口可见、无启动提示；网络为 `system / legacy-default`，最近请求错误为 null。页面收到真实成功额度，最终诊断网络时间为 `2026-10-22T11:32:49.1290000Z`。旧版文件与脱敏验收结果保存在 `.runtime-test/network-policy-20261022/`。

- Helper SHA-256：`4E296381F8CD09FC6C635F9700043AD504AC59BEB0BE8B69492F10368735AC3D`
- UI bundle SHA-256：`FF6B134B0E1CFBAE63AABCB8770F02FD9EDAC97C27C8D29BE3CB0C8C10CC7313`

未进行企业 PAC、远端认证代理的实机兼容性验证；未人为断开当前用户网络或切换真实登录。没有关闭客户端进行冷启动验收，启动代码本轮未改。新配置不保证与 Codex 单独指定的应用代理完全相同。
