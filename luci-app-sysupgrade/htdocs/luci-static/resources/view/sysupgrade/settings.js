'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callStatus = rpc.declare({ object: 'lucisysupgrade', method: 'status' });
var callSetOptions = rpc.declare({ object: 'lucisysupgrade', method: 'set_options', params: [ 'unattended', 'interval', 'webhook' ] });

var SCHEDULE = [
	{ hours: 0, text: _('Disabled') },
	{ hours: 6, text: _('Every 6 hours') },
	{ hours: 12, text: _('Every 12 hours') },
	{ hours: 24, text: _('Daily') },
	{ hours: 48, text: _('Every 2 days') },
	{ hours: 168, text: _('Weekly') }
];

function sheet() {
	return E('link', { 'rel': 'stylesheet', 'href': L.resource('sysupgrade/sysupgrade.css') });
}

function field(title, description, control) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, title),
		E('div', { 'class': 'cbi-value-field' }, [ control, E('div', { 'class': 'lsu-muted' }, description) ])
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

		var hours = parseInt(this.data.interval, 10);
		var options = SCHEDULE.slice();

		if (!options.some(function(o) { return o.hours === hours; }))
			options.unshift({ hours: hours, text: _('Current: every %d hours').format(hours) });

		return E('div', {}, [
			sheet(),
			E('h2', {}, _('Settings')),

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
				}, options.map(function(o) {
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
					'click': ui.createHandlerFn(this, 'handleSave')
				}, _('Save'))
			]),

			fmt.callout('', _('Where settings live'),
				_('Everything is stored in /etc/config/lucisysupgrade, which is preserved by sysupgrade -k together with the rest of the configuration.'))
		]);
	},

	handleSave: function() {
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
	handleReset: null
});
