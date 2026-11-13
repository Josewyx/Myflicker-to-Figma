# MyFlicker 本地扩展工作流

普通创建和修改直接使用 use_figma，包含 fileKey、description 即可；sessionId 自动建立，后续复用返回的 execution.sessionId。所有原生调用仍按文件串行执行。保持当前页，可用 pageId 明确指定目标页。不要全页预加载组件。

完成后只回读相关图层、关键帧和时间轴，简短文字说明。播放预览和导出由用户在 Figma 中手动完成。下列能力按需使用，不增加为每次任务的固定步骤。

## 字体与布局

resolve_fonts({specs:[{family:"Inter",style:"Bold"}],allowFallback:false}) 解析实际可用字体；拿到结果后仍须 await figma.loadFontAsync。回退结果应说明，不代表验证了字符覆盖。

use_figma 的 verify:{resultPath:"frameId",layout:true} 从脚本返回值定位目标，观察目标及最多 19 个直接子节点的尺寸、布局、约束和锁定，不递归扫描或改动布局。默认没有截图、图片或文件导出；只在用户明确要求时设置 screenshot:true。结构观察不等于行为或视觉验收。

## 更精简的读取

get_design_context/get_figjam/get_component_context 的 semantic:true 返回有边界的语义数据；使用 includeScreenshot:false，按需 includeCss:true。读取 coverage、sectionPlan 和遗漏字段，不能把截断结果视为完整。

get_variable_defs 支持目标节点的变量依赖、别名及模式；search_design_system 支持显式 pageIds；get_motion_context 支持 recursive、maxNodes、maxDepth，以及有限的 codeFormat:"css" 转换。CSS 候选不是完整或已验证的动画实现。

## 批量编辑与变量

batch_edit 仅接受限定的属性、文字、填充修改；可通过 expected 校验旧值。遇到失败报告已执行步骤和尽力恢复结果，不能宣称事务。

create_variables 在已有集合中创建明确命名的变量，可用 aliasOf 指向同类型现有变量；不按值自动合并。add_variable_modes 受原生配额限制；缓存仅反映实际观察到的限制，forceRefresh 只清缓存，不授予权限。

## 错误与恢复

错误返回 operationId、executionState、suggestedAction、messageHuman，以及适用的 reconcile、journal、affected。先按实际错误采取下一步，不盲目重复创建。

operation_status({operationId,includeResult:true}) 查询当前 MCP 连接和文件内的操作状态与保留结果。历史过期、结果不存在不代表成功；未知写入不重放。

get_metadata({nodeId,profile:"full",depth:10,responseMode:"recovery"}) 返回简明树清单，仍使用完整性校验；只在 recovery.cleared 为 true 时解除对应写入保护。深度不足、分页、截断、属性遗漏不能直接解除保护；继续检查受影响对象。变量写入需要读取受影响集合和值，不靠画布清单代替。

journal:true 记录有边界的已观察节点写入，并不覆盖所有间接变化。idempotencyKey 是可选的去重键，限当前 MCP 连接、工作区、文件；相同键不同请求会冲突，未知请求不再次执行。跨新会话不是同一作用域，不能当作全局防重。

trackCreated:true 为失败创建保留可选清理收据；rollback({operationId}) 仅由明确清理意图触发，只删除可证明归属、未发生后续修改的允许节点。未知依赖、现有对象修改、变量修改等会跳过或拒绝；不等于撤销和事务。

run_steps 仅用于明确的多步任务，通过 taskKey 建立检查点；status 读取进度，resume 只执行未开始步骤。失败/中断步骤不能自动重放；resolve 需要先检查效果，并遵守返回的状态与 token。任务固定于原页面。

## 参考、快照和工作区复用

get_design_reference/set_design_reference/clear_design_reference 读取、绑定或清除文件级参考，默认不取缩略图。绑定参考不修改源设计，不自动扫描全文件，也不自动注入大段规范。

design_diff 的 create/update 显式保存工作区设计基线；默认 compare 对比已有完整语义快照。更新要求 expectedRevision；读取不完整时不覆盖基线。结果是结构变化，不是像素或视觉验收。

project_index 有界索引工作区组件、token、SVG；project_match 提供有证据的候选，project_mappings 保存显式对应关系。它们不执行项目代码，也不发布 Code Connect。local_recipes 保存惰性的脚本配方；保存不执行，执行仍走 use_figma。

## 原生创作扩展

generate_diagram 在已连接 FigJam 中创建可编辑图形和连接线，支持有限 Mermaid flowchart 子集。generate_deck 在已连接 Slides 文件中创建基本标题/正文页，不新建云文件。

get_shaders/list_file_shaders/apply_shader 发现并应用编辑器开放的已有 shader，不生成云端源码。import_dom_snapshot 接收明确提供的有边界 DOM 快照，只导入支持的可编辑图层，不是可运行 Code Layer。

figma.icon 支持内置 Feather 图标。只使用已列出的名称；不支持的字面量图标和 strokeDashes 会在写入前提示，虚线使用 dashPattern。可证明且可 await 的 getNodeById 调用会在预检中转为异步 API；不能转换的上下文需手动修正。

本版未开放上游像素 compare、浏览器 capture_webpage 和新 export_video 路由；继续沿用 MyFlicker 安装与连接 UI。现有底层导出仅保留兼容能力，不进入默认创建或验收流程。
