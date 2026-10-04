'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callStatus = rpc.declare({ object: 'lucisysupgrade', method: 'status' });
var callSetOptions = rpc.declare({
	object: 'lucisysupgrade', method: 'set_options',
	params: [ 'unattended', 'schedule_kind', 'schedule_time', 'schedule_weekday', 'schedule_day', 'webhook' ]
});
var callSetActive = rpc.declare({ object: 'lucisysupgrade', method: 'set_active', params: [ 'source' ] });
var callSourceAdd = rpc.declare({ object: 'lucisysupgrade', method: 'source_add', params: [ 'name', 'label', 'url', 'layout', 'system' ] });
var callSourceDel = rpc.declare({ object: 'lucisysupgrade', method: 'source_del', params: [ 'name' ] });

var SCHEDULE_KINDS = [
	{ value: 'off', text: _('Disabled') },
	{ value: 'daily', text: _('Daily') },
	{ value: 'weekly', text: _('Weekly') },
	{ value: 'monthly', text: _('Monthly') }
];

var WEEKDAYS = [ _('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'), _('Friday'), _('Saturday'), _('Sunday') ];

var PRESETS = [
	{ text: _('ImmortalWrt official'), name: 'immortalwrt_official', label: _('ImmortalWrt official'), url: 'https://downloads.immortalwrt.org', layout: 'official', system: '' },
	{ text: _('OpenWrt official'), name: 'openwrt_official', label: _('OpenWrt official'), url: 'https://downloads.openwrt.org', layout: 'official', system: '' },
	{ text: _('RTFW mirror'), name: 'rtfw_immortalwrt', label: _('RTFW mirror'), url: 'https://rtfw.shuery.lssa.fun', layout: 'official', system: 'immortalwrt' },
	{ text: _('Own bin/targets mirror'), name: 'own_bin_targets', label: _('Own build mirror'), url: 'https://immortalwrt.shuery.lssa.fun', layout: 'bin_targets_root', system: '' }
];

function sheet() {
	return E('link', { 'rel': 'stylesheet', 'href': L.resource('sysupgrade/sysupgrade.css') });
}

function replace(node, children) {
	while (node.firstChild)
		node.removeChild(node.firstChild);
	(children || []).forEach(function(c) {
		if (c)
			node.appendChild(c);
	});
}

