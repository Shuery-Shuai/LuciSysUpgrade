#!/usr/bin/env node
// 无浏览器渲染检查：在 Node 里按 luci.js 的加载规则把视图的 'require ... as ...' 指令
// 绑定成参数，再跑 load() / render() / 事件处理器。
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

const fixtures = {
	status: JSON.parse(fs.readFileSync(path.join(FIX, 'status.json'), 'utf8')),
	sources: JSON.parse(fs.readFileSync(path.join(FIX, 'sources.json'), 'utf8'))
};

const VIEWS = [
	{ file: 'view/sysupgrade/overview.js', data: 'status', methods: { status: fixtures.status, check: fixtures.status.last }, expect: [ 'System Update', 'Check for updates' ] },
	{ file: 'view/sysupgrade/sources.js', data: 'sources', methods: { sources: fixtures.sources, set_active: { ok: true } }, expect: [ 'Sources', 'Save and apply' ] },
	{ file: 'view/sysupgrade/settings.js', data: 'status', methods: { status: fixtures.status, set_options: { ok: true } }, expect: [ 'Settings', 'Unattended level' ] }
];

// 与 luci.js 完全相同的指令正则（modules/luci-base/htdocs/luci-static/resources/luci.js）
const REQUIRE_RE = /^require[ \t]+(\S+)(?:[ \t]+as[ \t]+([a-zA-Z_]\S*))?$/;

function parseDirectives(source) {
	const deps = [];
	const re = /(['"])(require[ \t]+\S+(?:[ \t]+as[ \t]+[a-zA-Z_]\S*)?)\1[ \t]*;/g;
	let m;
	while ((m = re.exec(source)) !== null) {
		const d = REQUIRE_RE.exec(m[2]);
		if (!d)
			continue;
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
	const declared = [];
	const notifications = [];

	// 最小 DOM 语义：视图里会用到 appendChild / removeChild / firstChild 做局部重渲染
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
			env: {}
		},
		Date, JSON, Math, Object, Array, Promise, console
	};

	ctx.globalThis = ctx;
	vm.createContext(ctx);

	// LuCI 在浏览器里给 String 加了 format()；桩必须同样提供，否则会误报
	vm.runInContext(`
		String.prototype.format = function () {
			const args = Array.from(arguments);
			return this.replace(/%[sdf]/g, m => (args.length ? String(args.shift()) : m));
		};
	`, ctx);

	const modules = {
		view: { extend: o => o },
		ui: {
			createHandlerFn: (self, name) => (...args) => self[name](...args),
			addNotification: (title, children, ...classes) => notifications.push({ title, children, classes })
		},
		rpc: {
			declare: spec => {
				declared.push(spec);
				return (...args) => Promise.resolve(methods[spec.method]);
			}
		}
	};

	return { ctx, modules, declared, notifications };
}

// 用与 luci.js 相同的 IIFE + 参数绑定方式求值模块文件
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
	return { value: fn(...args.map(a => a.value)), deps: deps.map(d => `${d.dep} as ${d.as}`) };
}

let failed = 0;

for (const spec of VIEWS) {
	const { ctx, modules, notifications } = makeContext(spec.methods);

	try {
		// 先加载我们自己写的公共模块，保证它也能被求值（等价于浏览器里 require 它）
		modules['sysupgrade.format'] = evalModule(ctx, { ...modules, 'sysupgrade.format': null }, path.join(RES, 'sysupgrade/format.js')).value;

		const { value: view, deps } = evalModule(ctx, modules, path.join(RES, spec.file));

		if (typeof view.load !== 'function' || typeof view.render !== 'function')
			throw new Error('导出的对象缺少 load()/render()');

		const data = await view.load();
		const tree = view.render(spec.data === 'sources' ? data : data);
		const text = collectText(tree).join(' ');

		const missing = spec.expect.filter(s => !text.includes(s));
		if (missing.length)
			throw new Error('渲染结果缺少文案: ' + missing.join(', '));

		for (const handler of [ 'handleCheck', 'handleSave' ]) {
			if (typeof view[handler] === 'function')
				await view[handler]({ currentTarget: { disabled: false, classList: { add() {}, remove() {} } }, preventDefault() {} });
		}

		console.log(`ok   ${spec.file}  [${deps.join(' | ')}]  文本 ${text.length} 字符，通知 ${notifications.length} 条`);
	} catch (e) {
		console.log(`FAIL ${spec.file}: ${e.message}`);
		failed++;
	}
}

console.log(failed ? `\n${failed} 个视图未通过` : '\n所有视图渲染检查通过');
process.exit(failed ? 1 : 0);
