'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callSources = rpc.declare({ object: 'lucisysupgrade', method: 'sources' });
var callSetActive = rpc.declare({ object: 'lucisysupgrade', method: 'set_active', params: [ 'source' ] });

function sheet() {
	return E('link', { 'rel': 'stylesheet', 'href': L.resource('sysupgrade/sysupgrade.css') });
}

return view.extend({
	load: function() {
		return callSources();
	},

	render: function(data) {
		var self = this;
		var sources = data.sources || [];

		this.active = data.active_source || '';

		var rows = sources.map(function(s) {
			return E('tr', { 'class': (s.name === self.active) ? 'lsu-active' : '' }, [
				E('td', {}, E('input', {
					'type': 'radio',
					'name': 'lsu-active-source',
					'value': s.name,
					'checked': (s.name === self.active) ? 'checked' : null,
					'change': function(ev) { self.active = ev.target.value; }
				})),
				E('td', {}, s.label || s.name),
				E('td', { 'class': 'lsu-mono' }, s.layout || '-'),
				E('td', { 'class': 'lsu-mono' }, (s.url || '') + (s.system ? (' / ' + s.system) : ''))
			]);
		});

		return E('div', {}, [
			sheet(),
			E('h2', {}, _('Sources')),
			E('p', { 'class': 'lsu-muted' },
				_('Only one source is active at a time. Switching discards the previous check result, so that a verdict can never come from a source you are not looking at.')),

			E('table', { 'class': 'table' }, [
				E('thead', {}, E('tr', {}, [
					E('th', {}, _('Active')),
					E('th', {}, _('Name')),
					E('th', {}, _('Layout')),
					E('th', {}, _('Address'))
				])),
				E('tbody', {}, rows)
			]),

			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleSave')
				}, _('Save and apply'))
			]),

			fmt.callout('', _('Layouts'),
				_('official: <base>/{snapshots|releases/<version>}/targets/<target>/<subtarget>/ — bin_targets_root: <base>/targets/<target>/<subtarget>/ (a raw bin/targets mirror).')),
			fmt.callout('', _('Disabled sources'),
				_('Pick the radio of the source you want, then save. Only that source is probed; the others just stay in the list.'))
		]);
	},

	handleSave: function() {
		var self = this;

		return callSetActive(this.active).then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Save failed'));

			ui.addNotification(null, E('p', {}, _('Active source updated.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Save failed: ') + (err.message || err)), 'error');
		});
	},

	handleSaveApply: null,
	handleReset: null
});
