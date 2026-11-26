'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const jsonConfig = require('../../admin/jsonConfig.json');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('../../main');
Reflect.set(Module, '_load', originalModuleLoad);

const day = Date.UTC(2026, 0, 1);

function createAdapter() {
	const adapter = Object.create(Sourceanalytix.prototype);
	const warnings = [];
	adapter.log = {warn: message => warnings.push(message)};
	return {adapter, warnings};
}

describe('price changed without a new "valid from" (#1293)', () => {
	it('warns only when the price changed and the date stayed the same', () => {
		const {adapter, warnings} = createAdapter();
		adapter.warnPriceChangedWithoutNewDate('Strom', 'price', 0.3, 0.35, day, day);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /changed from 0.3 to 0.35/);

		adapter.warnPriceChangedWithoutNewDate('Strom', 'price', 0.3, 0.35, day, day + 86_400_000);
		adapter.warnPriceChangedWithoutNewDate('Strom', 'price', 0.3, 0.3, day, day);
		adapter.warnPriceChangedWithoutNewDate('Strom', 'price', null, 0.35, null, day);
		adapter.warnPriceChangedWithoutNewDate('Strom', 'price', 0.3, 0.35, day, null);
		assert.equal(warnings.length, 1);
	});

	it('marks the price fields in the price definitions table', async () => {
		const items = jsonConfig.items._prices.items.pricesDefinition.items;
		const validated = items.filter(item => item.validator && item.attr !== 'cat');
		assert.deepEqual(validated.map(item => item.attr).sort(), ['uPpM', 'uPpU', 'validFrom']);
		const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
		const validate = new AsyncFunction('data', 'originalData', validated[0].validator);
		const original = {pricesDefinition: [{cat: 'Strom', uPpU: 0.3, uPpM: 10, validFrom: '2026-01-01'}]};
		assert.equal(await validate({cat: 'Strom', uPpU: 0.35, uPpM: 10, validFrom: '2026-01-01'}, original), false);
		assert.equal(await validate({cat: 'Strom', uPpU: 0.35, uPpM: 10, validFrom: '2026-07-01'}, original), true);
		assert.equal(await validate({cat: 'Strom', uPpU: 0.3, uPpM: 10, validFrom: '2026-01-01'}, original), true);
		assert.equal(await validate({cat: 'Gas', uPpU: 0.1, uPpM: 0, validFrom: '2026-01-01'}, original), true);
		assert.equal(await validate({cat: 'Strom', uPpU: 0.35, uPpM: 10, validFrom: ''}, {pricesDefinition: [{cat: 'Strom', uPpU: 0.3, uPpM: 10}]}), true);
	});
});

describe('one "valid from" for unit and basic price (#1298)', () => {
	function createPriceAdapter(states) {
		const adapter = Object.create(Sourceanalytix.prototype);
		adapter.log = {warn: () => {}, info: () => {}, debug: () => {}};
		adapter.basicPriceHistories = {};
		adapter.extendObjectAsync = async () => {};
		adapter.getStateAsync = async id => states.has(id) ? {val: states.get(id)} : null;
		adapter.setStateChangedAsync = async (id, state) => states.set(id, state.val);
		adapter.loadBasicPriceHistory = async () => [{ts: day, price: 10}];
		adapter.persistBasicPriceHistory = async () => {};
		adapter.storeBasicPriceHistory = async () => {};
		return adapter;
	}

	it('keeps the date of the unchanged basic price when only the unit price changes', async () => {
		const states = new Map();
		const adapter = createPriceAdapter(states);
		states.set(adapter.getConfiguredPriceStateName('Strom'), 0.3);
		states.set(adapter.getConfiguredBasicPriceStateName('Strom'), 10);
		const validityState = adapter.getConfiguredBasicPriceValidityStateName('Strom');
		states.set(validityState, day);

		assert.equal(await adapter.hasConfiguredPriceChanged('Strom', 0.35, 10), true);
		assert.equal(await adapter.hasConfiguredPriceChanged('Strom', 0.3, 10), false);
		assert.equal(await adapter.hasConfiguredPriceChanged('Strom', null, 10), false);

		await adapter.storeConfiguredBasicPrice('Strom', 10, '2026-07-01', false);
		assert.equal(states.get(validityState), day);
		assert.equal(adapter.basicPriceHistories.Strom, undefined);

		// Only the date changed: the entry moves as before
		await adapter.storeConfiguredBasicPrice('Strom', 10, '2026-07-01', true);
		assert.notEqual(states.get(validityState), day);
		assert.equal(adapter.basicPriceHistories.Strom.length, 1);
	});
});

describe('price definition categories (#1310)', () => {
	it('must not be empty or used twice', async () => {
		const items = jsonConfig.items._prices.items.pricesDefinition.items;
		const cat = items.find(item => item.attr === 'cat');
		if (!cat || !cat.validator) throw new Error('no validator for cat');
		const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
		const validate = new AsyncFunction('data', 'originalData', 'globalData', cat.validator);
		const globalData = {pricesDefinition: [{cat: 'Strom'}, {cat: 'Gas'}, {cat: 'Wasser kalt'}, {cat: 'Wasser_kalt'}]};
		assert.equal(await validate({cat: 'Strom'}, {}, globalData), true);
		assert.equal(await validate({cat: ' '}, {}, globalData), false);
		assert.equal(await validate({cat: 'Wasser kalt'}, {}, globalData), false, 'same price history state after sanitising');
		// Without the table data the field is only checked for content
		const withoutGlobal = new AsyncFunction('data', cat.validator);
		assert.equal(await withoutGlobal({cat: 'Strom'}), true);
	});
});
