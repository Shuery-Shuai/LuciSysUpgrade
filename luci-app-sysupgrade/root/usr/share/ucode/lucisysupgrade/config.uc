'use strict';

// UCI 配置读取（/etc/config/lucisysupgrade）。
// 源列表可存多条，但同一时刻只有一条 active_source 生效。

let uci = require('uci');

const CONFIG = 'lucisysupgrade';
const LAYOUTS = [ 'official', 'bin_targets_root' ];

function defaults() {
	return {
		enabled: true,
		unattended: 0,
		interval: 24,
		webhook: '',
		active_source: 'immortalwrt_official',
		sources: [
			{ name: 'immortalwrt_official', label: 'ImmortalWrt 官方', url: 'https://downloads.immortalwrt.org', layout: 'official', system: '' },
			{ name: 'openwrt_official', label: 'OpenWrt 官方', url: 'https://downloads.openwrt.org', layout: 'official', system: '' },
			{ name: 'rtfw_immortalwrt', label: 'RTFW 聚合站（immortalwrt）', url: 'https://rtfw.shuery.lssa.fun', layout: 'official', system: 'immortalwrt' }
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

		// rpcd 是长驻进程，而 ucode 的 uci 模块带进程级配置缓存：
		// 不显式 reload 就会读到本进程启动时的旧配置 —— 表现为切换激活源之后
		// 仍然去探测上一个源，结论来源与界面显示不一致。
		ctx.load(CONFIG);

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
				system: trim(s.system ?? '')
			});
		});
	} catch (e) {
		g = {};
		sources = [];
	}

	if (!length(sources))
		sources = defaults().sources;

	// 源只有“存在”与“激活”两种状态，没有 enabled 这个中间态：
	// 激活源缺失或指向不存在的段时，退回列表里的第一个源。
	let active = trim(g.active_source ?? '');
	let hit = filter(sources, function (s) { return s.name == active; });
	if (!length(hit))
		active = length(sources) ? sources[0].name : '';

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
	LAYOUTS: LAYOUTS,
	defaults: defaults,
	load: load,
	active: active,
	unattended_label: unattended_label
};
