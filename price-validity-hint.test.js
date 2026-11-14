'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const jsonConfig = require('./admin/jsonConfig.json');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
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
		const validated = items.filter(item => item.validator);
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
