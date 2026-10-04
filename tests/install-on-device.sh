#!/bin/sh
# 在路由器上安装 / 卸载本包（root 的 ssh 通道，文件映射与 luci.mk 一致）。
# 用法:
#   tests/install-on-device.sh [ssh别名]               安装（默认别名 ppuc）
#   tests/install-on-device.sh --uninstall [ssh别名]   卸载
#
# 说明：这里用 tools/po2lmo.py 在本地把 po 编成 lmo（正式构建由 luci.mk 调 po2lmo 完成），
# 并按运行时语言码存成 zh-cn 与 zh_Hans 两份，以兼容新旧两套 LuCI 命名。

set -eu

MODE="install"
if [ "${1:-}" = "--uninstall" ]; then MODE="uninstall"; shift; fi

HOST="${1:-ppuc}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/luci-app-sysupgrade"
DEST="/tmp/lucisysupgrade-install"
LMO="/tmp/lucisysupgrade.zh.lmo"
SSH="ssh -o BatchMode=yes -o User=root $HOST"

if [ "$MODE" = "install" ]; then
	echo "== 编译 i18n（开发用，正式由 luci.mk 生成 luci-i18n-* 包）=="
	python3 "$ROOT/tools/po2lmo.py" "$SRC/po/zh_Hans/lucisysupgrade.po" "$LMO"

	echo "== 写入 lmo =="
	$SSH "mkdir -p /usr/lib/lua/luci/i18n && cat > /usr/lib/lua/luci/i18n/lucisysupgrade.zh-cn.lmo && cp /usr/lib/lua/luci/i18n/lucisysupgrade.zh-cn.lmo /usr/lib/lua/luci/i18n/lucisysupgrade.zh_Hans.lmo && ls -l /usr/lib/lua/luci/i18n/lucisysupgrade.*.lmo" < "$LMO"

	echo "== 推送文件到设备 =="
	# 踩过的坑：脚本此前只从 $DEST 拷贝到系统，却没有任何步骤把当前文件推到 $DEST，
	# 于是「安装」一直在拷几小时前的残留（输出被重定向，没人发现）。
	# macOS 的 bsdtar 必须关掉扩展属性，否则会带出 ._* 垃圾文件。
	COPYFILE_DISABLE=1 tar --no-xattrs -C "$SRC/root" -czf - etc usr | \
		$SSH "rm -rf '$DEST' && mkdir -p '$DEST' && tar -xzf - -C '$DEST'"
	COPYFILE_DISABLE=1 tar --no-xattrs -C "$SRC/htdocs" -czf - luci-static | \
		$SSH "mkdir -p '$DEST/www' && tar -xzf - -C '$DEST/www'"

	echo "== 安装到系统 =="
	$SSH "set -e
		cd '$DEST'
		tar -cf - etc/uci-defaults usr | tar -xf - -C /
		tar -cf - www/luci-static | tar -xf - -C /
		[ -f /etc/config/lucisysupgrade ] || cp etc/config/lucisysupgrade /etc/config/lucisysupgrade
		chmod 755 /usr/bin/lucisysupgrade /usr/share/rpcd/ucode/lucisysupgrade /etc/uci-defaults/80_lucisysupgrade
		chown root:root /usr/bin/lucisysupgrade /usr/share/rpcd/ucode/lucisysupgrade /etc/uci-defaults/80_lucisysupgrade
		chown -R root:root /usr/share/ucode/lucisysupgrade /www/luci-static/resources/sysupgrade \
			/www/luci-static/resources/view/sysupgrade /usr/share/luci/menu.d/luci-app-sysupgrade.json \
			/usr/share/rpcd/acl.d/luci-app-sysupgrade.json /etc/config/lucisysupgrade
		find /usr/share/ucode/lucisysupgrade /www/luci-static/resources/sysupgrade /www/luci-static/resources/view/sysupgrade -type f -exec chmod 644 {} +
		chmod 644 /etc/config/lucisysupgrade /usr/share/luci/menu.d/luci-app-sysupgrade.json /usr/share/rpcd/acl.d/luci-app-sysupgrade.json
		/etc/uci-defaults/80_lucisysupgrade && rm -f /etc/uci-defaults/80_lucisysupgrade
		rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
		/etc/init.d/rpcd restart >/dev/null 2>&1 || true
		sleep 2
		echo '== ubus 方法 =='; ubus -v list lucisysupgrade
		echo '== 静态资源 =='; for u in /luci-static/resources/view/sysupgrade/overview.js /luci-static/resources/view/sysupgrade/sources.js /luci-static/resources/view/sysupgrade/settings.js /luci-static/resources/sysupgrade/format.js /luci-static/resources/sysupgrade/sysupgrade.css; do
			printf '%s ' \"\$u\"; curl -sk -o /dev/null -w '%{http_code}\n' \"https://127.0.0.1\$u\"; done
		echo '== 激活源 =='; uci get lucisysupgrade.globals.active_source
		echo '== 版本自检 =='; lucisysupgrade version"
	if ! $SSH "lucisysupgrade version" | grep -q "$(node "$ROOT/tests/version-check.mjs" >/dev/null 2>&1; sed -n "s/.*VERSION:\s*'\([^']*\)'.*/\1/p" "$SRC/root/usr/share/ucode/lucisysupgrade/version.uc")"; then
		echo "  ✗ 设备回报的版本与 version.uc 不一致 —— 推送可能没生效"; exit 1
	fi
	echo "  ✓ 设备版本与 version.uc 一致"
else
	echo "== 从 $HOST 卸载 =="
	$SSH "set -e
		for p in /usr/share/ucode/lucisysupgrade \
		         /usr/bin/lucisysupgrade \
		         /usr/share/rpcd/ucode/lucisysupgrade \
		         /usr/share/luci/menu.d/luci-app-sysupgrade.json \
		         /usr/share/rpcd/acl.d/luci-app-sysupgrade.json \
		         /www/luci-static/resources/view/sysupgrade \
		         /www/luci-static/resources/sysupgrade \
		         /usr/lib/lua/luci/i18n/lucisysupgrade.zh-cn.lmo \
		         /usr/lib/lua/luci/i18n/lucisysupgrade.zh_Hans.lmo \
		         /etc/config/lucisysupgrade; do
			if [ -e \"\$p\" ]; then echo \"删除 \$p\"; rm -rf -- \"\$p\"; fi
		done
		rm -rf /tmp/lucisysupgrade.last.json /tmp/luci-indexcache* /tmp/luci-modulecache
		/etc/init.d/rpcd restart >/dev/null 2>&1 || true
		echo '已卸载'"
fi
