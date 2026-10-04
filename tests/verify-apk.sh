#!/bin/sh
# 用真机的 apk-tools 深验 .apk 产物内容（apk v3 是 ADB 格式，主机侧 tar 读不了）。
# 用法: tests/verify-apk.sh [ssh别名] <本地 apk 路径>
set -eu

HOST="${1:-ppuc}"
APK="${2:?用法: tests/verify-apk.sh [ssh别名] <本地 apk 路径>}"
SSH="ssh -o BatchMode=yes -o User=root $HOST"
REMOTE=/tmp/verify-lsu.apk
fail=0

echo "== 传到路由器并读取 =="
cat "$APK" | $SSH "cat > $REMOTE"
echo "  远端体积: $($SSH "wc -c < $REMOTE" | tr -d ' ') 字节"

# apk v3 是 ADB 格式：adbdump 出的是树，manifest 才是扁平清单（需 --allow-untrusted，
# 因为我们的产物没有用设备信任的密钥签名）
echo "== apk manifest（扁平文件清单）=="
DUMP=$($SSH "apk --allow-untrusted manifest $REMOTE 2>/dev/null")
echo "  文件数: $(printf '%s' "$DUMP" | grep -c sha256 || true)"

echo "== 逐个断言关键文件 ==" 
for want in "usr/share/ucode/lucisysupgrade/util.uc" "usr/bin/lucisysupgrade" \
            "usr/share/rpcd/ucode/lucisysupgrade" "luci-static/resources/view/sysupgrade/overview.js" \
            "lucisysupgrade.zh-cn.lmo" "etc/config/lucisysupgrade" \
            "menu.d/luci-app-sysupgrade.json" "acl.d/luci-app-sysupgrade.json"; do
	case "$DUMP" in
		*"$want"*) echo "  ok   $want";;
		*) echo "  FAIL 缺少 $want"; fail=1;;
	esac
done

$SSH "rm -f $REMOTE"
[ $fail -eq 0 ] && echo "产物内容校验通过" || echo "存在缺失项"
exit $fail
