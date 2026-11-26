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

describe('cost totals at a period rollover (#1309)', () => {
	it('resets the totals of the periods that rolled over, also after exactly one week', async () => {
		const adapter = Object.create(Sourceanalytix.prototype);
		adapter.usesHistoricalCostCalculation = () => true;
		adapter.persistDynamicCostMemory = async () => {};
		adapter.log = {debug: () => {}};
		adapter.activeStates = {
			'meter.0.power': {dynamicCosts: {lastReading: 1, lastTs: 1, totals: {priceDay: 3, priceWeek: 20, priceMonth: 50, priceQuarter: 90, priceYear: 300}}},
		};
		// Saturday to Saturday: same weekday name, the day still changed
		await adapter.resetDynamicCostMemory('meter.0.power', 100, {day: true, week: true, month: false, quarter: false, year: false}, 1000);
		assert.deepEqual(adapter.activeStates['meter.0.power'].dynamicCosts, {
			lastReading: 100,
			lastTs: 1000,
			totals: {priceDay: 0, priceWeek: 0, priceMonth: 50, priceQuarter: 90, priceYear: 300},
		});
	});
});
