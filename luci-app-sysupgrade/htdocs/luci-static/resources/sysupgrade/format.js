'use strict';

// 视图公共格式化：体积、状态色、徽标、统计块、对照表。

var TONES = {
	same: 'success',
	update: 'warning',
	downgrade: 'danger',
	rebuild: 'notice',
	incomparable: 'muted'
};

function fmtSize(bytes) {
	var n = parseInt(bytes || 0, 10);

	if (!n)
		return '-';
	if (n >= 1048576)
		return (n / 1048576).toFixed(1) + ' MB';

	return (n / 1024).toFixed(1) + ' KB';
}

function fmtSha(sha) {
	return sha ? String(sha).substr(0, 12) : '-';
}

function stateTone(state) {
	return TONES[state] || 'muted';
}

function badge(state, label) {
	return E('span', { 'class': 'lsu-badge ' + stateTone(state) }, label);
}

function stat(label, value, sub) {
	var items = [
		E('div', { 'class': 'lsu-label' }, label),
		E('div', { 'class': 'lsu-value' }, (value === undefined || value === null || value === '') ? '-' : value)
	];

	if (sub)
		items.push(E('div', { 'class': 'lsu-sub' }, sub));

	return E('div', { 'class': 'lsu-stat' }, items);
}

function callout(tone, title, content) {
	return E('div', { 'class': 'lsu-callout ' + (tone || '') }, [
		title ? E('div', { 'class': 'lsu-callout-title' }, title) : '',
		E('div', {}, content)
	]);
}

function kvTable(columns, rows) {
	return E('table', { 'class': 'table' }, [
		E('thead', {}, E('tr', {}, columns.map(function(c) {
			return E('th', {}, c);
		}))),
		E('tbody', {}, rows.map(function(r) {
			return E('tr', {}, r.map(function(c, i) {
				return E('td', { 'class': (i > 0) ? 'lsu-mono' : '' }, (c === '' || c === null) ? '-' : c);
			}));
		}))
	]);
}

return {
	TONES: TONES,
	fmtSize: fmtSize,
	fmtSha: fmtSha,
	stateTone: stateTone,
	badge: badge,
	stat: stat,
	callout: callout,
	kvTable: kvTable
};
