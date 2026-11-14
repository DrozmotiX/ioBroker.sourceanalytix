'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {
	isOldMeterReading,
	planAlignMeterReading,
	planMeterSwap,
} = require('./lib/source-actions');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
Reflect.set(Module, '_load', originalModuleLoad);

describe('align meter reading (#640)', () => {
	it('moves total, offset and start values by the same amount', () => {
		const plan = planAlignMeterReading({
			target: 48250,
			cumulative: 48213.4,
			offset: 0,
			rawReading: 48213.4,
			startValues: {start_day: 48205.6, start_week: 48100, start_month: 47900, start_quarter: 47000, start_year: 45000},
		});
		assert.equal(plan.valid, true);
		assert.equal(plan.cumulative, 48250);
		assert.ok(Math.abs(/** @type {number} */ (plan.offset) - 36.6) < 1e-9);
		assert.ok(Math.abs(/** @type {number} */ (plan.delta) - 36.6) < 1e-9);
		// Today's consumption stays 7.8
		assert.ok(Math.abs(48250 - plan.startValues.start_day - 7.8) < 1e-9);
		assert.ok(Math.abs(plan.startValues.start_year - 45036.6) < 1e-9);
	});

	it('uses the device value for the offset so the next reading continues exactly', () => {
		// Total lags behind the device after ignored jitter
		const plan = planAlignMeterReading({target: 1000, cumulative: 990, offset: 500, rawReading: 491, startValues: {}});
		assert.equal(plan.offset, 509);
		assert.deepEqual(plan.startValues, {});
	});

	it('falls back to the old offset without a device value and keeps empty start values empty', () => {
		const plan = planAlignMeterReading({target: 80, cumulative: 100, offset: 10, rawReading: null, startValues: {start_day: 90, start_week: undefined}});
		assert.equal(plan.offset, -10);
		assert.deepEqual(plan.startValues, {start_day: 70});
	});

	it('rejects invalid values', () => {
		assert.equal(planAlignMeterReading({target: null, cumulative: 1, offset: 0, rawReading: 1, startValues: {}}).valid, false);
		assert.equal(planAlignMeterReading({target: -1, cumulative: 1, offset: 0, rawReading: 1, startValues: {}}).error, 'negativeValue');
	});
});

describe('meter swap', () => {
	it('continues the total from the end reading of the old meter', () => {
		const plan = planMeterSwap({oldEnd: 5002.6, newStart: 0, cumulative: 5000});
		assert.equal(plan.valid, true);
		assert.equal(plan.cumulative, 5002.6);
		assert.equal(plan.offset, 5002.6);
		assert.ok(Math.abs(/** @type {number} */ (plan.addedConsumption) - 2.6) < 1e-9);
	});

	it('allows a new meter that starts higher (negative offset)', () => {
		assert.equal(planMeterSwap({oldEnd: 5000, newStart: 6000, cumulative: 5000}).offset, -1000);
	});

	it('rejects an end reading below the known total', () => {
		assert.equal(planMeterSwap({oldEnd: 4999, newStart: 0, cumulative: 5000}).error, 'oldEndBelowTotal');
		assert.equal(planMeterSwap({oldEnd: 5000, newStart: -1, cumulative: 5000}).error, 'invalidNewStart');
	});

	it('ignores values of the old meter until the new meter reports', () => {
		const pending = {rawAtSwap: 5000, newStart: 0};
		assert.equal(isOldMeterReading(5000, pending), true);
		assert.equal(isOldMeterReading(5001.5, pending), true);
		assert.equal(isOldMeterReading(0.2, pending), false);
		assert.equal(isOldMeterReading(5000, {rawAtSwap: null, newStart: 0}), false);
	});
});

function createHarness() {
	const adapter = Object.create(Sourceanalytix.prototype);
	const states = new Map();
	const objects = new Map();
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	adapter.namespace = 'sourceanalytix.0';
	adapter.config = {};
	adapter.activeStates = {};
	adapter.sourceObjectSnapshots = new Map();
	adapter.priceHistories = {};
	adapter.unitPriceDef = {unitConfig: {kWh: {exponent: 3, category: 'Watt_hour'}, Wh: {exponent: 0, category: 'Watt_hour'}, W: {exponent: 0, category: 'Watt'}}};
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);
	adapter.getForeignStateAsync = async id => states.get(id) || null;
	adapter.setStateAsync = async (id, state) => states.set(`${adapter.namespace}.${id}`, state);
	adapter.getStateAsync = async id => states.get(`${adapter.namespace}.${id}`) || null;
	adapter.extendForeignObject = async (id, extension) => {
		const object = objects.get(id) || {common: {custom: {}}};
		const custom = object.common.custom[adapter.namespace] || {};
		object.common.custom[adapter.namespace] = {...custom, ...extension.common.custom[adapter.namespace]};
		objects.set(id, object);
	};
	adapter.recordStatisticsValue = () => {};
	adapter.calculationHandler = async () => {};
	adapter.extendObjectIfChanged = async () => {};
	return {adapter, states, objects, logs};
}

