#!/usr/bin/env node
// 无浏览器渲染检查：按 luci.js 的加载规则把视图的 'require … as …' 指令绑成参数，
// 再用桩跑 load() / render() / 事件处理器，覆盖下载状态的各个分支。
// 目的：在没有浏览器的环境里抓住 ReferenceError、字段名写错、模块路径写错这类问题。
// 用法: node tests/render-check.mjs
//
// 桩里**故意不提供 sprintf**（浏览器端 LuCI 也没有），只能用 String.prototype.format。

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(ROOT, 'luci-app-sysupgrade/htdocs/luci-static/resources');
const FIX = path.join(ROOT, 'tests/fixtures');

const readFixture = name => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const baseStatus = readFixture('status.json');
const baseSources = readFixture('sources.json');

// 与 luci.js 完全相同的指令正则
const REQUIRE_RE = /^require[ \t]+(\S+)(?:[ \t]+as[ \t]+([a-zA-Z_]\S*))?$/;

function parseDirectives(source) {
	const deps = [];
	const re = /(['"])(require[ \t]+\S+(?:[ \t]+as[ \t]+[a-zA-Z_]\S*)?)\1[ \t]*;/g;
	let m;
	while ((m = re.exec(source)) !== null) {
		const d = REQUIRE_RE.exec(m[2]);
		if (d)
			deps.push({ dep: d[1], as: d[2] || d[1].replace(/[^a-zA-Z0-9_]/g, '_') });
	}
	return deps;
}

function collectText(node, out = []) {
	if (node === null || node === undefined)
		return out;
	if (typeof node === 'string' || typeof node === 'number')
		out.push(String(node));
	else if (Array.isArray(node))
		node.forEach(n => collectText(n, out));
	else if (typeof node === 'object') {
		Object.values(node.attrs || {}).forEach(v => collectText(v, out));
		collectText(node.children, out);
	}
	return out;
}

function makeContext(methods) {
	const notifications = [];
	const polled = { added: 0, removed: 0 };
	const modals = { shown: 0, hidden: 0 };

	const makeEl = (tag, attrs, children) => {
		const el = {
			tag,
			attrs: attrs || {},
			children: [],
			get firstChild() { return this.children[0] || null; },
			appendChild(child) {
				if (child === null || child === undefined || child === '')
					return child;
				if (Array.isArray(child))
					child.forEach(c => this.appendChild(c));
				else
					this.children.push(child);
				return child;
			},
			removeChild(child) {
				const i = this.children.indexOf(child);
				if (i >= 0)
					this.children.splice(i, 1);
				return child;
			}
		};
		el.appendChild(children === undefined ? [] : children);
		return el;
	};

	const ctx = {
		E: makeEl,
		_: (s, ...args) => String(s).replace(/%[sdf]/g, () => (args.length ? args.shift() : '')),
		L: {
			resource: p => '/luci-static/resources/' + p,
			url: (...p) => '/cgi-bin/luci/' + p.join('/'),
			bind: (fn, self, ...args) => fn.bind(self, ...args),
			env: {}
		},
		Date, JSON, Math, Object, Array, Promise, console
	};

	ctx.globalThis = ctx;
	vm.createContext(ctx);

	vm.runInContext(`
		String.prototype.format = function () {
			const args = Array.from(arguments);
			return this.replace(/%[sdf]/g, m => (args.length ? String(args.shift()) : m));
		};
	`, ctx);

	// LuCI 的 Class.extend 返回构造器；模块必须返回构造器，加载器会 new 出实例
	const makeClass = proto => {
		const Klass = function () { Object.assign(this, proto); };
		Klass.extend = sub => makeClass(Object.assign({}, proto, sub));
		return Klass;
	};

	const modules = {
		baseclass: { extend: makeClass },
		view: { extend: makeClass },
		ui: {
			createHandlerFn: (self, name, ...bound) => (...args) => self[name](...bound, ...args),
			addNotification: (title, children, ...classes) => notifications.push({ title, children, classes }),
			showModal: (title, children) => { modals.shown++; return { title, children }; },
			hideModal: () => { modals.hidden++; }
		},
		rpc: { declare: spec => () => Promise.resolve(methods[spec.method]) },
		poll: {
			add: () => { polled.added++; },
			remove: () => { polled.removed++; },
			active: () => false, call: () => {}, start: () => {}, stop: () => {}
		}
	};

	return { ctx, modules, notifications, polled, modals };
}

function evalModule(ctx, modules, file) {
	const source = fs.readFileSync(file, 'utf8');
	const deps = parseDirectives(source);
	const args = [];

	for (const d of deps) {
		if (!(d.dep in modules))
			throw new Error(`模块 ${d.dep} 没有桩（视图要求了它）`);
		args.push({ as: d.as, value: modules[d.dep] });
	}

	const fn = vm.runInContext('(function (' + args.map(a => a.as).join(', ') + ') {\n' + source + '\n})', ctx, { filename: file });
	const yielded = fn(...args.map(a => a.value));

	// 忠实复现 luci.js：Class.isSubclass(yielded) 不成立就报这条错
	if (typeof yielded !== 'function')
		throw new Error(`"${file}" factory yields invalid constructor`);

	return { value: new yielded(), deps: deps.map(d => `${d.dep} as ${d.as}`) };
}

const fakeEv = () => ({ currentTarget: { disabled: false, classList: { add() {}, remove() {} } }, preventDefault() {} });
const FILE = '/tmp/lucisysupgrade/immortalwrt-mediatek-filogic-bananapi_bpi-r4-squashfs-sysupgrade.itb';

const VIEWS = [
	{
		file: 'view/sysupgrade/overview.js',
		base: { status: baseStatus },
		extra: { download: { ok: true, state: 'running', received: 1024, size: 2048, percent: 50 }, download_status: { state: 'cancelled' }, cancel: { ok: true }, cleanup: { ok: true }, check: baseStatus.last },
		handlers: [ 'handleCheck', 'handleDownload', 'handleCancel', 'handleCleanup' ],
		cases: [
			{ name: '无下载', data: baseStatus, expect: [ 'Download image' ] },
			{ name: '下载中', data: { ...baseStatus, download: { state: 'running', received: 5160906, size: 23593558, percent: 21 } }, expect: [ 'Cancel', 'Downloading', '21%' ] },
			{ name: '已校验', data: { ...baseStatus, download: { state: 'verified', file: FILE, size: 23593558, sha256: 'a'.repeat(64) } }, expect: [ 'Downloaded and verified', 'Delete file' ] },
			{ name: '失败', data: { ...baseStatus, download: { state: 'failed', error: 'curl exit 22' } }, expect: [ 'Download failed', 'Retry download', 'curl exit 22' ] },
			{ name: '已取消', data: { ...baseStatus, download: { state: 'cancelled' } }, expect: [ 'Resume download', 'Download cancelled' ] }
		]
	},
	{
		file: 'view/sysupgrade/sources.js',
		base: { sources: baseSources },
		extra: {
			set_active: { ok: true, active_source: 'immortalwrt_official', config: { sources: baseSources.sources } },
			source_add: { ok: true, sources: baseSources.sources, active_source: 'immortalwrt_official' },
			source_del: { ok: true, sources: baseSources.sources, active_source: 'immortalwrt_official' }
		},
		handlers: [ 'handleSave', 'handleAdd', { name: 'handleDelete', args: [ 'openwrt_official' ] }, { name: 'doDelete', args: [ 'openwrt_official' ] } ],
		cases: [ { name: '源列表与自定义源', data: baseSources, expect: [ 'Sources', 'Save and apply', 'Add a source', 'Delete', 'Preset' ] } ]
	},
	{
		file: 'view/sysupgrade/settings.js',
		base: { status: baseStatus },
		extra: { set_options: { ok: true } },
		handlers: [ 'handleSave' ],
		cases: [ { name: '设置', data: baseStatus, expect: [ 'Settings', 'Unattended level', 'Scheduled task' ] } ]
	}
];

let failed = 0;
let passed = 0;

// 自检：确认加载器真的会拒绝「返回普通对象」的模块（这正是线上崩过的那条错）
{
	const { ctx, modules } = makeContext({});
	const bad = path.join(ROOT, 'tests/fixtures/bad-module.js');
	fs.writeFileSync(bad, "'use strict';\nreturn { hello: 1 };\n");
	try {
		evalModule(ctx, modules, bad);
		console.log('FAIL 自检：普通对象模块应当被拒绝，但没有');
		failed++;
	} catch (e) {
		if (String(e.message).includes('factory yields invalid constructor')) {
			console.log('ok   自检：普通对象模块被正确拒绝');
			passed++;
		} else {
			console.log('FAIL 自检：拒绝原因不符 -> ' + e.message);
			failed++;
		}
	} finally {
		fs.unlinkSync(bad);
	}
}

for (const spec of VIEWS) {
	for (const c of spec.cases) {
		const { ctx, modules, notifications, polled, modals } = makeContext({ ...spec.base, ...spec.extra, status: c.data });

		try {
			modules['sysupgrade.format'] = evalModule(ctx, { ...modules, 'sysupgrade.format': null }, path.join(RES, 'sysupgrade/format.js')).value;

			const { value: view } = evalModule(ctx, modules, path.join(RES, spec.file));
			if (typeof view.load !== 'function' || typeof view.render !== 'function')
				throw new Error('导出的对象缺少 load()/render()');

			const data = await view.load();
			const text = collectText(view.render(data)).join(' ');

			const missing = c.expect.filter(s => !text.includes(s));
			if (missing.length)
				throw new Error('渲染结果缺少文案: ' + missing.join(', '));

			for (const handler of spec.handlers || []) {
				const name = (typeof handler === 'string') ? handler : handler.name;
				const args = (typeof handler === 'string') ? [ fakeEv() ] : handler.args;

				if (typeof view[name] === 'function')
					await view[name](...args);
			}

			console.log(`ok   ${spec.file} · ${c.name}（文本 ${text.length} 字符，通知 ${notifications.length}，弹窗 +${modals.shown}/-${modals.hidden}，poll +${polled.added}/-${polled.removed}）`);
			passed++;
		} catch (e) {
			console.log(`FAIL ${spec.file} · ${c.name}: ${e.message}`);
			failed++;
		}
	}
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