function field(title, control, hint) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, title),
		E('div', { 'class': 'cbi-value-field' }, [ control, hint ? E('div', { 'class': 'lsu-muted' }, hint) : '' ])
	]);
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(status) {
		var conf = status.config || {};
		var self = this;

		this.data = {
			unattended: '' + (conf.unattended || 0),
			kind: conf.schedule_kind || 'daily',
			time: conf.schedule_time || '04:00',
			weekday: '' + (conf.schedule_weekday || 1),
			day: '' + (conf.schedule_day || 1),
			webhook: conf.webhook || ''
		};
		this.showForm = false;
		this.sources = conf.sources || [];
		this.active = conf.active_source || '';
		this.layouts = status.layouts || [ 'official', 'bin_targets_root' ];
		this.form = { name: '', label: '', url: '', layout: 'official', system: '' };

		this.sourcesNode = E('div', {}, this.buildSources());
		this.formNode = E('div', {}, this.buildAddForm());
		this.scheduleNode = E('div', {}, this.buildScheduleExtra());

		return E('div', { 'class': 'lsu-app' }, [
			sheet(),
			E('h2', {}, _('Settings')),

			E('h3', {}, _('Check sources')),
			E('p', { 'class': 'lsu-muted' },
				_('Only one source is active at a time. Switching discards the previous check result, so that a verdict can never come from a source you are not looking at.')),
			this.sourcesNode,

			E('h3', {}, _('Detection and notification')),

			field(_('Unattended level'),
				_('0: detect and notify only. 1: also download automatically. 2: also flash automatically (not available yet).'),
				E('select', {
					'class': 'cbi-input-select',
					'change': function(ev) { self.data.unattended = ev.target.value; }
				}, [ '0', '1', '2' ].map(function(v) {
					return E('option', { 'value': v, 'selected': (v === self.data.unattended) ? 'selected' : null },
						v + ' — ' + [ _('detect and notify'), _('download automatically'), _('flash automatically') ][parseInt(v, 10)]);
				}))),

			field(_('Scheduled task'),
				_('Runs unattended on this schedule. It will be written into /etc/crontabs/root inside its own marked block and never touches your existing entries. Not active yet.'),
				E('select', {
					'class': 'cbi-input-select',
					'change': function(ev) {
						self.data.kind = ev.target.value;
						replace(self.scheduleNode, self.buildScheduleExtra());
					}
				}, SCHEDULE_KINDS.map(function(o) {
					return E('option', { 'value': o.value, 'selected': (o.value === self.data.kind) ? 'selected' : null }, o.text);
				}))),

			this.scheduleNode,

			field(_('Webhook URL'),
				_('POST JSON when update events happen. Leave empty to disable. Not active yet.'),
				E('input', {
					'class': 'cbi-input-text',
					'type': 'text',
					'placeholder': 'https://example.invalid/hook',
					'value': self.data.webhook,
					'input': function(ev) { self.data.webhook = ev.target.value; }
				})),

			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleSaveOptions')
				}, _('Save settings'))
			]),

			fmt.callout('', _('Where settings live'),
				_('Everything is stored in /etc/config/lucisysupgrade, which is preserved by sysupgrade -k together with the rest of the configuration.'))
		]);
	},

	buildSources: function() {
		var self = this;

		var rows = this.sources.map(function(s) {
			return E('tr', {}, [
				E('td', { 'class': 'lsu-col-check' }, E('input', {
					'type': 'radio',
					'name': 'lsu-active-source',
					'value': s.name,
					'checked': (s.name === self.active) ? 'checked' : null,
					'change': function(ev) { self.active = ev.target.value; }
				})),
				E('td', { 'class': 'lsu-col-name', 'title': _('identifier') + ': ' + s.name }, s.label || s.name),
				E('td', { 'class': 'lsu-mono lsu-col-layout' }, s.layout || '-'),
				E('td', { 'class': 'lsu-mono' }, s.url || '-'),
				E('td', { 'class': 'lsu-mono lsu-col-system' }, s.system ? s.system : '-'),
				E('td', { 'class': 'lsu-col-action' }, E('button', {
					'class': 'lsu-rowbtn',
					'click': ui.createHandlerFn(self, 'handleDelete', s.name)
				}, _('Delete')))
			]);
		});

		return [
			E('table', { 'class': 'table lsu-table lsu-sources' }, [
				E('thead', {}, E('tr', {}, [
					E('th', { 'class': 'lsu-col-check' }, _('Active')),
					E('th', { 'class': 'lsu-col-name' }, _('Name')),
					E('th', { 'class': 'lsu-col-layout' }, _('Layout')),
					E('th', {}, _('Address')),
					E('th', { 'class': 'lsu-col-system' }, _('System')),
					E('th', { 'class': 'lsu-col-action' }, _('Actions'))
				])),
				E('tbody', {}, rows)
			]),
			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleSaveActive')
				}, _('Save and apply')),
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, 'handleToggleForm')
				}, this.showForm ? _('Cancel') : _('Add source'))
			]),

			this.showForm ? E('div', { 'class': 'lsu-addform' }, [
				E('p', { 'class': 'lsu-muted' },
					_('Any static mirror that follows the official layout works. Pick a preset or fill the fields yourself.')),
				this.formNode
			]) : ''
		];
	},

	buildAddForm: function() {
		var self = this;
		var layouts = this.layouts;

		var preset = E('select', {
			'class': 'cbi-input-select',
			'change': function(ev) {
				var p = PRESETS[parseInt(ev.target.value, 10)];
				if (!p)
					return;

				self.form = { name: p.name, label: p.label, url: p.url, layout: p.layout, system: p.system };
				replace(self.formNode, self.buildAddForm());
			}
		}, [ E('option', { 'value': '' }, _('— pick a preset —')) ].concat(PRESETS.map(function(p, i) {
			return E('option', { 'value': '' + i }, p.text);
		})));

		return [
			field(_('Preset'), preset, _('fills the fields below; you can edit everything afterwards')),

			// 顺序与上方表格列保持一致：名称 → 布局 → 地址 → 系统
			field(_('Label'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.label, 'placeholder': _('My mirror'),
				'input': function(ev) { self.form.label = ev.target.value; }
			}), _('shown in the table; free text, duplicates allowed')),

			field(_('Layout'), E('select', {
				'class': 'cbi-input-select',
				'change': function(ev) { self.form.layout = ev.target.value; }
			}, layouts.map(function(l) {
				return E('option', { 'value': l, 'selected': (l === this.form.layout) ? 'selected' : null }, l);
			}, this)), _('official: <base>/{snapshots|releases/<version>}/targets/… — bin_targets_root: <base>/targets/…')),

			field(_('Address'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.url, 'placeholder': 'https://example.invalid/immortalwrt',
				'input': function(ev) { self.form.url = ev.target.value; }
			})),

			field(_('System'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.system, 'placeholder': _('optional, e.g. immortalwrt'),
				'input': function(ev) { self.form.system = ev.target.value; }
			}), _('path segment for mirrors that host several systems, e.g. rtfw/immortalwrt')),

			field(_('Identifier'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.name, 'placeholder': _('auto-generated when empty'),
				'input': function(ev) { self.form.name = ev.target.value; }
			}), _('internal UCI section name (lower-case letters, digits, underscore); normally you do not need to set it')),

			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleAdd')
				}, _('Add'))
			])
		];
	},

	buildScheduleExtra: function() {
		var self = this;
		var d = this.data;
		var out = [];

		if (d.kind === 'off')
			return [ E('p', { 'class': 'lsu-muted' }, _('The scheduled check is disabled.')) ];

		if (d.kind === 'weekly')
			out.push(field(_('Weekday'), E('select', {
				'class': 'cbi-input-select',
				'change': function(ev) { self.data.weekday = ev.target.value; }
			}, WEEKDAYS.map(function(t, i) {
				return E('option', { 'value': '' + (i + 1), 'selected': (('' + (i + 1)) === d.weekday) ? 'selected' : null }, t);
			}))));

		if (d.kind === 'monthly')
			out.push(field(_('Day of month'), E('select', {
				'class': 'cbi-input-select',
				'change': function(ev) { self.data.day = ev.target.value; }
			}, Array.from({ length: 28 }, function(_, i) {
				return E('option', { 'value': '' + (i + 1), 'selected': (('' + (i + 1)) === d.day) ? 'selected' : null }, '' + (i + 1));
			})), _('1-28 only, so that every month triggers')));

		out.push(field(_('Time (24h)'), E('input', {
			'class': 'cbi-input-text',
			'type': 'time',
			'value': d.time,
			'input': function(ev) { self.data.time = ev.target.value; }
		})));

		return out;
	},

	handleToggleForm: function() {
		this.showForm = !this.showForm;
		replace(this.sourcesNode, this.buildSources());
	},

	refreshSources: function(res) {
		if (res && res.sources) {
			this.sources = res.sources;
			this.active = res.active_source || this.active;
			replace(this.tableNode, this.buildSources());
		}
	},

	handleAdd: function() {
		var self = this;
		var f = this.form;

		return callSourceAdd(f.name, f.label, f.url, f.layout, f.system).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Add failed'));

			self.refreshSources(res);
			self.form = { name: '', label: '', url: '', layout: 'official', system: '' };
			replace(self.formNode, self.buildAddForm());
			ui.addNotification(null, E('p', {}, _('Source added.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Add failed: ') + (err.message || err)), 'error');
		});
	},

	handleDelete: function(name) {
		var src = (this.sources || []).filter(function(x) { return x.name === name; })[0] || {};

		return ui.showModal(_('Delete source'), [
			E('p', {}, _('Delete source %s? Its section is removed from the configuration and the last check result is discarded.')
				.format(src.label || name)),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel') + '\u00a0'),
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, 'doDelete', name)
				}, _('Delete'))
			])
		]);
	},

	doDelete: function(name) {
		var self = this;

		ui.hideModal();

		return callSourceDel(name).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Delete failed'));

			self.refreshSources(res);
			ui.addNotification(null, E('p', {}, _('Source deleted.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Delete failed: ') + (err.message || err)), 'error');
		});
	},

	handleSaveActive: function() {
		var self = this;

		return callSetActive(this.active).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Save failed'));

			ui.addNotification(null, E('p', {}, _('Active source updated.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Save failed: ') + (err.message || err)), 'error');
		});
	},

	handleSaveOptions: function() {
		var d = this.data;

		return callSetOptions(d.unattended, d.kind, d.time, d.weekday, d.day, d.webhook).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Save failed'));

			ui.addNotification(null, E('p', {}, _('Settings saved.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Save failed: ') + (err.message || err)), 'error');
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
