#!/bin/sh
# 在路由器上安装 / 卸载本包（走 root 的 ssh 通道，文件映射与 luci.mk 一致）。
# 用法:
#   tests/install-on-device.sh [ssh别名]               安装（默认别名 ppuc，User=root）
#   tests/install-on-device.sh --uninstall [ssh别名]   卸载

set -eu

MODE="install"
if [ "${1:-}" = "--uninstall" ]; then MODE="uninstall"; shift; fi

HOST="${1:-ppuc}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/luci-app-sysupgrade"
# 与 run-on-device.sh 分开：本脚本由 root 执行，产物属 root
DEST="/tmp/lucisysupgrade-install"
SSH="ssh -o BatchMode=yes -o User=root $HOST"

if [ "$MODE" = "install" ]; then
	echo "== 同步到 $HOST:$DEST =="
	# COPYFILE_DISABLE: 阻止 macOS bsdtar 写入 ._* 扩展属性文件
	COPYFILE_DISABLE=1 tar --no-xattrs -C "$SRC/root" -czf - etc usr \
		| $SSH "rm -rf '$DEST' && mkdir -p '$DEST/www' && tar -xzf - -C '$DEST'"
	COPYFILE_DISABLE=1 tar --no-xattrs -C "$SRC/htdocs" -czf - luci-static \
		| $SSH "tar -xzf - -C '$DEST/www'"

	echo "== 安装到系统 =="
	$SSH "set -e
		cd '$DEST'
		tar -cf - etc/uci-defaults usr | tar -xf - -C /
		tar -cf - www/luci-static | tar -xf - -C /
		[ -f /etc/config/lucisysupgrade ] || cp etc/config/lucisysupgrade /etc/config/lucisysupgrade
		chmod 755 /usr/bin/lucisysupgrade /usr/share/rpcd/ucode/lucisysupgrade /etc/uci-defaults/80_lucisysupgrade
		chmod 644 /usr/share/ucode/lucisysupgrade/*.uc /etc/config/lucisysupgrade \
			/usr/share/luci/menu.d/luci-app-sysupgrade.json /usr/share/rpcd/acl.d/luci-app-sysupgrade.json \
			/www/luci-static/resources/view/sysupgrade/overview.js
		/etc/uci-defaults/80_lucisysupgrade && rm -f /etc/uci-defaults/80_lucisysupgrade
		rm -f /tmp/luci-indexcache*
		/etc/init.d/rpcd restart >/dev/null 2>&1 || true
		sleep 2
		echo '== ubus 对象 =='; ubus -v list lucisysupgrade
		echo '== 静态视图 =='; curl -skI https://127.0.0.1/luci-static/resources/view/sysupgrade/overview.js | head -1
		echo '== 激活源 =='; uci get lucisysupgrade.globals.active_source"
else
	echo "== 从 $HOST 卸载 =="
	$SSH "set -e
		for p in /usr/share/ucode/lucisysupgrade \
		         /usr/bin/lucisysupgrade \
		         /usr/share/rpcd/ucode/lucisysupgrade \
		         /usr/share/luci/menu.d/luci-app-sysupgrade.json \
		         /usr/share/rpcd/acl.d/luci-app-sysupgrade.json \
		         /www/luci-static/resources/view/sysupgrade \
		         /etc/config/lucisysupgrade; do
			if [ -e \"\$p\" ]; then echo \"删除 \$p\"; rm -rf -- \"\$p\"; fi
		done
		rm -f /tmp/lucisysupgrade.last.json /tmp/luci-indexcache*
		/etc/init.d/rpcd restart >/dev/null 2>&1 || true
		echo '已卸载'"
fi
