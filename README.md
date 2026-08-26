# Codex Usage Card

Codex Usage Card 在 Codex 桌面端侧栏账号行上方显示用量与剩余额度。它不修改 Codex 安装目录，不改变主题和模型列表，也不会记录或输出 API Key。

## 一键安装

要求：Windows 11、PowerShell 7，以及能够正常启动的 Codex 桌面端。

在 PowerShell 7 中运行：

```powershell
$installer = Join-Path $env:TEMP 'install-codex-usage-card.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/DrFanghaiz/codex-usage-card/v1.7.0/install.ps1' -OutFile $installer; Unblock-File -LiteralPath $installer; & $installer
```

安装器会校验发布包的 SHA-256，把 Skill 安装到 `$CODEX_HOME\skills`（未设置时为 `$env:USERPROFILE\.codex\skills`），把无窗口修复器部署到 `$env:LOCALAPPDATA\CodexUsageCard`，并注册当前用户的计划任务 `Codex Usage Card`。从旧版升级时，只迁移路径与动作完全匹配的旧任务。安装完成后会输出 `ActivationState`、`StageCodes` 和 `CardVisible` 等只读验收结果；Codex 未运行时显示等待状态，不把已完成安装误报为失败。

如果只安装 Skill，不立即部署控件：

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" --repo 'DrFanghaiz/codex-usage-card' --path 'skills/codex-usage-card'
```

安装后重新启动 Codex，使新 Skill 出现在可用 Skill 列表中。

## 工作方式

- 官方账户模式优先复用 Codex 原生额度组件；原生卡缺失时由无窗口修复器获取经过校验的真实官方额度窗口。Pro 单周窗口沿用 A2 三行结构，并在标题旁显示 `Pro`；Plus 仅在官方同时返回真实 `5h` 与 `Weekly` 时使用 B 双窗：5 小时窗口占主体，发丝线下保留一行每周用量与重置日期摘要。两种路径共用真实数据、刷新状态和完整无障碍名称。
- 卡片把已用百分比、弹性 2px 进度轨道与剩余比例连成一条阅读动线，并显示倒计时和本地化绝对重置时间。低于约 200px 时压缩轨道间距，约 176px 及以下重排页脚与周摘要，不缩小字体或丢失信息。官方没有返回 5h 时绝不补造；非 Pro/Plus 或未知多窗口形状继续完整呈现真实窗口。控件使用固定暖纸令牌，不修改 Codex 全局主题，无阴影、渐变或动效。
- API 模式显示一张“API 剩余”自定义卡，主数字和细线表示每日剩余额度，并支持手动刷新、陈旧数据时间和服务端冷却反馈。
- 页面可见时使用唯一的自适应单次计时器：最近聚焦 5 分钟内每 2 分钟、聚焦后 5 分钟至 1 小时每 5 分钟、闲置 1–4 小时每 15 分钟、超过 4 小时每 30 分钟；若额度值刚发生变化则维持 5 分钟档。页面隐藏时立即停表，恢复可见或重新聚焦时按新鲜度补刷新。失败重试继续服从至少 60 秒及服务端 `Retry-After` 冷却，不监听键盘、不扫描进程或会话文件。
- 登录配置短暂不完整时通过文件系统事件等待恢复，不做每秒轮询，也不会永久退出。
- Codex 更新、重启、调试端口变化或页面重载后，后台修复器会重新发现页面并注入控件。
- 侧栏收起、账号行不存在时自动隐藏卡片，重新展开后恢复。

Codex 必须暴露本机调试端口，修复器才能向页面注入控件。若官方彻底删除调试入口或改变内部额度组件契约，修复器会明确失效，不会用猜测规则伪装成功。

## 只读自检

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

卸载脚本只删除该 Skill 部署的精确计划任务、进程和三个运行文件，不操作 Codex 客户端或其他进程。

## 开发验证

```powershell
python -m compileall -q codex_quota
python -m pytest -q tests
node --check native-patch\native_patch.js
```

完整维护流程与安全约束见 [`skills/codex-usage-card/SKILL.md`](skills/codex-usage-card/SKILL.md)。
