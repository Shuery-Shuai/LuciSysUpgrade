'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({ object: 'lucisysupgrade', method: 'status' });
var callCheck = rpc.declare({ object: 'lucisysupgrade', method: 'check', params: [ 'source', 'channel' ] });

var STATE_CLASS = {
	same: 'label success',
	update: 'label warning',
	downgrade: 'label danger',
	rebuild: 'label notice',
	incomparable: 'label'
};

function row(title, value) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, title),
		E('div', { 'class': 'cbi-value-field' }, value || '-')
	]);
}

function fmtSize(bytes) {
	var n = parseInt(bytes || 0, 10);
	if (!n)
		return '-';
	return (n >= 1048576) ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(1) + ' KB';
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(status) {
		var conf = status.config || {};
		var loc = status.local || {};
		var active = (conf.sources || []).filter(function(s) { return s.name === conf.active_source; })[0];

		this.activeSource = conf.active_source || '';
		this.resultNode = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('检测结果')),
			E('em', {}, _('尚未检测。'))
		]);

		var view = E('div', {}, [
			E('h2', {}, _('系统更新检测')),
			E('div', { 'class': 'cbi-map-descr' },
				_('只读检测：以本机构建标识（BUILD_ID）与远端发布元数据（version.buildinfo / profiles.json）比对，判断是否存在更新。本版本不会下载或刷写任何东西。')),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('本机')),
				row(_('主机'), loc.hostname),
				row(_('系统'), (loc.distribution || '') + ' ' + (loc.version || '')),
				row(_('板型'), (loc.board_name || '') + ' [' + (loc.target || '') + ']'),
				row(_('构建标识'), loc.build_id),
				row(_('源码构建时间'), loc.build_date_iso)
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('激活源')),
				row(_('名称'), active ? active.label : _('（无）')),
				row(_('地址'), active ? (active.url + (active.system ? ' / ' + active.system : '')) : '-'),
				row(_('布局'), active ? active.layout : '-'),
				row(_('无人值守'), _('档位 %d').format(conf.unattended || 0))
			]),

			this.resultNode,

			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleCheck')
				}, _('检查更新'))
			])
		]);

		if (status.last && status.last.verdict)
			this.renderResult(status.last, true);

		return view;
	},

	renderResult: function(res, cached) {
		var vs = res.verdict || {};
		var rem = res.remote || {};
		var loc = res.local || {};

		var badge = E('span', { 'class': STATE_CLASS[vs.state] || 'label' }, vs.label || _('未知'));

		var children = [
			E('h3', {}, [ _('检测结果'), ' ', badge, cached ? E('small', {}, ' ' + _('（缓存）')) : '' ]),
			row(_('依据'), vs.evidence),
			row(_('本机构建'), (loc.build_id || '') + ' @ ' + (loc.build_date_iso || '')),
			row(_('远端构建'), (rem.version_code || '') + ' @ ' + (rem.source_date_iso || '')),
			row(_('通道'), (rem.channel || '') + (rem.channel_origin ? ' (' + rem.channel_origin + ')' : '')),
			row(_('源'), (rem.label || '') + ' <' + (rem.url || '') + '>')
		];

		if (rem.image)
			children.push(row(_('镜像'), (rem.image.name || '') + '  (' + fmtSize(rem.image.size) + ')'));

		(rem.warnings || []).forEach(function(w) {
			children.push(row(_('提示'), w));
		});

		if (!res.ok)
			children.push(row(_('错误'), rem.error || res.error || _('探测失败')));

		this.resultNode.innerHTML = '';
		children.forEach(function(c) { this.resultNode.appendChild(c); }, this);
	},

	handleCheck: function(ev) {
		var self = this;
		var btn = ev.currentTarget;
		btn.disabled = true;
		btn.classList.add('spinning');

		return callCheck(this.activeSource, '').then(function(res) {
			self.renderResult(res, false);
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, _('检测失败：') + (err.message || err)), 'error');
		}).finally(function() {
			btn.disabled = false;
			btn.classList.remove('spinning');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
