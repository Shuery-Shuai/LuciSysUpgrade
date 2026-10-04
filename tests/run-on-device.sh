#!/bin/sh
# 把包内文件同步到路由器的 /tmp，在真机上跑 M1 检测闭环（无需 root，不改动系统）。
# 用法: tests/run-on-device.sh [ssh 别名]   默认别名: ppuc

set -eu

HOST="${1:-ppuc}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/luci-app-sysupgrade"
DEST="/tmp/lucisysupgrade-test"
LIBDIR="$DEST/usr/share/ucode"

echo "== 同步到 $HOST:$DEST =="
# COPYFILE_DISABLE: 阻止 macOS bsdtar 写入 ._* 扩展属性文件
COPYFILE_DISABLE=1 tar --no-xattrs -C "$SRC/root" -czf - \
	etc usr \
	| ssh "$HOST" "rm -rf '$DEST' && mkdir -p '$DEST' && tar -xzf - -C '$DEST' && chmod +x '$DEST/usr/bin/lucisysupgrade'"

run() {
	ssh "$HOST" "ucode -L '$LIBDIR' '$DEST/usr/bin/lucisysupgrade' $1" || true
}

echo; echo "== ucode 编译检查 =="
ssh "$HOST" "fail=0; for f in \$(find '$DEST/usr/share/ucode' -name '*.uc') '$DEST/usr/share/rpcd/ucode/lucisysupgrade' '$DEST/usr/bin/lucisysupgrade'; do
	ucode -c \"\$f\" >/dev/null 2>&1 || { echo \"FAIL \$f\"; fail=1; }; done; [ \$fail -eq 0 ] && echo 'all ucode files compile'"

echo; echo "== version =="; run version
echo; echo "== sources =="; run sources
echo; echo "== status =="; run status
echo; echo "== check：官方源（预期：远端更旧 / 可降级）=="; run check
echo "== check：自有构建站（预期：已是最新）=="; run "check --source shuery_bpi_r4"
echo "== check：rtfw（预期：远端更旧 / 可降级）=="; run "check --source rtfw"
echo "== check --json（官方源，截断 400 字节）=="; run "--json check" | head -c 400; echo
