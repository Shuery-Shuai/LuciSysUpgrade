'use strict';

// UCI 配置读取（/etc/config/lucisysupgrade）。
// 源列表可存多条，但同一时刻只有一条 active_source 生效。

let uci = require('uci');

const CONFIG = 'lucisysupgrade';

function defaults() {
	return {
		enabled: true,
		unattended: 0,
		interval: 24,
		webhook: '',
		active_source: 'immortalwrt_official',
		sources: [
			{ name: 'immortalwrt_official', label: 'ImmortalWrt 官方', url: 'https://downloads.immortalwrt.org', layout: 'official', system: '', enabled: true },
			{ name: 'shuery_bpi_r4', label: 'Shuery BPI-R4 构建', url: 'https://immortalwrt.shuery.lssa.fun', layout: 'bin_targets_root', system: '', enabled: false },
			{ name: 'rtfw', label: 'RTFW 聚合站', url: 'https://rtfw.shuery.lssa.fun', layout: 'official', system: 'immortalwrt', enabled: false }
		]
	};
}

function section_name(s) {
	return s['.name'] ?? s.name ?? '';
}

function load() {
	let g = {};
	let sources = [];

	try {
		let ctx = uci.cursor();
		g = ctx.get_all(CONFIG, 'globals') ?? {};

		ctx.foreach(CONFIG, 'source', function (s) {
			let name = section_name(s);
			if (!length(name))
				return;
			push(sources, {
				name: name,
				label: trim(s.label ?? name),
				url: trim(s.url ?? ''),
				layout: trim(s.layout ?? 'official'),
				system: trim(s.system ?? ''),
				enabled: (s.enabled ?? '1') != '0'
			});
		});
	} catch (e) {
		g = {};
		sources = [];
	}

	if (!length(sources))
		sources = defaults().sources;

	let enabled = filter(sources, function (s) { return s.enabled; });
	let active = trim(g.active_source ?? '');
	let hit = filter(enabled, function (s) { return s.name == active; });
	if (!length(hit))
		active = length(enabled) ? enabled[0].name : '';

	return {
		enabled: (g.enabled ?? '1') != '0',
		unattended: int(g.unattended ?? 0),
		interval: int(g.interval ?? 24),
		webhook: trim(g.webhook ?? ''),
		active_source: active,
		sources: sources
	};
}

function active(conf) {
	let c = conf ?? load();
	let hit = filter(c.sources, function (s) { return s.name == c.active_source; });
	return length(hit) ? hit[0] : null;
}

function unattended_label(level) {
	let labels = [ '仅检测并通知', '检测后自动下载', '检测后自动下载并刷写' ];
	return labels[int(level ?? 0)] ?? labels[0];
}

return {
	CONFIG: CONFIG,
	defaults: defaults,
	load: load,
	active: active,
	unattended_label: unattended_label
};
