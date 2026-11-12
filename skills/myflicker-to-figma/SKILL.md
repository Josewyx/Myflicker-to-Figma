---
name: myflicker-to-figma
description: Read, create and edit native Figma designs through the MF local companion, including components, variables, screenshots, assets and available Motion APIs. Use for local Figma operations; this server does not use the official remote MCP.
---

# Myflicker-to-Figma

Use tools from **myflicker-to-figma**, keeping them separate from the official `figma-mcp` skill/server. Local schemas differ from official tools. This bridge has no metered call quota or subscription checks; Figma account, file and API permissions still apply. A Starter account is not proof that Motion APIs are enabled.

## Connect

Call `figma_connect` first (optionally `waitSeconds: 10`). If it returns `needs_user_action`, show the returned `setupUrl` as a clickable link. The native MyFlicker plugin prepares its bundled dependencies on first load without npm or Git. The local wizard locates the complete per-machine import folder in Downloads and checks connection automatically; do not make users find hidden folders, configure ports or copy keys. First import and running **Myflicker-to-Figma** in Figma Desktop are user actions. Keep the window open or use its **收起** button. `figma_connect` only checks connectivity and never modifies the canvas. Generated paired code contains a credential: do not read, commit or upload it.

One document binds on first use. Multiple documents and reconnects require `figma_select_document` with a connectionId from status. Names alone do not prove file identity. Bindings are scoped to an MCP connection; use fileKey on scripts to verify the destination. Files are read/written within the MCP launch workspace (`MF_FIGMA_WORKSPACE` can set it explicitly).

## Read and edit

Read `figma_read_guide({topic:"plugin-api"})` before scripting. For design systems also read `components-variables`. Other focused topics: `workflow`, `design-to-code`, `figjam-slides`, `assets-scenes`.

Use shallow `get_metadata` to discover unknown targets; otherwise read the required nodes/properties directly. Respect truncation. Call `create_session` with fileKey from status and a task description. Pass its sessionId, fileKey and description on `use_figma`. Reuse that task for follow-ups. The field is exactly `description`, without a leading underscore; do not send `_description`, `_displayName` or `_intent` from another server’s schema. Read focused guides once per task and reuse their content; workflow is optional when the required execution contract is already known.

Scripts have top-level await/return and native Figma API/helpers. Each script starts on the first page; switch at most once with `await figma.setCurrentPageAsync(page)`. Local calls on a document are serialized. Preserve existing instances/variables, load exact fonts before text changes, return affected IDs, and verify visual changes using a real screenshot. `get_screenshot` returns an image attachment plus a saved PNG path; if your client hides attachments, open the returned file. Metadata alone is not visual verification. `instance.getMainComponentAsync()` is supported; the synchronous getter is not.

## Motion

Read `motion` before keyframes/timelines, `text-motion` for character/word reveals and `custom-animation-styles` for reusable styles. Refresh `get_capabilities` on a known node before gated work. `available` only proves API exposure/read success, not writes. Stop on an unavailable API; changing a bridge or skill cannot grant a missing native entitlement. Preserve editable text for native text motion. Manual property tracks are objects: count `track.keyframes.length`, never `track.length` or `Object.keys(track).length`. Re-read after writing and return focused keyframe data; use get_motion_context if the expected array is absent.

The calling Agent is assumed to have **no Computer Use**. Do not open menus, click Play, or require screenshots of the desktop to create or verify motion. The user starts the paired companion once per target file; subsequent Agent work uses tools only.

For actual animation verification, call `export_animation` on the containing top-level frame, with fileKey and task sessionId. It uses native `node.exportAsync` and saves real MP4/GIF/WebM bytes in the workspace. Start at width 640, 12 fps and LOW quality, then sample distinct timestamps locally (for example with ffmpeg) and inspect those images. A static `get_screenshot` is only a resting-state check. If native export is unavailable for this account/editor, report that limitation and stop export; do not switch to Computer Use or synthesize a look-alike animation. No in-editor Play/Pause tool is offered because the public Motion API has no documented playback-control method.

There is no cloud `export_video`, Weave, cloud generation, or official Code Connect publishing in this local server. Native export availability is separate from those official MCP services.

## Recover

Errors include `isError` and `safeToRetryWithoutCanvasRead`. A preflight failure with true means no script ran: correct and retry. Otherwise inspect the affected canvas/components/variables before another write; never blindly replay creation. To clear the bridge write barrier, use `get_metadata` without summary/pagination/custom budgets, then inspect affected resources as needed. After disconnect explicitly reselect the intended document. If the service/session was replaced, call `figma_status`, use `figma_select_document` to confirm the target and create a new task; status/help may reconnect automatically, canvas operations are never replayed. There is no automatic rollback.
