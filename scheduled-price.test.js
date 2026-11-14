'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
Reflect.set(Module, '_load', originalModuleLoad);

const switchDate = Date.UTC(2027, 0, 1);

function createAdapter(pricesConfig) {
	const adapter = Object.create(Sourceanalytix.prototype);
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	const states = new Map();
	adapter.namespace = 'sourceanalytix.0';
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	adapter.unitPriceDef = {unitConfig: {}, pricesConfig};
	adapter.activeStates = {
		'meter.0.energy': {stateDetails: {stateType: 'Power'}, prices: {unitPrice: 0.30}},
	};
	adapter.priceHistories = {
		Power: [{ts: 0, price: 0.30}, {ts: switchDate, price: 0.25}],
	};
	adapter.loadPriceHistory = async priceDefinition => adapter.priceHistories[priceDefinition] || [];
	adapter.setStateChangedAsync = async (id, state) => states.set(id, state.val);
	adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);
	return {adapter, logs, states};
}

describe('scheduled price switch', () => {
	it('keeps the current price before the valid from date', async () => {
		const {adapter, states} = createAdapter({Power: {cat: 'Power', priceSource: 'static', uPpU: 0.30, basePrice: 0.30}});
		await adapter.refreshScheduledPrices(switchDate - 1);
		assert.equal(adapter.unitPriceDef.pricesConfig.Power.uPpU, 0.30);
		assert.equal(states.size, 0);
	});

	it('switches currentPrice and the source price once the valid from date is reached', async () => {
		const {adapter, logs, states} = createAdapter({Power: {cat: 'Power', priceSource: 'static', uPpU: 0.30, basePrice: 0.30}});
		await adapter.refreshScheduledPrices(switchDate + 1);
		assert.equal(adapter.unitPriceDef.pricesConfig.Power.uPpU, 0.25);
		assert.equal(adapter.activeStates['meter.0.energy'].prices.unitPrice, 0.25);
		assert.deepEqual([...states.values()], [0.25]);
		assert.equal(logs.info.length, 1);
	});

	it('leaves state and selector driven prices alone', async () => {
		const {adapter, states} = createAdapter({Power: {cat: 'Power', priceSource: 'state', uPpU: 0.30, basePrice: 0.30}});
		await adapter.refreshScheduledPrices(switchDate + 1);
		assert.equal(adapter.unitPriceDef.pricesConfig.Power.uPpU, 0.30);
		assert.equal(states.size, 0);
	});
});
