'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('../../main');
Reflect.set(Module, '_load', originalModuleLoad);

function createAdapter() {
	const adapter = Object.create(Sourceanalytix.prototype);
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	return {adapter, logs};
}

describe('source and start values', () => {
	it('parses source values sent as strings with comma or dot', () => {
		const {adapter} = createAdapter();
		assert.equal(adapter.parsePriceValue('12,5'), 12.5);
		assert.equal(adapter.parsePriceValue('.14'), 0.14);
		assert.equal(adapter.parsePriceValue(' 1500 '), 1500);
		assert.equal(adapter.parsePriceValue('abc'), null);
	});

	it('parses configured start values and keeps empty ones empty', () => {
		const {adapter, logs} = createAdapter();
		assert.equal(adapter.parseStartValue('src', 'start_day', '12,5'), 12.5);
		assert.equal(adapter.parseStartValue('src', 'start_day', 100), 100);
		assert.equal(adapter.parseStartValue('src', 'start_day', 0), 0);
		assert.equal(adapter.parseStartValue('src', 'start_day', ''), undefined);
		assert.equal(adapter.parseStartValue('src', 'start_day', undefined), undefined);
		assert.equal(logs.warn.length, 0);
	});

	it('warns about and ignores start values that are not numeric', () => {
		const {adapter, logs} = createAdapter();
		assert.equal(adapter.parseStartValue('src', 'start_week', 'n/a'), undefined);
		assert.equal(logs.warn.length, 1);
		assert.match(logs.warn[0], /start_week/);
	});
});
