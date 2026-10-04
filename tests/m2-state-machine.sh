#!/bin/sh
# 真机验证下载状态机的分支。为不受 CDN 速度影响，这里不真下载：
# 用 check 拿到候选镜像的 url/size/sha256，用 HEAD 拿 etag，再伪造「部分文件 + 状态」。
# 用法: tests/m2-state-machine.sh [ssh别名]   默认 ppuc
set -eu

HOST="${1:-ppuc}"
SSH="ssh -o BatchMode=yes -o User=root $HOST"
DIR=/tmp/lucisysupgrade
CRAFT=/tmp/lsu-craft.uc
INFO=/tmp/lsu-info.uc
fail=0

run() { $SSH "$1"; }
check() { case "$3" in *"$2"*) echo "  ok   $1";; *) echo "  FAIL $1：期望「$2」，实际「$(printf '%s' "$3" | tr -d '\n\t' | cut -c1-160)」"; fail=1;; esac; }

# 取候选镜像信息（不下载）
$SSH "cat > $INFO" <<'UCODE'
let conf = require('lucisysupgrade.config');
let local = require('lucisysupgrade.local');
let source = require('lucisysupgrade.source');
let dl = require('lucisysupgrade.download');
let c = conf.load();
let src = conf.active(c);
let loc = local.identity();
let r = source.probe(src, loc, '');
if (!r.ok) { print('error=' + r.error + "\n"); exit(1); }
let url = source.url_join([ r.dir, r.image.name ]);
let m = dl.head_meta(url);
print('url=' + url + "\n");
print('file=' + '/tmp/lucisysupgrade/' + r.image.name + "\n");
print('size=' + r.image.size + "\n");
print('sha256=' + r.image.sha256 + "\n");
print('etag=' + (m?.etag ?? '') + "\n");
print('last_modified=' + (m?.last_modified ?? '') + "\n");
UCODE

# 构造状态：craft <state> <pid> <file> <size> <sha256> <etag> <url>
$SSH "cat > $CRAFT" <<'UCODE'
let fs = require('fs');
let state = ARGV[0], pid = ARGV[1], file = ARGV[2];
let size = ARGV[3], sha = ARGV[4], etag = ARGV[5], url = ARGV[6], lm = ARGV[7];
let st = {
	state: state, pid: int(pid), file: file, size: int(size), sha256: sha,
	etag: (etag == '-') ? '' : etag, last_modified: (lm == '-') ? '' : (lm ?? ''), url: url,
	resumed_from: 0, resume_reason: 'crafted',
	source: 'crafted', channel: 'snapshots', version_code: 'crafted',
	remote: { source: 'crafted', file: file, version_code: 'crafted', channel: 'snapshots',
		source_date_epoch: 0, image: { name: file, size: int(size), sha256: sha } },
	started: time(), finished: 0, verified: false, error: ''
};
try { fs.mkdir('/tmp/lucisysupgrade', 0o755); } catch (e) {}
fs.writefile('/tmp/lucisysupgrade/download.json', sprintf('%J', st));
try { fs.unlink('/tmp/lucisysupgrade/download.rc'); } catch (e) {}
print('crafted ' + state + ' file=' + file + ' size=' + size + "\n");
UCODE
craft() { run "ucode -L /usr/share/ucode $CRAFT $1 '$2' '$3' '$4' '$5' '$6' '$7' '$8'"; }

echo "== 准备：用当前激活源取候选镜像信息（不下载，故与网速无关）=="
run "ubus call lucisysupgrade cleanup >/dev/null 2>&1 || true"
INFOOUT=$(run "ucode -L /usr/share/ucode $INFO")
ACTIVE=$(run "uci get lucisysupgrade.globals.active_source")
echo "  激活源: $ACTIVE"
URL=$(printf '%s\n' "$INFOOUT" | sed -n 's/^url=//p')
FILE=$(printf '%s\n' "$INFOOUT" | sed -n 's/^file=//p')
SIZE=$(printf '%s\n' "$INFOOUT" | sed -n 's/^size=//p')
SHA=$(printf '%s\n' "$INFOOUT" | sed -n 's/^sha256=//p')
ETAG=$(printf '%s\n' "$INFOOUT" | sed -n 's/^etag=//p')
LM=$(printf '%s\n' "$INFOOUT" | sed -n 's/^last_modified=//p')
echo "  镜像: $(basename "$FILE")  大小: $SIZE   etag: $ETAG"
[ -n "$SIZE" ] || { echo "取镜像信息失败"; exit 1; }

