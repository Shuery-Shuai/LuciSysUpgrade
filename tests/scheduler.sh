#!/bin/sh
# 真机验证定时任务落地：写入/幂等/自愈/关闭，并断言 **块外内容一字不动**。
# 会临时改动 /etc/crontabs/root，结束时用备份还原。
# 用法: tests/scheduler.sh [ssh别名]   默认 ppuc
set -eu

HOST="${1:-ppuc}"
SSH="ssh -o BatchMode=yes -o User=root $HOST"
CRON=/etc/crontabs/root
BAK=/tmp/crontab.lsu-test.bak
fail=0

run() { $SSH "$1"; }
call() { $SSH "ubus call lucisysupgrade $1 '$2'"; }
check() { case "$3" in *"$2"*) echo "  ok   $1";; *) echo "  FAIL $1：期望「$2」，实际「$(printf '%s' "$3" | tr -d '\n' | cut -c1-160)」"; fail=1;; esac; }
check_not() { case "$3" in *"$2"*) echo "  FAIL $1：不该出现「$2」"; fail=1;; *) echo "  ok   $1";; esac; }

echo "== 备份并记录原始内容 =="
run "cp $CRON $BAK"
BEFORE=$(run "cat $CRON")
echo "  原始行数: $(printf '%s' "$BEFORE" | wc -l | tr -d ' ')"

echo "== 1) 状态查询（此时应为未应用）=="
out=$(run "lucisysupgrade schedule")
check "能显示调度" "调度" "$out"
check "能显示期望行" "期望行" "$out"

echo "== 2) 通过 set_options 触发同步（weekly 三 07:05）=="
call set_options '{"unattended":"0","schedule_kind":"weekly","schedule_time":"07:05","schedule_weekday":"3","schedule_day":"1","webhook":""}' >/dev/null
out=$(run "cat $CRON")
check "写入标记块开始" "BEGIN lucisysupgrade" "$out"
check "写入标记块结束" "END lucisysupgrade" "$out"
check "分钟/小时正确" "1" "$(run "grep -c '^5 7 ' $CRON || true")"
check "星期正确" "1" "$(run "grep -c '^5 7 . . 3 ' $CRON || true")"
check "调用 CLI cron" "lucisysupgrade cron" "$out"
check "用户行保留（nginx-util）" "nginx-util" "$out"
check "用户行保留（acme）" "acme renew" "$out"

echo "== 3) 幂等：再同步一次内容不变 =="
H1=$(run "md5sum $CRON | cut -d' ' -f1")
out=$(run "lucisysupgrade schedule --apply")
check "报告无需变更" "无需变更" "$out"
H2=$(run "md5sum $CRON | cut -d' ' -f1")
check "内容不变" "$H1" "$H2"

echo "== 4) 块内被手改 → 同步自愈 =="
run "sed -i 's|^5 7 .*|0 0 * * * /bin/false|' $CRON"
check "手改已生效（防止准备步骤静默失效）" "1" "$(run "grep -c '/bin/false' $CRON || true")"
out=$(run "lucisysupgrade schedule --apply")
check "报告已写入" "已写入" "$out"
check "已恢复为受管行" "lucisysupgrade cron" "$(run "cat $CRON")"
check_not "错误行已消失" "/bin/false" "$(run "cat $CRON")"

echo "== 5) 关闭调度（off）→ 只移除标记块 =="
call set_options '{"unattended":"0","schedule_kind":"off","schedule_time":"07:05","schedule_weekday":"3","schedule_day":"1","webhook":""}' >/dev/null
out=$(run "cat $CRON")
check_not "标记块已移除" "BEGIN lucisysupgrade" "$out"
check "用户行仍在" "nginx-util" "$out"
check "acme 行仍在" "acme renew" "$out"

echo "== 6) cron 子命令：档位 0 → 仅检测不下发下载 =="
out=$(run "lucisysupgrade cron --json")
check "动作是 none" '"action": "none"' "$out"
check "带上了结论" '"verdict"' "$out"

echo "== 7) 还原 crontab 并核对 =="
run "cp $BAK $CRON && rm -f $BAK $CRON.lucisysupgrade.bak && /etc/init.d/cron restart >/dev/null 2>&1 || true"
check "与原始内容一致" "$BEFORE" "$(run "cat $CRON")"

echo "== 8) 恢复默认调度（每天 04:00）=="
call set_options '{"unattended":"0","schedule_kind":"daily","schedule_time":"04:00","schedule_weekday":"1","schedule_day":"1","webhook":""}' >/dev/null
check "默认调度已写回" "1" "$(run "grep -c '^0 4 ' $CRON || true")"
check "受管行仍在" "lucisysupgrade cron" "$(run "cat $CRON")"

[ $fail -eq 0 ] && echo "全部通过" || echo "存在失败项"
exit $fail
