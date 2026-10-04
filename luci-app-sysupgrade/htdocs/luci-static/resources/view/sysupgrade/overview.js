'use strict';
'require view';
'require rpc';
'require ui';
'require sysupgrade.format as fmt';

var callStatus = rpc.declare({ object: 'lucisysupgrade', method: 'status' });
var callCheck = rpc.declare({ object: 'lucisysupgrade', method: 'check', params: [ 'source', 'channel' ] });

function sheet() {
	return E('link', { 'rel': 'stylesheet', 'href': L.resource('sysupgrade/sysupgrade.css') });
}

function replace(node, children) {
	while (node.firstChild)
		node.removeChild(node.firstChild);
	children.forEach(function(c) {
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
		this.resultNode = E('div', {}, E('p', { 'class': 'lsu-muted' }, _('No check has been run yet.')));

		var view = E('div', {}, [
			sheet(),
			E('h2', {}, _('System Update')),
			E('p', { 'class': 'lsu-muted' },
				_('Read-only detection: the local build id is compared against the remote release metadata. This version does not download or flash anything.')),

			E('div', { 'class': 'lsu-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleCheck')
				}, _('Check for updates')),
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/system/sysupgrade/sources') }, _('Sources')),
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/system/sysupgrade/settings') }, _('Settings'))
			]),

			E('h3', {}, _('Local system')),
			E('div', { 'class': 'lsu-grid' }, [
				fmt.stat(_('Build id'), loc.build_id),
				fmt.stat(_('Source date'), (loc.build_date_iso || '').replace(' UTC', ''), 'OPENWRT_BUILD_DATE'),
				fmt.stat(_('Board'), loc.board_name, loc.board_path),
				fmt.stat(_('Distribution'), (loc.distribution || '') + ' ' + (loc.version || ''))
			]),

			E('h3', {}, _('Result')),
			this.resultNode
		]);

		if (status.last && status.last.verdict)
			replace(this.resultNode, this.buildResult(status.last, true));

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

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