echo "== 分支 1：续传命中（部分文件 + ETag 一致 → resumed_from>0）=="
run "head -c 8000000 /dev/zero > '$FILE'"
craft cancelled 0 "$FILE" "$SIZE" "$SHA" "$ETAG" "$URL" "$LM" >/dev/null
out=$(run "ubus call lucisysupgrade download '{}' | tr -d '\n'")
echo "    调试｜响应: $(printf '%s' "$out" | grep -oE '\"(resumed_from|resume_reason|state|size|error)\": [^,]{0,60}' | tr '\n' ' ')"
echo "    （调试）file=$(basename "$FILE") size=$SIZE etag=$ETAG last-modified=$LM"
check "续传被允许" '"resumed_from": 8000000' "$out"
check "续传原因" "ETag/Last-Modified 一致" "$out"
run "for p in \$(ps w | grep '[c]url' | grep lucisysupgrade | awk '{print \$1}'); do kill -KILL \$p 2>/dev/null; done; true"

echo "== 分支 2：ETag 变化 → 拒绝续传并重下 =="
run "head -c 5000000 /dev/zero > '$FILE'"
craft cancelled 0 "$FILE" "$SIZE" "$SHA" 'bogus-etag' "$URL" "$LM" >/dev/null
out=$(run "ubus call lucisysupgrade download '{}' | tr -d '\n'")
check "续传被拒绝" '"resumed_from": 0' "$out"
check "拒绝原因" "ETag 变化" "$out"
run "for p in \$(ps w | grep '[c]url' | grep lucisysupgrade | awk '{print \$1}'); do kill -KILL \$p 2>/dev/null; done; true"

echo "== 分支 3：体积不符 → failed =="
run "printf 'lucisysupgrade-payload' > $DIR/small.bin"
craft running 4194303 "$DIR/small.bin" 999999 "$SHA" - "$URL" - >/dev/null
out=$(run "ubus call lucisysupgrade download_status | tr -d '\n'")
check "判定为 failed" '"state": "failed"' "$out"
check "原因是体积不符" "文件不完整" "$out"
check "失败事件已记录" "下载失败" "$(run "ubus call lucisysupgrade logs | tr -d '\n'")"

echo "== 分支 4：小文件 + 正确 sha256 → verified =="
SMALL=$(run "wc -c < $DIR/small.bin")
SMALL_SHA=$(run "sha256sum $DIR/small.bin | cut -d' ' -f1")
craft running 4194303 "$DIR/small.bin" "$SMALL" "$SMALL_SHA" - "$URL" - >/dev/null
out=$(run "ubus call lucisysupgrade download_status | tr -d '\n'")
check "判定为 verified" '"state": "verified"' "$out"
check "verified 标记为真" '"verified": true' "$out"
check "完成事件已记录" "下载完成并通过校验" "$(run "ubus call lucisysupgrade logs | tr -d '\n'")"

echo "== 分支 5：cleanup 杀掉进行中的下载进程组 =="
PID=$(run "setsid sh -c 'sleep 90' >/dev/null 2>&1 & echo \$!")
echo "  造了一个进程组: $PID"
craft running "$PID" "$DIR/ghost.bin" 1024 "00" - "$URL" - >/dev/null
run "ubus call lucisysupgrade cleanup >/dev/null"
sleep 1
check "进程组已终止" "已终止" "$(run "kill -0 -$PID 2>/dev/null && echo 仍在 || echo 已终止")"
check "目录已清空" "空" "$(run "[ -z \"\$(ls $DIR 2>/dev/null)\" ] && echo 空 || ls $DIR")"

echo "== 收尾 =="
run "ubus call lucisysupgrade cleanup >/dev/null; rm -f $CRAFT $INFO; echo '  已清理（激活源保持不变）'"

[ $fail -eq 0 ] && echo "全部通过" || echo "存在失败项"
exit $fail
