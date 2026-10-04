'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callStatus = rpc.declare({ object: 'lucisysupgrade', method: 'status' });
var callSetOptions = rpc.declare({ object: 'lucisysupgrade', method: 'set_options', params: [ 'unattended', 'interval', 'webhook' ] });

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

		this.data = {
			unattended: '' + (conf.unattended || 0),
			interval: '' + (conf.interval === undefined ? 24 : conf.interval),
			webhook: conf.webhook || ''
		};

		var self = this;

		return E('div', {}, [
			sheet(),
			E('h2', {}, _('Settings')),

			field(_('Unattended level'),
				_('0: detect and notify only. 1: also download automatically. 2: also flash automatically (not implemented yet, M3).'),
				E('select', {
					'class': 'cbi-input-select',
					'change': function(ev) { self.data.unattended = ev.target.value; }
				}, [ '0', '1', '2' ].map(function(v) {
					return E('option', { 'value': v, 'selected': (v === self.data.unattended) ? 'selected' : null },
						v + ' — ' + [ _('detect and notify'), _('download automatically'), _('flash automatically') ][parseInt(v, 10)]);
				}))),

			field(_('Check interval (hours)'),
				_('0 disables the scheduled check. The schedule is written into /etc/crontabs/root inside a marked block (M4); existing entries are never touched.'),
				E('input', {
					'class': 'cbi-input-text',
					'type': 'number',
					'min': '0',
					'max': '168',
					'value': self.data.interval,
					'input': function(ev) { self.data.interval = ev.target.value; }
				})),

			field(_('Webhook URL'),
				_('POST JSON on update events (M3). Leave empty to disable.'),
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