function addSource(adapter, stateID, overrides = {}) {
	adapter.activeStates[stateID] = {
		stateDetails: {deviceName: 'house', stateUnit: 'Wh', useUnit: 'kWh', stateType: 'power', costs: true, basicRate: false, headCategory: 'consumed', financialCategory: 'costs', ...overrides},
		calcValues: {cumulativeValue: 1000, valueAtDeviceReset: 0, start_day: 990, start_week: 950, start_month: 900, start_quarter: 800, start_year: 500},
		prices: {unitPrice: 0.3, basicPrice: 0, priceSource: 'fixed'},
		pendingDeviceReset: {rawReading: 1},
	};
}

describe('instant actions on the adapter', () => {
	const stateID = 'shelly.0.meter';

	it('aligns the meter reading and moves the cost tracker with it', async () => {
		const {adapter, states, objects} = createHarness();
		addSource(adapter, stateID);
		states.set(stateID, {val: 1000000, ts: 1});
		adapter.activeStates[stateID].dynamicCosts = {version: 2, lastReading: 1000, lastTs: 1, totals: {priceDay: 3, priceWeek: 15, priceMonth: 30, priceQuarter: 60, priceYear: 150}};
		/** @type {any} */
		let persisted = null;
		adapter.persistDynamicCostMemory = async (_id, memory) => { persisted = memory; };
		const preview = await adapter.handleActionMessage('setCumulative', {source: stateID, value: '1050,5', dryRun: true});
		assert.equal(preview.cumulative, 1050.5);
		assert.equal(adapter.activeStates[stateID].calcValues.cumulativeValue, 1000, 'dry run changes nothing');

		const result = await adapter.handleActionMessage('setCumulative', {source: stateID, value: 1050.5});
		assert.equal(result.ok, true);
		const calcValues = adapter.activeStates[stateID].calcValues;
		assert.equal(calcValues.cumulativeValue, 1050.5);
		assert.equal(calcValues.valueAtDeviceReset, 50.5);
		assert.equal(calcValues.start_day, 1040.5);
		assert.equal(adapter.activeStates[stateID].pendingDeviceReset, null);
		assert.equal(persisted && persisted.lastReading, 1050.5);
		assert.equal(states.get('sourceanalytix.0.house.cumulativeReading').val, 1050.5);
		assert.equal(objects.get(stateID).common.custom['sourceanalytix.0'].valueAtDeviceReset, 50.5);
		assert.equal(objects.get(stateID).common.custom['sourceanalytix.0'].start_year, 550.5);
	});

	it('rejects actions for unknown sources', async () => {
		const {adapter} = createHarness();
		const result = await adapter.handleActionMessage('setCumulative', {source: 'x.0.y', value: 1});
		assert.equal(result.error, 'sourceNotActive');
	});

	it('swaps the meter and waits for the first value of the new meter', async () => {
		const {adapter, states, objects} = createHarness();
		addSource(adapter, stateID);
		states.set(stateID, {val: 1000000, ts: 1});
		const result = await adapter.handleActionMessage('meterSwap', {source: stateID, oldEnd: 1002, newStart: 0, date: '2026-11-13'});
		assert.equal(result.ok, true);
		assert.equal(result.addedConsumption, 2);
		const activeState = adapter.activeStates[stateID];
		assert.equal(activeState.calcValues.valueAtDeviceReset, 1002);
		assert.deepEqual(activeState.pendingMeterSwap, {rawAtSwap: 1000, newStart: 0, date: '2026-11-13'});
		assert.equal(objects.get(stateID).common.custom['sourceanalytix.0'].pendingMeterSwap.rawAtSwap, 1000);
		assert.equal(activeState.calcValues.start_day, 990, 'start values stay, the added consumption belongs to today');
	});

	it('applies the swap at once if the device already shows the new meter', async () => {
		const {adapter, states} = createHarness();
		addSource(adapter, stateID);
		states.set(stateID, {val: 300, ts: 1});
		let calculated = false;
		adapter.calculationHandler = async () => { calculated = true; };
		await adapter.handleActionMessage('meterSwap', {source: stateID, oldEnd: 1000, newStart: 0});
		assert.equal(adapter.activeStates[stateID].pendingMeterSwap, null);
		assert.equal(calculated, true);
	});

	it('refuses a meter swap for power sources', async () => {
		const {adapter} = createHarness();
		addSource(adapter, stateID, {stateUnit: 'W'});
		const result = await adapter.handleActionMessage('meterSwap', {source: stateID, oldEnd: 1000});
		assert.equal(result.error, 'powerSource');
	});
});
