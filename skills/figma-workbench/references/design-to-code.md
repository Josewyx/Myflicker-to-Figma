# Figma to application code

1. If the frame is unknown, locate the smallest useful one with summary metadata. For a known frame, directly get its detailed context, reusing a user-provided image when available. The local result contains a native node tree and `getCSSAsync()` values; it does not claim to reproduce Figma's cloud-generated React output. Set `includeScreenshot:false`; screenshots are only taken on explicit user request.
2. Inspect the project's actual framework, components, tokens and conventions. Map design semantics into them instead of pasting absolute coordinates or introducing a new framework.
3. Read only the relevant variable definitions, modes, component context and local component links to preserve intent. Filter and page discovery results, then follow explicit IDs for details. Official Code Connect mappings are only available when the official backend supplies those tools.
4. Reuse assets already provided in the workspace. If source assets are missing, ask the user to export them manually from Figma; do not automatically call download_assets or node.exportAsync. Do not draw a guessed logo or replace provided images with emoji.
5. Implement responsive constraints, semantic elements, accessible names and keyboard behavior in code. Translate auto layout into flex/grid when appropriate. Preserve deliberate overlaps rather than forcing everything into cards.
6. Run the project checks appropriate to the implementation. The user previews the result; do not generate exported files or screenshots for acceptance unless explicitly requested. Do not claim a visual match from compilation alone.

For native SwiftUI, map reusable Figma components into Views and state, typography into actual platform styles/custom fonts, and auto layout into stacks, grids and alignment. Assess dynamic type and safe areas. Do not assume a Figma pixel-perfect fixed frame is the desired behavior on every device.

Local component-to-code links use node plugin data. They are useful to DSH across sessions but are not published Code Connect. Name them accurately in delivery.
