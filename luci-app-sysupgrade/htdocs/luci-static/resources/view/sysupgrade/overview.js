'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require sysupgrade.format as fmt';

var callStatus = rpc.declare({ object: 'lucisysupgrade', method: 'status' });
var callCheck = rpc.declare({ object: 'lucisysupgrade', method: 'check', params: [ 'source', 'channel' ] });
var callDownload = rpc.declare({ object: 'lucisysupgrade', method: 'download', params: [ 'source', 'channel' ] });
var callDownloadStatus = rpc.declare({ object: 'lucisysupgrade', method: 'download_status' });
var callCancel = rpc.declare({ object: 'lucisysupgrade', method: 'cancel' });
var callCleanup = rpc.declare({ object: 'lucisysupgrade', method: 'cleanup' });

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

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(status) {
		var conf = status.config || {};
		var loc = status.local || {};

		this.activeSource = conf.active_source || '';
		this.download = status.download || { state: 'idle' };
		this.resultNode = E('div', {}, E('p', { 'class': 'lsu-muted' }, _('No check has been run yet.')));

		var view = E('div', {}, [
			sheet(),
			E('h2', {}, _('System Update')),
			E('p', { 'class': 'lsu-muted' },
				_('Read-only detection plus image download. Nothing is flashed: this version stops after verifying the sha256.')),

			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleCheck')
				}, _('Check for updates'))
			]),

			E('h3', {}, _('Local system')),
			E('div', { 'class': 'lsu-grid' }, [
				fmt.stat(_('Build id'), loc.build_id),
				fmt.stat(_('Source date'), (loc.build_date_iso || '').replace(' UTC', ''), 'OPENWRT_BUILD_DATE'),
				fmt.stat(_('Board'), loc.board_name, loc.board_path),
				fmt.stat(_('Distribution'), (loc.distribution || '') + ' ' + (loc.version || ''))
			]),

			this.downloadNode = E('div', {}, this.buildDownload()),

			E('h3', {}, _('Result')),
			this.resultNode
		]);

		if (status.last && status.last.verdict)
			replace(this.resultNode, this.buildResult(status.last, true));

		if (this.download.state === 'running')
			this.startPolling();

		return view;
	},

	buildResult: function(res, cached) {
		var vs = res.verdict || {};
		var rem = res.remote || {};
		var loc = res.local || {};
		var nodes = [];

		nodes.push(E('div', { 'class': 'lsu-toolbar' }, [
			fmt.badge(vs.state, vs.label),
			E('span', { 'class': 'lsu-muted' }, '%s %s'.format(
				cached ? _('cached result from') : _('checked at'),
				new Date((res.ts || 0) * 1000).toISOString().replace('T', ' ').substr(0, 16) + ' UTC'))
		]));

		nodes.push(E('div', { 'class': 'lsu-grid' }, [
			fmt.stat(_('Local build id'), loc.build_id),
			fmt.stat(_('Local source date'), (loc.build_date_iso || '').replace(' UTC', '')),
			fmt.stat(_('Remote build id'), rem.version_code || '-'),
			fmt.stat(_('Remote source date'), (rem.source_date_iso || '').replace(' UTC', ''),
				rem.channel ? _('channel') + ': ' + rem.channel : '')
		]));

		if (!res.ok)
			nodes.push(fmt.callout('danger', _('Detection failed'), rem.error || res.error || _('Unknown error')));

		nodes.push(fmt.kvTable([ _('Item'), _('Local'), _('Remote') ], [
			[ _('Build id'), loc.build_id, rem.version_code ],
			[ _('Source date'), loc.build_date_iso, rem.source_date_iso ],
			[ _('Channel'), loc.version, rem.channel ? (rem.channel + ' (' + (rem.channel_origin || '') + ')') : '' ],
			[ _('Source'), '-', (rem.label || '') + ' <' + (rem.url || '') + '>' ],
			[ _('Profile'), loc.board_name, rem.profile_name ]
		]));

		nodes.push(fmt.callout(
			vs.state === 'downgrade' ? 'warning' : (vs.state === 'update' ? 'success' : ''),
			_('Verdict basis'), vs.evidence || '-'));

		if (rem.image) {
			nodes.push(E('h3', {}, _('Candidate image')));
			nodes.push(fmt.kvTable([ _('Item'), _('Value') ], [
				[ _('File'), rem.image.name ],
				[ _('Size'), fmt.fmtSize(rem.image.size) + (rem.image_limit ? ' / %s'.format(fmt.fmtSize(rem.image_limit)) : '') ],
				[ 'sha256', rem.image.sha256 ]
			]));
		}

		if ((rem.images || []).length > 1) {
			nodes.push(E('details', { 'class': 'lsu-images' }, [
				E('summary', {}, _('All images (%d)').format(rem.images.length)),
				fmt.callout('warning', _('Do not flash these by hand'),
					_('Only the squashfs sysupgrade image is offered as an upgrade candidate. Preloader, BL31/U-Boot, GPT and sdcard images rewrite the boot chain or the partition table; a wrong pick bricks the device instead of failing the upgrade.')),
				fmt.kvTable([ _('Type'), _('Filesystem'), _('File'), _('Size') ], rem.images.map(function(i) {
					return [ i.type || '-', i.filesystem || '-', i.name || '-', fmt.fmtSize(i.size) ];
				}))
			]));
		}

		(rem.warnings || []).forEach(function(w) {
			nodes.push(fmt.callout('warning', _('Warning'), w));
		});

		return nodes;
	},

	buildDownload: function() {
		var d = this.download || { state: 'idle' };
		var nodes = [ E('h3', {}, _('Image download')) ];

		switch (d.state) {
		case 'running':
			nodes.push(E('div', { 'class': 'lsu-bar' }, E('span', { 'style': 'width:' + (d.percent || 0) + '%' })));
			nodes.push(E('div', { 'class': 'lsu-muted' },
				'%s / %s（%d%%）%s'.format(fmt.fmtSize(d.received), fmt.fmtSize(d.size), d.percent || 0,
					d.resumed_from ? _('resumed') : '')));
			nodes.push(fmt.callout('', _('Downloading…'),
				_('The file goes to /tmp (RAM). Flashing is not implemented yet, so nothing else happens when it finishes.')));
			nodes.push(E('div', { 'class': 'lsu-toolbar' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': ui.createHandlerFn(this, 'handleCancel') }, _('Cancel'))
			]));
			break;

		case 'verified':
			nodes.push(fmt.callout('success', _('Downloaded and verified'),
				_('The sha256 matches the one published by the source. This version does not flash anything.')));
			nodes.push(fmt.kvTable([ _('Item'), _('Value') ], [
				[ _('File'), d.file ],
				[ _('Size'), fmt.fmtSize(d.size) ],
				[ 'sha256', d.sha256 ]
			]));
			nodes.push(E('div', { 'class': 'lsu-toolbar' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': ui.createHandlerFn(this, 'handleCleanup') }, _('Delete file'))
			]));
			break;

		case 'failed':
			nodes.push(fmt.callout('danger', _('Download failed'), d.error || _('Unknown error')));
			nodes.push(E('div', { 'class': 'lsu-toolbar' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleDownload') }, _('Retry download')),
				E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': ui.createHandlerFn(this, 'handleCleanup') }, _('Delete file'))
			]));
			break;

		case 'cancelled':
			nodes.push(fmt.callout('warning', _('Download cancelled'),
				_('The partial file is kept, so a retry resumes instead of starting over (the ETag is compared first).')));
			nodes.push(E('div', { 'class': 'lsu-toolbar' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleDownload') }, _('Resume download')),
				E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': ui.createHandlerFn(this, 'handleCleanup') }, _('Delete file'))
			]));
			break;

		default:
			nodes.push(E('div', { 'class': 'lsu-muted' },
				_('Downloads the candidate image to /tmp and verifies its sha256. Nothing is flashed.')));
			nodes.push(E('div', { 'class': 'lsu-toolbar' }, [
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleDownload') }, _('Download image'))
			]));
		}

		return nodes;
	},

	renderDownload: function() {
		if (this.downloadNode)
			replace(this.downloadNode, this.buildDownload());
	},

	startPolling: function() {
		if (this.pollFn)
			return;

		this.pollFn = L.bind(this.pollDownload, this);
		poll.add(this.pollFn);
	},

	stopPolling: function() {
		if (!this.pollFn)
			return;

		poll.remove(this.pollFn);
		this.pollFn = null;
	},

	pollDownload: function() {
		var self = this;

		return callDownloadStatus().then(function(d) {
			self.download = d || { state: 'idle' };
			self.renderDownload();
			if (self.download.state !== 'running')
				self.stopPolling();
		});
	},

	handleCheck: function(ev) {
		var self = this;
		var btn = ev.currentTarget;

		btn.disabled = true;
		btn.classList.add('spinning');

		return callCheck(this.activeSource, '').then(function(res) {
			replace(self.resultNode, self.buildResult(res, false));
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Check failed: ') + (err.message || err)), 'error');
		}).finally(function() {
			btn.disabled = false;
			btn.classList.remove('spinning');
		});
	},

	handleDownload: function() {
		var self = this;

		return callDownload(this.activeSource, '').then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Download failed'));

			self.download = res;
			self.renderDownload();
			if (res.state === 'running')
				self.startPolling();
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Download failed: ') + (err.message || err)), 'error');
		});
	},

	handleCancel: function() {
		var self = this;

		return callCancel().then(function(res) {
			if (!res || res.ok === false)
				throw new Error((res && res.error) || _('Cancel failed'));

			return self.pollDownload();
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Cancel failed: ') + (err.message || err)), 'error');
		});
	},

	handleCleanup: function() {
		var self = this;

		return callCleanup().then(function() {
			self.download = { state: 'idle' };
			self.renderDownload();
			ui.addNotification(null, E('p', {}, _('Downloaded file deleted.')), 'info');
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('Delete failed: ') + (err.message || err)), 'error');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
