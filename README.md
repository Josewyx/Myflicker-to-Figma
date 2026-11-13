# Myflicker-to-Figma

> **0.6.0**：适配 DSH-to-Figma 0.4.1，增加字体匹配、语义读取、批量编辑和失败恢复等能力。详见 [版本说明](docs/release-0.6.0.md)。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

创建和编辑任务以结构回读与文字说明结束，预览与导出由用户在 Figma 中手动完成。

让 MyFlicker 用自然语言读取、创建和编辑 Figma 原生设计。免费 Starter 账号在具有文件编辑权限时也可使用；支持编辑器实际开放的原生 Motion，结果可继续编辑。

**本项目以 MIT 许可证开源，基于 [Duoasa/DSH-to-Figma](https://github.com/Duoasa/DSH-to-Figma) 改造。** 保留上游版权与许可，增加 MyFlicker 原生 Plugin、离线运行依赖、连接向导和自检。不是 Figma 或 MyFlicker 官方出品。来源及改动见 [UPSTREAM.md](UPSTREAM.md)。

## 0.6.0 更新说明

- 自动建立任务会话，减少普通创建前的工具调用；支持批量字体解析和 27 个 Feather 图标。
- 增加精简语义上下文、变量依赖、多页搜索和递归动效读取。
- 增加操作状态、结构化错误和完整性恢复，避免把截断读取视为恢复成功；可选去重、日志和检查点任务。
- 增加限定批量编辑、设计参考和快照、工作区资源复用，以及原生 FigJam 图表、基本 Slides 和已有 Shader 操作。
- 保留当前页/显式 pageId、按需组件解析与连接复用；默认只回读结构并简短文字反馈，人工预览和导出。

**升级后关闭并重新运行 Figma 配套插件，确认两端为 0.6.0。** 本版要求 MyFlicker 配套协议 8，旧配套会提示更新；仍不兼容时按向导重新准备并导入。新建本地 Code 会话以加载新版工具和 Skill。

## 在 MyFlicker 中安装

1. 打开 **设置 → Plugins → 插件市场 → 管理 Marketplace**。
2. 添加市场：

```text
Josewyx/Myflicker-to-Figma
```

3. 添加成功后回到插件市场，找到 **myflicker-to-figma**，安装并启用。仅看到市场里有“1 个 Plugin”还不代表已安装。旧版先停用，避免重复工具。
4. 新建本机执行的 Code 会话，发送：

> 使用 Myflicker-to-Figma 连接本机 Figma，检查状态，并给我连接向导。

5. 按向导在 Figma 桌面端首次导入 **下载 → Myflicker-to-Figma（本机专用）→ manifest.json**，然后在目标文件运行插件。

**添加 GitHub 市场解决的是 MyFlicker 端安装；Figma 端仍需首次导入 manifest。** 此项目尚未上架 Figma Community。市场目录需要时手动刷新，普通用户不需要安装 CLI、Git、Node.js 或 npm；Git 来源的下载能力由 MyFlicker 宿主管理。

详细步骤、自检与恢复见 [图文安装指南](docs/install.md)。如果宿主不支持当前 Git 市场安装方式，可下载仓库 ZIP，解压后将根目录作为本地 Plugin 安装。

## 第一次体验

> 使用 Myflicker-to-Figma，在当前文件中新建一个 960×540 的可编辑画板，主题为「Hello Motion」，保留已有设计。先检测原生 Motion 能力；可用时让标题逐字入场、圆形轻轻位移并淡入，制作约 3 秒的动效。完成后回读图层与关键帧，仅用文字简短说明；不要截图、导出任何文件或回传图片。预览与导出由我在 Figma 中手动完成。

Figma 插件窗口可以收起，关闭会断开连接。每个目标文件都需要运行插件。多个文件连接或断线恢复后应明确确认目标，不自动重放画布修改。

## 能力与限制

- 读取选区、图层、布局、组件、变量；创建和编辑可编辑原生节点。
- 截图返回图片附件及本地 PNG 文件路径，缺图明确报错。
- 原生 Motion 和 Specs 取决于账号、文件和当前编辑器支持；发现 API 不代表已验证写入或播放。预览和导出由用户在 Figma 中手动完成，Agent 不自动导出验收文件。
- 本机桥接不使用官方远程 MCP，不消耗其调用额度；MyFlicker 模型费用按客户端规则计算。
- 主要验证 macOS。Windows、所有账号和组织策略未全面验收；无绕过账号权限的能力。

## 隐私

公开仓库不包含个人截图、设计文件、配对目录、账号配置或本地聊天记录。安装图为通用操作示意。

桥接服务只监听本机。运行时会在本机生成配对凭证及可见的导入目录；**不要上传或分享“本机专用”目录、生成的 code.js/ui.html、配对密钥或诊断日志原文**。发送给 AI 的设计上下文还会受你选择的 MyFlicker 模型服务的数据处理规则约束，不能将“本地桥接”等同于整个 AI 流程完全离线。详情见 [PRIVACY.md](PRIVACY.md)。

## 开发与验证

普通安装不需要执行这些命令。源码开发需要 Node.js 22+：

```sh
npm ci --ignore-scripts
npm run test:all
npm run build:companion
npm run release
```

仓库包含 `runtime-payload/`，用于宿主首次启动时离线准备运行依赖；依赖版本锁定于 package-lock.json。此目录由干净的生产依赖构建，不含用户运行数据。发行脚本会重新准备依赖并生成 ZIP 和 SHA-256。

本仓库测试使用隔离的临时目录与合成数据，不应将测试通过视为每个真实账号、编辑器和动效播放均已验收。

## 反馈与贡献

通过 [GitHub Issues](https://github.com/Josewyx/Myflicker-to-Figma/issues) 反馈问题。请先移除截图、路径、文件名称和凭证中的个人信息。贡献同样按 MIT 许可证提供。

## 许可证与来源

[MIT License](LICENSE)。上游版权归 Duoasa，改造部分归 Myflicker-to-Figma contributors；本项目与上游不存在官方背书关系。
