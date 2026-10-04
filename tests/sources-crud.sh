#!/bin/sh
# 真机验证「自定义源」的增删改与护栏。会临时改动 /etc/config/lucisysupgrade，
# 结束时用开始前的备份还原（备份留在 /tmp/lucisysupgrade.cfg.bak）。
# 用法: tests/sources-crud.sh [ssh别名]   默认 ppuc
set -eu

HOST="${1:-ppuc}"
SSH="ssh -o BatchMode=yes -o User=root $HOST"
BAK=/tmp/lucisysupgrade.cfg.bak
fail=0

# call <method> <json-args>：把 JSON 当参数传给远端，避免多层引号打架
call() { $SSH "ubus call lucisysupgrade $1 '$2'"; }
run() { $SSH "$1"; }
check() { case "$3" in *"$2"*) echo "  ok   $1";; *) echo "  FAIL $1：期望「$2」，实际「$(echo "$3" | tr -d '\n' | cut -c1-140)」"; fail=1;; esac; }

echo "== 备份当前配置 =="
run "cp /etc/config/lucisysupgrade $BAK && echo '  已备份到 $BAK'"

echo "== 1) 默认源三条 + 激活源 =="
out=$(run "ubus call lucisysupgrade sources | tr -d '\n'")
check "含 immortalwrt 官方" '"immortalwrt_official"' "$out"
check "含 openwrt 官方" '"openwrt_official"' "$out"
check "含 rtfw" '"rtfw_immortalwrt"' "$out"
check "激活源" '"active_source": "immortalwrt_official"' "$out"

echo "== 2) 新增自定义源 =="
out=$(call source_add '{"name":"test_mirror","label":"测试镜像","url":"https://rtfw.shuery.lssa.fun","layout":"official","system":"openwrt"}' | tr -d '\n')
check "新增成功" '"ok": true' "$out"
check "出现在列表" 'test_mirror' "$out"

echo "== 3) 非法输入被拒 =="
check "标识非法" "标识只能" "$(call source_add '{"name":"Bad Name","label":"x","url":"https://a.b"}' | tr -d '\n')"
check "地址非法" "地址必须" "$(call source_add '{"name":"bad_url","label":"x","url":"ftp://a.b"}' | tr -d '\n')"
check "布局非法" "未知布局" "$(call source_add '{"name":"bad_layout","label":"x","url":"https://a.b","layout":"nope"}' | tr -d '\n')"
check "重名被拒" "标识已存在" "$(call source_add '{"name":"test_mirror","label":"x","url":"https://a.b"}' | tr -d '\n')"

echo "== 4) 编辑已有源 =="
check "编辑成功" '"ok": true' "$(call source_set '{"name":"test_mirror","label":"测试镜像2","url":"https://rtfw.shuery.lssa.fun","layout":"official","system":"openwrt"}' | tr -d '\n')"

echo "== 5) 激活自定义源并检测（应出现跨发行版警告）=="
run "ubus call lucisysupgrade set_active '{\"source\":\"test_mirror\"}' >/dev/null"
out=$(run "ubus call lucisysupgrade check '{}' | tr -d '\n'")
check "探测成功" '"ok": true' "$out"
check "跨发行版警告" "跨发行版更换" "$out"

echo "== 5b) 默认的 OpenWrt 官方源也能探测 =="
out=$(run "ubus call lucisysupgrade check '{\"source\":\"openwrt_official\"}' | tr -d '\n'")
check "openwrt 官方源探测成功" '"ok": true' "$out"
check "openwrt 官方源也有跨发行版警告" "跨发行版更换" "$out"

echo "== 6) 删除激活源 → 激活源回退 =="
out=$(call source_del '{"name":"test_mirror"}' | tr -d '\n')
check "删除成功" '"ok": true' "$out"
check "回退到 immortalwrt_official" '"active_source": "immortalwrt_official"' "$out"

echo "== 7) 「至少保留一个源」护栏 =="
for s in openwrt_official rtfw_immortalwrt; do
	call source_del "{\"name\":\"$s\"}" >/dev/null 2>&1 || true
done
out=$(run "ubus call lucisysupgrade sources | tr -d '\n'")
n=$(printf '%s' "$out" | grep -o '"url"' | wc -l)
echo "  剩余源数量: $n"
if [ "$n" -ge 1 ]; then
	check "删除最后一个被拒" "至少要保留一个源" "$(call source_del '{"name":"immortalwrt_official"}' | tr -d '\n')"
fi

echo "== 8) 还原配置 =="
run "cp $BAK /etc/config/lucisysupgrade && uci -q commit lucisysupgrade && echo '  已还原'"
out=$(run "ubus call lucisysupgrade sources | tr -d '\n'")
check "还原后仍三条" '"rtfw_immortalwrt"' "$out"
check "还原后激活源正确" '"active_source": "immortalwrt_official"' "$out"

[ $fail -eq 0 ] && echo "全部通过" || echo "存在失败项"
exit $fail
