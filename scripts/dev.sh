#!/usr/bin/env bash

set -euo pipefail

# 移除 Android NDK 路径，确保系统 clang 优先
export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v -i 'android' | grep -v -i 'ndk' | tr '\n' ':' | sed 's/:$//')

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

log()   { printf "${BOLD}%s${NC}\n" "$@"; }
ok()    { printf "${GREEN}[✓]${NC} %s\n" "$@"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$@"; }
err()   { printf "${RED}[✗]${NC} %s\n" "$@"; }
info()  { printf "${CYAN}[i]${NC} %s\n" "$@"; }
step()  { printf "\n${BOLD}${CYAN}━━━ %s ━━━${NC}\n\n" "$@"; }

# ────────────────────────────────────
# 1. 环境检查
# ────────────────────────────────────
step "1/4 环境检查"

check_bin() {
  if ! command -v "$1" &>/dev/null; then
    err "未找到 $1，请先安装"
    exit 1
  fi
  ok "$1 ($($1 --version 2>&1 | head -1))"
}

check_bin node
check_bin npm

OS=$(uname -s)
case "$OS" in
  Darwin)  ok "操作系统: macOS" ;;
  Linux)   ok "操作系统: Linux" ;;
  MINGW*|MSYS*|CYGWIN*) ok "操作系统: Windows (Git Bash)" ;;
  *)       warn "未知操作系统: $OS" ;;
esac

if [ ! -d "node_modules" ]; then
  warn "node_modules 不存在，正在安装依赖..."
  npm install
  ok "依赖安装完成"
else
  ok "node_modules 已就绪"
fi

# ────────────────────────────────────
# 2. 运行测试（先恢复 Node.js 版本的 native binary）
# ────────────────────────────────────
step "2/4 运行单元测试"

if [ "${SKIP_TESTS:-0}" = "1" ]; then
  warn "已跳过测试 (SKIP_TESTS=1)"
else
  npm install better-sqlite3 2>/dev/null
  if npx vitest run --reporter=verbose 2>&1; then
    ok "全部测试通过"
  else
    err "测试失败，请修复后再启动"
    exit 1
  fi
fi

# ────────────────────────────────────
# 3. 原生模块（始终针对 Electron ABI 编译）
# ────────────────────────────────────
step "3/4 编译原生模块（Electron ABI）"

mkdir -p ~/.electron-gyp
npx electron-rebuild -f -w better-sqlite3 2>&1
ok "better-sqlite3 已针对 Electron 重新编译"

# ────────────────────────────────────
# 4. 启动开发服务器
# ────────────────────────────────────
step "4/4 启动 NovelTool 开发环境"

# 清理上次运行的残留数据（可选）
if [ "${CLEAN_DB:-0}" = "1" ]; then
  DB_PATH="$HOME/Library/Application Support/novel-tool/novel_tool.db"
  if [ -f "$DB_PATH" ]; then
    warn "清理数据库: $DB_PATH"
    rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
  fi
fi

info "NODE_ENV = ${NODE_ENV:-development}"
info "项目目录: $PROJECT_DIR"
info ""
info "可用快捷键:"
info "  SKIP_TESTS=1  跳过测试"
info "  CLEAN_DB=1    清除数据库重新开始"
info ""
info "启动后请打开 DevTools (Cmd+Option+I) 查看日志"
info "按 Ctrl+C 停止服务"
echo ""

npx electron-vite dev