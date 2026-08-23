# Codex Usage Card

Codex Usage Card 在 Codex 桌面端侧栏账号行上方显示用量与剩余额度。它不修改 Codex 安装目录，不改变主题和模型列表，也不会记录或输出 API Key。

## 一键安装

要求：Windows 11、PowerShell 7，以及能够正常启动的 Codex 桌面端。

在 PowerShell 7 中运行：

```powershell
$installer = Join-Path $env:TEMP 'install-codex-usage-card.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/DrFanghaiz/codex-usage-card/v1.5.0/install.ps1' -OutFile $installer; Unblock-File -LiteralPath $installer; & $installer
```

安装器会校验发布包的 SHA-256，把 Skill 安装到 `$CODEX_HOME\skills`（未设置时为 `$env:USERPROFILE\.codex\skills`），把无窗口修复器部署到 `$env:LOCALAPPDATA\CodexUsageCard`，并注册当前用户的计划任务 `Codex Usage Card`。从旧版升级时，只迁移路径与动作完全匹配的旧任务。安装完成后会输出 `ActivationState`、`StageCodes` 和 `CardVisible` 等只读验收结果；Codex 未运行时显示等待状态，不把已完成安装误报为失败。

如果只安装 Skill，不立即部署控件：

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" --repo 'DrFanghaiz/codex-usage-card' --path 'skills/codex-usage-card'
```

安装后重新启动 Codex，使新 Skill 出现在可用 Skill 列表中。

## 工作方式

- 官方账户模式优先复用 Codex 原生额度组件；原生卡缺失时由无窗口修复器获取真实官方额度窗口并渲染同款 Thread。左侧显示“本周已用”和已用百分比，右侧显示官方来源、手动刷新、剩余比例和基于官方 `reset_at` 计算的自然重置倒计时；底部保留 1px 进度线，并使用轻量主题边界与 surface 和侧栏内容分区。进度变化仅使用 180ms 状态过渡并支持 reduced-motion，不使用阴影、渐变或装饰动效。
- 官方没有返回 5h 窗口时不显示 5h；未来恢复该窗口时保留完整原生组件并自动显示。
- API 模式显示一张“API 剩余”自定义卡，主数字和细线表示每日剩余额度，并支持手动刷新、陈旧数据时间和服务端冷却反馈。
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
