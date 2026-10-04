'use strict';

// 定时检测：把调度写进 /etc/crontabs/root 的**标记块**里。
//
// 安全约定（这是本项目唯一会写系统全局文件的地方）：
//   - 只增删自己标记块内的行，块外内容一字不动（用户已有的 nginx-util / acme 等必须原样保留）
//   - 写之前先备份到 <crontab>.lucisysupgrade.bak，便于人工回退
//   - 幂等：内容一致就不写文件、不重启 cron
//   - 关闭调度（kind=off）时只移除标记块，不留空痕

let fs = require('fs');
let util = require('lucisysupgrade.util');
let config = require('lucisysupgrade.config');

const CRONTAB = '/etc/crontabs/root';
const BEGIN = '# BEGIN lucisysupgrade (managed block, do not edit)';
const END = '# END lucisysupgrade';
const LOG = '/tmp/lucisysupgrade/cron.log';
const CMD = '/usr/bin/lucisysupgrade cron';

function cron_line(conf) {
	let expr = config.schedule_cron(conf ?? config.load());
	if (!length(expr))
		return '';

	return sprintf('%s %s >> %s 2>&1', expr, CMD, LOG);
}

// 去掉标记块（含标记行），返回剩余行
function strip_block(text) {
	let out = [];
	let inside = false;

	for (let line in split(text ?? '', '\n')) {
		let t = trim(line);

		if (t == BEGIN) {
			inside = true;
			continue;
		}
		if (t == END) {
			inside = false;
			continue;
		}
		if (!inside)
			push(out, line);
	}

	while (length(out) && !length(trim(out[length(out) - 1])))
		pop(out);

	return out;
}

function read_block(text) {
	let out = [];
	let inside = false;

	for (let line in split(text ?? '', '\n')) {
		let t = trim(line);

		if (t == BEGIN) {
			inside = true;
			continue;
		}
		if (t == END) {
			inside = false;
			continue;
		}
		if (inside && length(t))
			push(out, line);
	}

	return out;
}

function status() {
	let conf = config.load();
	let text = fs.readfile(CRONTAB) ?? '';
	let block = read_block(text);

	return {
		path: CRONTAB,
		schedule: config.schedule_label(conf),
		wanted: cron_line(conf),
		applied: length(block) ? trim(block[0]) : '',
		block: block,
		in_sync: trim(length(block) ? block[0] : '') == trim(cron_line(conf))
	};
}

// 把 crontab 同步到配置描述的状态
function sync() {
	let conf = config.load();
	let wanted = cron_line(conf);
	let cur = fs.readfile(CRONTAB) ?? '';
	let lines = strip_block(cur);

	if (length(wanted)) {
		push(lines, BEGIN);
		push(lines, wanted);
		push(lines, END);
	}

	let next = length(lines) ? (join('\n', lines) + '\n') : '';

	if (next == cur)
		return { ok: true, changed: false, line: wanted, schedule: config.schedule_label(conf) };

	try {
		fs.writefile(CRONTAB + '.lucisysupgrade.bak', cur);
	} catch (e) {
	}

	if (!fs.writefile(CRONTAB, next))
		return { ok: false, error: '写入 ' + CRONTAB + ' 失败' };

	// busybox crond 会检测 mtime，但显式重启最稳（这台设备的 init 脚本没有 reload 动作）
	util.run('/etc/init.d/cron restart >/dev/null 2>&1');

	return { ok: true, changed: true, line: wanted, schedule: config.schedule_label(conf) };
}

return {
	CRONTAB: CRONTAB,
	BEGIN: BEGIN,
	END: END,
	cron_line: cron_line,
	strip_block: strip_block,
	read_block: read_block,
	status: status,
	sync: sync
};
