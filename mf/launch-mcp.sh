#!/bin/sh
# Invoked by MyFlicker's MCP loader, not by double-clicking a downloaded script.
set -eu
MF_MCP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for MF_APP_DIR in "${MF_FIGMA_APP:-/Applications/MyFlicker.app}" "$HOME/Applications/MyFlicker.app"; do
  for MF_NODE_BIN in "$MF_APP_DIR/Contents/Resources/runtime/node" "$MF_APP_DIR/Contents/Resources/runtime/runtimes/deepseek-harness/runtime/node"; do
    if [ -x "$MF_NODE_BIN" ] && "$MF_NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then
      exec "$MF_NODE_BIN" "$MF_MCP_DIR/bootstrap.mjs"
    fi
  done
done
# Optional compatibility for hosts with a suitable Node already on PATH.
MF_NODE_BIN=$(command -v node || true)
if [ -n "$MF_NODE_BIN" ] && "$MF_NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then
  exec "$MF_NODE_BIN" "$MF_MCP_DIR/bootstrap.mjs"
fi
printf '%s\n' 'Myflicker-to-Figma：没有找到 MyFlicker 内置运行环境，请将最新版应用安装到“应用程序”目录。' >&2
exit 1
