---
name: myflicker-to-figma
description: Read, create and edit native Figma designs through the MF local companion, including components, variables, screenshots, assets and available Motion APIs. Use for local Figma operations; this server does not use the official remote MCP.
---

# Myflicker-to-Figma

Use tools from **myflicker-to-figma**, keeping them separate from the official `figma-mcp` skill/server. Local schemas differ from official tools. This bridge has no metered call quota or subscription checks; Figma account, file and API permissions still apply. A Starter account is not proof that Motion APIs are enabled.

## Connect

In a new conversation, silently call `figma_connect` with `waitSeconds:0`; when connected, immediately continue the requested task without showing a wizard or asking the user to send another connection message. In follow-ups, reuse the confirmed document binding and task session; recheck only after disconnection or when the user requests status. When disconnected, show the returned setupUrl once and explain how to run the companion; do not repeatedly poll or report the same setup steps. This bridge cannot start a closed Figma plugin by itself. Use `figma_setup` to return the guide link on explicit user request. `figma_connect` accepts only optional waitSeconds, not force or allowAssistantBinding. There are no create_figma_frame/set_figma_node_properties/append_figma_node_child/use_skill tools on this server. Use use_figma for creation and edits; create_session is optional, and figma_read_guide for references. If it returns `needs_user_action`, show the returned `setupUrl` as a clickable link. The native MyFlicker plugin prepares its bundled dependencies on first load without npm or Git. The local wizard locates the complete per-machine import folder in Downloads and checks connection automatically; do not make users find hidden folders, configure ports or copy keys. First import and running **Myflicker-to-Figma** in Figma Desktop are user actions. Keep the window open or use its **收起** button. `figma_connect` only checks connectivity and never modifies the canvas. Generated paired code contains a credential: do not read, commit or upload it.

One document binds on first use. Multiple documents and reconnects require `figma_select_document` with a connectionId from status. Names alone do not prove file identity. Bindings are scoped to an MCP connection; use fileKey on scripts to verify the destination. Files are read/written within the MCP launch workspace (`MF_FIGMA_WORKSPACE` can set it explicitly).

## Delivery boundary

Finish creation/editing with affected node IDs and bounded structural/keyframe readback, followed by a brief text response. Playback preview and all design/video/GIF/asset exports are performed manually by the user in Figma. Do not call export_animation, download_assets, node.exportAsync or figma.io.write for automatic delivery or verification; do not render videos or sample frames. Only an explicit user request for an Agent-generated export can opt into those retained tools.

## Read and edit

Read `figma_read_guide({topic:"plugin-api"})` before scripting. For design systems also read `components-variables`. Other focused topics: `workflow`, `design-to-code`, `figjam-slides`, `assets-scenes`.

Use shallow `get_metadata` to discover unknown targets; otherwise read the required nodes/properties directly. Respect truncation. Pass fileKey from status and a concise description on `use_figma`. A task session bootstraps automatically; reuse the returned execution.sessionId for follow-ups. `create_session` remains available for explicit tasks. Supplied unknown or foreign session IDs are rejected; omit an expired ID to bootstrap after explicitly selecting the document. The field is exactly `description`, without a leading underscore; do not send `_description`, `_displayName` or `_intent` from another server’s schema. Read focused guides once per task and reuse their content; workflow is optional when the required execution contract is already known.

Scripts have top-level await/return and native Figma API/helpers. Scripts keep the editor current page. For a known target, pass its page ID as use_figma.pageId; it is validated/selected before the script runs. Do not switch again after pageId already changed the page. Otherwise switch at most once explicitly. Ordinary scripts do not preload component instances; explicitly await getMainComponentAsync() only for instances used in mainComponent selectors. Local calls on a document are serialized. Preserve existing instances/variables, load exact fonts before text changes, return affected IDs, and take a real screenshot only when explicitly requested. If the user requests no screenshots or image feedback, skip screenshot calls, inline node.screenshot(), exports and image attachments; confirm affected IDs and bounded structural/motion readback, then respond briefly in text. Do not describe this as visual/playback verification. `get_screenshot` returns an image attachment plus a saved PNG path; if your client hides attachments, open the returned file. Metadata alone is not visual verification. `instance.getMainComponentAsync()` is supported; the synchronous getter is not.

## Focused local workflows

Read `local-workflows` only when needed. Use semantic context with includeScreenshot:false and explicit limits for detailed layout/component/variable reads. Use resolve_fonts for a batch of requested fonts, then load the actual returned styles; report fallbacks. verify:{resultPath:"id",layout:true} reads only the target and up to 19 direct children, with no image export. It does not test playback or responsive behavior. Avoid routine whole-file scans and unnecessary probes.

Other available workflows include explicit design references, design_diff baselines, bounded batch_edit, variable creation/modes, FigJam diagrams, basic Slides layouts, existing shader application, import_dom_snapshot, workspace project mappings and inert recipes. Request these only when the user task needs them. Native API exposure is not permission to bypass account limits.

## Motion

Read `motion` before keyframes/timelines, `text-motion` for character/word reveals and `custom-animation-styles` for reusable styles. Refresh `get_capabilities` on a known node before gated work. `available` only proves API exposure/read success, not writes. Stop on an unavailable API; changing a bridge or skill cannot grant a missing native entitlement. Preserve editable text for native text motion. Manual property tracks are objects: count `track.keyframes.length`, never `track.length` or `Object.keys(track).length`. Re-read after writing and return focused keyframe data; use get_motion_context if the expected array is absent.

The calling Agent is assumed to have **no Computer Use**. Do not open menus, click Play, or require screenshots of the desktop to create or verify motion. The user starts the paired companion once per target file; subsequent Agent work uses tools only.

After writing motion, read back the affected tracks and timeline duration, then finish in text. Ask the user to preview playback in the Figma timeline/player; do not claim structural readback proves playback. Export is a manual user step, not part of creation or acceptance. No in-editor Play/Pause tool is offered.

## Recover

Errors include `isError` and `safeToRetryWithoutCanvasRead`. A preflight failure with true means no script ran: correct and retry. Otherwise inspect the affected canvas/components/variables before another write; never blindly replay creation. Use operation_status with operationId to recover a retained/late result before considering another write. For unknown or partial results follow reconcile and recovery. get_metadata({nodeId,depth:10,responseMode:"recovery"}) returns compact inventory but only complete subtrees clear relevant protection; obey recovery.cleared. Metadata does not verify affected variable values. idempotencyKey, journal, trackCreated and run_steps are opt-in; never add them as mandatory steps to a simple edit. rollback is explicit conservative cleanup of eligible failed-created nodes, not Undo or a transaction. Inspect receipts and residual effects before using it. After disconnect explicitly reselect the intended document. If the service/session was replaced, call `figma_status`, use `figma_select_document` to confirm the target and create a new task; status/help may reconnect automatically, canvas operations are never replayed. There is no automatic rollback.
