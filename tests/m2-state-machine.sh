#!/bin/sh
# 在真机上验证下载状态机里「因为网速太快而测不到」的分支。做法是直接构造
# /tmp/lucisysupgrade/download.json 与部分文件，再调 ubus 接口断言结果。
# 用法: tests/m2-state-machine.sh [ssh别名]   默认 ppuc
set -eu

HOST="${1:-ppuc}"
SSH="ssh -o BatchMode=yes -o User=root $HOST"
DIR=/tmp/lucisysupgrade
ST=$DIR/download.json
fail=0

run() { $SSH "$1"; }

check() { # check <描述> <期望子串> <实际>
	case "$3" in
		*"$2"*) echo "  ok   $1";;
		*) echo "  FAIL $1：期望包含「$2」，实际「$3」"; fail=1;;
	esac
}

echo "== 准备：清空并跑一次完整下载（用于拿到真实 url/etag/sha256）=="
run "ubus call lucisysupgrade cleanup >/dev/null 2>&1 || true"
run "ubus call lucisysupgrade set_active '{\"source\":\"shuery_bpi_r4\"}' >/dev/null"
run "ubus call lucisysupgrade download '{}' >/dev/null"
for i in $(seq 1 30); do
	s=$(run "ubus call lucisysupgrade download_status | sed -n 's/.*\"state\": \"\\([a-z]*\\)\".*/\\1/p' | head -1")
	[ "$s" = "running" ] || break
	sleep 2
done
echo "  初次下载最终状态: $s"

echo "== 分支 1：续传判据命中（文件截断 + ETag 一致 → resumed_from > 0）=="
run "head -c 8000000 $DIR/*.itb > $DIR/part && mv $DIR/part $DIR/$(run "ls $DIR | grep itb | head -1")" 2>/dev/null || true
run "ucode -L /usr/share/ucode -e '
	let fs = require(\"fs\");
	let st = json(fs.readfile(\"$ST\"));
	st.state = \"cancelled\"; st.pid = 0; st.verified = false; st.finished = 0;
	fs.writefile(\"$ST\", sprintf(\"%J\", st));
	print(\"  crafted: state=cancelled, file truncated\\n\");'"
out=$(run "ubus call lucisysupgrade download '{}' | grep -E 'resumed_from|resume_reason'")
check "续传被允许" "\"resumed_from\": 8000000" "$out"
check "续传原因" "ETag/Last-Modified 一致" "$out"

echo "== 分支 2：ETag 变化 → 拒绝续传并重下 =="
for i in $(seq 1 30); do
	s=$(run "ubus call lucisysupgrade download_status | sed -n 's/.*\"state\": \"\\([a-z]*\\)\".*/\\1/p' | head -1")
	[ "$s" = "running" ] || break
	sleep 2
done
run "f=\$(ls $DIR | grep itb | head -1); head -c 5000000 $DIR/\$f > $DIR/part && mv $DIR/part $DIR/\$f" 2>/dev/null || true
run "ucode -L /usr/share/ucode -e '
	let fs = require(\"fs\");
	let st = json(fs.readfile(\"$ST\"));
	st.state = \"cancelled\"; st.pid = 0; st.etag = \"\\\"bogus-etag\\\"\";
	fs.writefile(\"$ST\", sprintf(\"%J\", st));'"
out=$(run "ubus call lucisysupgrade download '{}' | grep -E 'resumed_from|resume_reason'")
check "续传被拒绝" "\"resumed_from\": 0" "$out"
check "拒绝原因" "ETag 变化" "$out"

echo "== 分支 3：sha256 不匹配 → failed =="
for i in $(seq 1 30); do
	s=$(run "ubus call lucisysupgrade download_status | sed -n 's/.*\"state\": \"\\([a-z]*\\)\".*/\\1/p' | head -1")
	[ "$s" = "running" ] || break
	sleep 2
done
run "for p in \$(ps w | grep '[c]url' | grep lucisysupgrade | awk '{print \$1}'); do kill -KILL \$p 2>/dev/null; done; true"
run "ucode -L /usr/share/ucode -e '
	let fs = require(\"fs\");
	let st = json(fs.readfile(\"$ST\"));
	st.state = \"running\"; st.pid = 4194303; st.sha256 = \"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef\"; st.verified = false;
	fs.writefile(\"$ST\", sprintf(\"%J\", st));
	fs.unlink(\"$DIR/download.rc\");
	print(\"  crafted: dead pid + wrong sha256\\n\");'"
out=$(run "ubus call lucisysupgrade download_status | grep -E '\"state\"|\"error\"|\"verified\"' | tr -d '\n'")
check "判定为 failed" "\"state\": \"failed\"" "$out"
check "错误提示" "sha256 不匹配" "$out"

echo "== 收尾 =="
run "ubus call lucisysupgrade cleanup >/dev/null; ubus call lucisysupgrade set_active '{\"source\":\"immortalwrt_official\"}' >/dev/null; echo '  已清理并切回官方源'"
[ $fail -eq 0 ] && echo "全部通过" || echo "存在失败项"
exit $fail
