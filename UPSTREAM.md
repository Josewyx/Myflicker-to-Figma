# 来源与开源说明

本项目是适配 MyFlicker 的衍生版本，原项目为：

- **上游项目**：[Duoasa/DSH-to-Figma](https://github.com/Duoasa/DSH-to-Figma)
- **基线提交**：[`ed996a9cfbc11fe8b32dcbace95e0311b235fcbd`](https://github.com/Duoasa/DSH-to-Figma/commit/ed996a9cfbc11fe8b32dcbace95e0311b235fcbd)（上游版本 0.3.5）
- **许可证**：MIT；保留原始版权声明，见 [LICENSE](LICENSE)。

沿用的主要部分包括 Figma Plugin API 执行器、图层辅助函数、脚本预检、动效能力探测、查询工具与桥接基础。源码中的 Duoasa 版权注释保留；小写 dsh.* 仍为执行器辅助命名，不代表需要安装 DSH 客户端。

改造包括 MyFlicker Plugin/MCP/Skill 声明、内置 Node 启动、离线依赖准备、可见导入目录、中文图文向导、两端版本及文件自检、受保护的配套文件修复和截图文件路径。

本公开仓库以一次经过整理的源码快照建立，未上传本地工作历史、私人测试证据或账号配置。移除了上游旧界面及其嵌入图片，只保留当前适配器需要的界面和不含个人信息的操作示意；被采用代码的许可及版权仍完整保留。公开源码并非 Figma 或 MyFlicker 官方插件，也不代表获得上游作者背书。

后续上游变更应经人工审查、适配和验证再合入。本地桥接不授予 Figma 账号未开放的能力。
