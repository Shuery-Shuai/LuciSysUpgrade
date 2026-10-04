'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callLogs = rpc.declare({ object: 'lucisysupgrade', method: 'logs' });
var callClear = rpc.declare({ object: 'lucisysupgrade', method: 'logs_clear' });

var LEVEL_CLASS = { info: '', warn: 'warning', error: 'danger' };

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

function stamp(ts) {
	if (!ts)
		return '-';

	return new Date(ts * 1000).toISOString().replace('T', ' ').substr(0, 19) + ' UTC';
}

return view.extend({
	load: function() {
		return callLogs();
	},

	render: function(data) {
		this.data = data || { events: [], download_log: '' };
		this.logNode = E('div', {}, this.buildLog());

		return E('div', {}, [
			sheet(),
			E('h2', {}, _('Logs')),
			E('p', { 'class': 'lsu-muted' },
				_('Detection, source and download events, newest first. Stored in RAM (/tmp), so a reboot clears them.')),

			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleRefresh')
				}, _('Refresh')),
				E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'click': ui.createHandlerFn(this, 'handleClear')
				}, _('Clear log'))
			]),

			this.logNode
		]);
	},

	buildLog: function() {
		var events = (this.data && this.data.events) || [];
		var nodes = [];

		if (!events.length) {
			nodes.push(E('p', { 'class': 'lsu-muted' }, _('No events yet.')));
		}
		else {
			nodes.push(fmt.kvTable([
				{ text: _('Time'), class: 'lsu-col-time' },
				{ text: _('Event'), class: 'lsu-col-layout' },
				_('Detail')
			], events.map(function(e) {
				return [ stamp(e.ts), (e.event || '-') + ' · ' + (e.level || '-'), e.message || '' ];
			})));
		}

		var raw = (this.data && this.data.download_log) || '';
		var files = (this.data && this.data.files) || {};

		nodes.push(E('details', { 'class': 'lsu-images' }, [
			E('summary', {}, _('Raw downloader output (tail)')),
			raw ? E('pre', { 'class': 'lsu-mono', 'style': 'max-height:22rem;overflow:auto' }, raw)
				: E('p', { 'class': 'lsu-muted' }, _('No downloader output yet.'))
		]));

		if (files.events)
			nodes.push(E('p', { 'class': 'lsu-muted' }, _('Files: %s , %s').format(files.events, files.download_log || '-')));

		return nodes;
	},

	handleRefresh: function() {
		var self = this;

		return callLogs().then(function(data) {
			self.data = data || { events: [], download_log: '' };
			replace(self.logNode, self.buildLog());
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Refresh failed: ') + (err.message || err)), 'error');
		});
	},

	handleClear: function() {
		var self = this;

		return callClear().then(function() {
			return self.handleRefresh();
		}).then(function() {
			ui.addNotification(null, E('p', {}, _('Log cleared.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Clear failed: ') + (err.message || err)), 'error');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
