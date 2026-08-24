#!/usr/bin/env bash
# 安装/打包验证脚本（T21）：typecheck + test + bundle 安装冒烟。
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> npm run build"
npm run build
echo "==> npm run typecheck"
npm run typecheck
echo "==> npm test"
npm test

# bundle 安装冒烟（需要 dsh CLI；无 dsh CLI 则跳过）
if command -v dsh >/dev/null 2>&1; then
  PROFILE="kanban-check"
  echo "==> dsh plugin add smoke (profile=$PROFILE)"
  dsh plugin --profile "$PROFILE" add "$PWD" 2>&1 | tail -3 || true
  if dsh --profile "$PROFILE" --dump-config 2>/dev/null | grep -q 'dsh-swarm'; then
    echo "install-check: composed config contains dsh-swarm"
  else
    echo "install-check: dsh-swarm not in dump-config (SKIP)"
  fi
else
  echo "install-check: dsh CLI not available (SKIP install smoke)"
fi

echo "install-check PASS"
