'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callStatus = rpc.declare({ object: 'lucisysupgrade', method: 'status' });
var callSetOptions = rpc.declare({ object: 'lucisysupgrade', method: 'set_options', params: [ 'unattended', 'interval', 'webhook' ] });
var callSetActive = rpc.declare({ object: 'lucisysupgrade', method: 'set_active', params: [ 'source' ] });
var callSourceAdd = rpc.declare({ object: 'lucisysupgrade', method: 'source_add', params: [ 'name', 'label', 'url', 'layout', 'system' ] });
var callSourceDel = rpc.declare({ object: 'lucisysupgrade', method: 'source_del', params: [ 'name' ] });

var SCHEDULE = [
	{ hours: 0, text: _('Disabled') },
	{ hours: 6, text: _('Every 6 hours') },
	{ hours: 12, text: _('Every 12 hours') },
	{ hours: 24, text: _('Daily') },
	{ hours: 48, text: _('Every 2 days') },
	{ hours: 168, text: _('Weekly') }
];

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
			interval: '' + (conf.interval === undefined ? 24 : conf.interval),
			webhook: conf.webhook || ''
		};
		this.sources = conf.sources || [];
		this.active = conf.active_source || '';
		this.layouts = status.layouts || [ 'official', 'bin_targets_root' ];
		this.form = { name: '', label: '', url: '', layout: 'official', system: '' };

		var hours = parseInt(this.data.interval, 10);
		var schedule = SCHEDULE.slice();

		if (!schedule.some(function(o) { return o.hours === hours; }))
			schedule.unshift({ hours: hours, text: _('Current: every %d hours').format(hours) });

		this.tableNode = E('div', {}, this.buildSources());
		this.formNode = E('div', {}, this.buildAddForm());

		return E('div', {}, [
			sheet(),
			E('h2', {}, _('Settings')),

			E('h3', {}, _('Check sources')),
			E('p', { 'class': 'lsu-muted' },
				_('Only one source is active at a time. Switching discards the previous check result, so that a verdict can never come from a source you are not looking at.')),
			this.tableNode,

			E('h4', {}, _('Add a source')),
			E('p', { 'class': 'lsu-muted' },
				_('Any static mirror that follows the official layout works. Pick a preset or fill the fields yourself.')),
			this.formNode,

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
				_('How often the check runs unattended. It will be scheduled in /etc/crontabs/root, inside its own marked block, and never touches your existing entries. Not active yet.'),
				E('select', {
					'class': 'cbi-input-select',
					'change': function(ev) { self.data.interval = ev.target.value; }
				}, schedule.map(function(o) {
					return E('option', { 'value': '' + o.hours, 'selected': (o.hours === hours) ? 'selected' : null }, o.text);
				}))),

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
				E('td', {}, E('input', {
					'type': 'radio',
					'name': 'lsu-active-source',
					'value': s.name,
					'checked': (s.name === self.active) ? 'checked' : null,
					'change': function(ev) { self.active = ev.target.value; }
				})),
				E('td', {}, s.label || s.name),
				E('td', { 'class': 'lsu-mono' }, s.layout || '-'),
				E('td', { 'class': 'lsu-mono' }, s.url || '-'),
				E('td', { 'class': 'lsu-mono' }, s.system ? s.system : '-'),
				E('td', {}, E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'click': ui.createHandlerFn(self, 'handleDelete', s.name)
				}, _('Delete')))
			]);
		});

		return [
			E('table', { 'class': 'table' }, [
				E('thead', {}, E('tr', {}, [
					E('th', {}, _('Active')),
					E('th', {}, _('Name')),
					E('th', {}, _('Layout')),
					E('th', {}, _('Address')),
					E('th', {}, _('System')),
					E('th', {}, _('Actions'))
				])),
				E('tbody', {}, rows)
			]),
			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleSaveActive')
				}, _('Save and apply'))
			])
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
			field(_('Preset'), preset),
			field(_('Identifier'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.name, 'placeholder': 'my_mirror',
				'input': function(ev) { self.form.name = ev.target.value; }
			}), _('lower-case letters, digits, underscore; used as the UCI section name')),
			field(_('Label'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.label, 'placeholder': _('My mirror'),
				'input': function(ev) { self.form.label = ev.target.value; }
			})),
			field(_('Address'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.url, 'placeholder': 'https://example.invalid/immortalwrt',
				'input': function(ev) { self.form.url = ev.target.value; }
			})),
			field(_('Layout'), E('select', {
				'class': 'cbi-input-select',
				'change': function(ev) { self.form.layout = ev.target.value; }
			}, layouts.map(function(l) {
				return E('option', { 'value': l, 'selected': (l === self.form.layout) ? 'selected' : null }, l);
			})), _('official: <base>/{snapshots|releases/<version>}/targets/… — bin_targets_root: <base>/targets/…')),
			field(_('System'), E('input', {
				'class': 'cbi-input-text', 'type': 'text', 'value': this.form.system, 'placeholder': _('optional, e.g. immortalwrt'),
				'input': function(ev) { self.form.system = ev.target.value; }
			}), _('path segment for mirrors that host several systems, e.g. rtfw/immortalwrt')),
			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleAdd')
				}, _('Add'))
			])
		];
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

		return callSetOptions(d.unattended, d.interval, d.webhook).then(function(res) {
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
