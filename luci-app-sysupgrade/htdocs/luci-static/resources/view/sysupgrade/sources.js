'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callSources = rpc.declare({ object: 'lucisysupgrade', method: 'sources' });
var callSetActive = rpc.declare({ object: 'lucisysupgrade', method: 'set_active', params: [ 'source' ] });
var callSourceAdd = rpc.declare({ object: 'lucisysupgrade', method: 'source_add', params: [ 'name', 'label', 'url', 'layout', 'system' ] });
var callSourceDel = rpc.declare({ object: 'lucisysupgrade', method: 'source_del', params: [ 'name' ] });

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
		return callSources();
	},

	render: function(data) {
		this.sources = data.sources || [];
		this.active = data.active_source || '';
		this.layouts = data.layouts || [ 'official', 'bin_targets_root' ];
		this.form = { name: '', label: '', url: '', layout: 'official', system: '' };

		this.tableNode = E('div', {}, this.buildTable());
		this.formNode = E('div', {}, this.buildForm());

		return E('div', {}, [
			sheet(),
			E('h2', {}, _('Sources')),
			E('p', { 'class': 'lsu-muted' },
				_('Only one source is active at a time. Switching discards the previous check result, so that a verdict can never come from a source you are not looking at.')),

			this.tableNode,

			E('h3', {}, _('Add a source')),
			E('p', { 'class': 'lsu-muted' },
				_('Any static mirror that follows the official layout works. Pick a preset or fill the fields yourself.')),
			this.formNode
		]);
	},

	buildTable: function() {
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
					'click': ui.createHandlerFn(this, 'handleSave')
				}, _('Save and apply'))
			])
		];
	},

	buildForm: function() {
		var self = this;
		var layouts = this.layouts;

		var preset = E('select', {
			'class': 'cbi-input-select',
			'change': function(ev) {
				var p = PRESETS[parseInt(ev.target.value, 10)];

				if (!p)
					return;

				self.form = { name: p.name, label: p.label, url: p.url, layout: p.layout, system: p.system };
				replace(self.formNode, self.buildForm());
			}
		}, [ E('option', { 'value': '' }, _('— pick a preset —')) ].concat(PRESETS.map(function(p, i) {
			return E('option', { 'value': '' + i }, p.text);
		})));

		var nameInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'value': this.form.name,
			'placeholder': 'my_mirror',
			'input': function(ev) { self.form.name = ev.target.value; }
		});

		var labelInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'value': this.form.label,
			'placeholder': _('My mirror'),
			'input': function(ev) { self.form.label = ev.target.value; }
		});

		var urlInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'value': this.form.url,
			'placeholder': 'https://example.invalid/immortalwrt',
			'input': function(ev) { self.form.url = ev.target.value; }
		});

		var layoutSelect = E('select', {
			'class': 'cbi-input-select',
			'change': function(ev) { self.form.layout = ev.target.value; }
		}, layouts.map(function(l) {
			return E('option', { 'value': l, 'selected': (l === self.form.layout) ? 'selected' : null }, l);
		}));

		var systemInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'value': this.form.system,
			'placeholder': _('optional, e.g. immortalwrt'),
			'input': function(ev) { self.form.system = ev.target.value; }
		});

		return [
			field(_('Preset'), preset),
			field(_('Identifier'), nameInput, _('lower-case letters, digits, underscore; used as the UCI section name')),
			field(_('Label'), labelInput),
			field(_('Address'), urlInput),
			field(_('Layout'), layoutSelect,
				_('official: <base>/{snapshots|releases/<version>}/targets/… — bin_targets_root: <base>/targets/…')),
			field(_('System'), systemInput, _('path segment for mirrors that host several systems, e.g. rtfw/immortalwrt')),
			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleAdd')
				}, _('Add'))
			])
		];
	},

	refresh: function(res) {
		if (res && res.sources) {
			this.sources = res.sources;
			this.active = res.active_source || this.active;
			replace(this.tableNode, this.buildTable());
		}
	},

	handleAdd: function() {
		var self = this;
		var f = this.form;

		return callSourceAdd(f.name, f.label, f.url, f.layout, f.system).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Add failed'));

			self.refresh(res);
			self.form = { name: '', label: '', url: '', layout: 'official', system: '' };
			replace(self.formNode, self.buildForm());
			ui.addNotification(null, E('p', {}, _('Source added.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Add failed: ') + (err.message || err)), 'error');
		});
	},

	handleDelete: function(name) {
		var self = this;

		return callSourceDel(name).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Delete failed'));

			self.refresh(res);
			ui.addNotification(null, E('p', {}, _('Source deleted.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Delete failed: ') + (err.message || err)), 'error');
		});
	},

	handleSave: function() {
		var self = this;

		return callSetActive(this.active).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Save failed'));

			self.refresh({ sources: (res.config || {}).sources, active_source: res.active_source });
			ui.addNotification(null, E('p', {}, _('Active source updated.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Save failed: ') + (err.message || err)), 'error');
		});
	},

	handleSaveApply: null,
	handleReset: null
});
