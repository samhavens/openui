#!/bin/bash
# Auto-expand sparse checkout when agent accesses files outside checked-out dirs.
# Only runs for sparse checkout sessions (OPENUI_SPARSE_CHECKOUT=1).
# Fires on PreToolUse for Read, Edit, Write, Grep, Glob.

[ -z "$OPENUI_SPARSE_CHECKOUT" ] && exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Read|Edit|Write) FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty') ;;
  Grep|Glob)       FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // empty') ;;
  *)               exit 0 ;;
esac

[ -z "$FILE_PATH" ] && exit 0
DIR=$(dirname "$FILE_PATH")
[ -d "$DIR" ] && exit 0  # Already checked out

# Expand sparse checkout
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
REL_DIR=$(realpath -m --relative-to="$GIT_ROOT" "$DIR" 2>/dev/null) || exit 0
git sparse-checkout add "$REL_DIR" 2>/dev/null
exit 0
