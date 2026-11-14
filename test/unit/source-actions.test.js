'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {
	calculatePeriodCosts,
	getBasicPriceCharges,
	getIsoWeekStart,
	isOldMeterReading,
	listRecalcPeriods,
	planAlignMeterReading,
	planMeterSwap,
	summarizeOutputTree,
} = require('../../lib/source-actions');
const {calculateHistoricalBasicPriceTotals} = require('../../lib/calculation');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('../../main');
Reflect.set(Module, '_load', originalModuleLoad);

const weekdays = ['07_Sunday', '01_Monday', '02_Tuesday', '03_Wednesday', '04_Thursday', '05_Friday', '06_Saturday'];
const months = ['01_January', '02_February', '03_March', '04_April', '05_May', '06_June', '07_July', '08_August', '09_September', '10_October', '11_November', '12_December'];

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

describe('recalculate costs (#947)', () => {
	const config = {
		currentYearDays: true, currentYearWeek: true, currentYearMonth: true, currentYearQuarter: true,
		currentYearPrevious: true, store_weeks: true, store_months: true, store_quarters: true,
	};

	it('finds the ISO week start', () => {
		assert.equal(getIsoWeekStart(2026, 1).getTime(), new Date(2025, 11, 29).getTime());
		assert.equal(getIsoWeekStart(2026, 46).getTime(), new Date(2026, 10, 9).getTime());
	});

	it('lists only periods that end after the date', () => {
		const now = new Date(2026, 10, 14, 12).getTime(); // Saturday 14.11.2026
		const from = new Date(2026, 10, 10).getTime(); // Tuesday
		const periods = listRecalcPeriods({from, now, config, weekdays, months});
		const paths = periods.map(period => period.path);
		assert.ok(paths.includes('currentYear.{cat}.01_currentDay'));
		assert.ok(paths.includes('currentYear.{cat}.01_previousDay'));
		assert.ok(paths.includes('currentYear.{cat}.currentWeek.02_Tuesday'));
		assert.ok(!paths.includes('currentYear.{cat}.currentWeek.07_Sunday'), 'Sunday of the running week has not started');
		assert.ok(!paths.includes('currentYear.{cat}.previousWeek.01_Monday'));
		assert.ok(!paths.includes('currentYear.{cat}.02_previousWeek'));
		assert.ok(paths.includes('currentYear.{cat}.weeks.46'));
		assert.ok(!paths.includes('currentYear.{cat}.weeks.45'));
		assert.ok(paths.includes('2026.{cat}.months.11_November'));
		assert.ok(!paths.includes('2026.{cat}.months.12_December'));
		assert.ok(paths.includes('2026.{cat}Cumulative'));
		assert.ok(!paths.includes('2025.{cat}Cumulative'));
		for (const period of periods) assert.ok(period.end <= now && period.end > from);
	});

	it('does not list the Monday when the date is later', () => {
		const now = new Date(2026, 10, 14, 12).getTime();
		const from = new Date(2026, 10, 10).getTime();
		const monday = listRecalcPeriods({from, now, config, weekdays, months}).find(period => period.path === 'currentYear.{cat}.currentWeek.01_Monday');
		assert.equal(monday, undefined);
	});

	it('lists archive years back to the date', () => {
		const now = new Date(2026, 1, 1, 12).getTime();
		const from = new Date(2025, 5, 15).getTime();
		const paths = listRecalcPeriods({from, now, config: {store_months: true}, weekdays, months}).map(period => period.path);
		assert.ok(paths.includes('2025.{cat}.months.06_June'));
		assert.ok(!paths.includes('2025.{cat}.months.05_May'));
		assert.ok(paths.includes('2025.{cat}Cumulative'));
		assert.ok(paths.includes('2026.{cat}.months.01_January'));
	});

	it('prices the consumption with the price history over the period', () => {
		const start = new Date(2026, 10, 1).getTime();
		const end = new Date(2026, 10, 11).getTime();
		const change = new Date(2026, 10, 6).getTime();
		const costs = calculatePeriodCosts({
			consumption: 100,
			start,
			end,
			priceHistory: [{ts: 1, price: 0.3}, {ts: change, price: 0.4}],
			fallbackPrice: 0.5,
		});
		assert.ok(costs);
		assert.ok(Math.abs(costs.total - 35) < 1e-9);
	});

	it('uses the current price if the history is empty', () => {
		const costs = calculatePeriodCosts({consumption: 10, start: 1000, end: 2000, priceHistory: [], fallbackPrice: '0,32'});
		assert.ok(costs);
		assert.ok(Math.abs(costs.total - 3.2) < 1e-9);
	});

	it('adds basic-price charges inside the period like the running calculation', () => {
		const history = [{ts: new Date(2026, 0, 15).getTime(), price: 10}, {ts: new Date(2026, 5, 1).getTime(), price: 12}];
		const now = new Date(2026, 6, 20, 12);
		const charges = getBasicPriceCharges(history, now.getTime());
		assert.deepEqual(charges.map(charge => charge.price), [10, 10, 10, 10, 10, 12, 12]);
		const year = calculatePeriodCosts({consumption: 0, start: new Date(2026, 0, 1).getTime(), end: now.getTime(), priceHistory: [], fallbackPrice: 0, basicCharges: charges});
		const month = calculatePeriodCosts({consumption: 0, start: new Date(2026, 6, 1).getTime(), end: now.getTime(), priceHistory: [], fallbackPrice: 0, basicCharges: charges});
		const expected = calculateHistoricalBasicPriceTotals(history, now);
		assert.equal(year && year.basic, expected.priceYear);
		assert.equal(month && month.basic, expected.priceMonth);
	});
});

describe('delete data (#1265)', () => {
	it('counts states and archive years', () => {
		const root = 'sourceanalytix.0.house';
		const summary = summarizeOutputTree(root, [
			`${root}.cumulativeReading`,
			`${root}.2025.consumedCumulative`,
			`${root}.2026.consumed.months.01_January`,
			`${root}.currentYear.consumed.01_currentDay`,
			'sourceanalytix.0.house2.cumulativeReading',
		]);
		assert.deepEqual(summary, {states: 4, years: [2025, 2026]});
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

	it('recalculates costs of the running periods from the consumption', async () => {
		const {adapter, states} = createHarness();
		addSource(adapter, stateID);
		const root = 'sourceanalytix.0.house.currentYear';
		for (const [state, value] of [['01_currentDay', 10], ['02_currentWeek', 50], ['03_currentMonth', 100], ['04_currentQuarter', 200], ['05_currentYear', 500]]) {
			states.set(`${root}.consumed.${state}`, {val: value});
			states.set(`${root}.costs.${state}`, {val: 0});
		}
		adapter.getForeignStatesAsync = async pattern => Object.fromEntries([...states.entries()].filter(([id]) => id.startsWith(pattern.slice(0, -1))));
		adapter.setForeignStateAsync = async (id, state) => states.set(id, state);
		adapter.loadPriceHistory = async () => [];
		adapter.loadBasicPriceHistory = async () => [];
		adapter.roundCosts = async value => Math.round(value * 100) / 100;
		adapter.loadDynamicCostMemory = async () => null;
		adapter.refreshStatisticsJson = async () => {};
		/** @type {any} */
		let persisted = null;
		adapter.persistDynamicCostMemory = async (_id, memory) => { persisted = memory; };

		const from = new Date(new Date().getFullYear(), 0, 1).getTime();
		const preview = await adapter.handleActionMessage('recalcCosts', {source: stateID, from, dryRun: true});
		assert.equal(preview.total, 5);
		assert.equal(states.get(`${root}.costs.05_currentYear`).val, 0);

		const result = await adapter.handleActionMessage('recalcCosts', {priceDefinition: 'power', from});
		assert.deepEqual(result.sources, [stateID]);
		assert.equal(states.get(`${root}.costs.05_currentYear`).val, 150);
		assert.equal(states.get(`${root}.costs.01_currentDay`).val, 3);
		assert.equal(persisted && persisted.totals.priceYear, 150);
		const progress = JSON.parse(states.get('sourceanalytix.0.info.costRecalculation').val);
		assert.equal(progress.running, false);
		assert.equal(progress.done, 5);
	});

	it('rejects a recalculation date in the future', async () => {
		const {adapter} = createHarness();
		addSource(adapter, stateID);
		const result = await adapter.handleActionMessage('recalcCosts', {source: stateID, from: Date.now() + 86_400_000});
		assert.equal(result.error, 'invalidDate');
	});

	it('deletes the output folder and the settings of a source', async () => {
		const {adapter, states, objects} = createHarness();
		addSource(adapter, stateID);
		objects.set(stateID, {common: {custom: {'sourceanalytix.0': {enabled: true, outputId: 'house'}}}});
		states.set('sourceanalytix.0.house.cumulativeReading', {val: 1000});
		states.set('sourceanalytix.0.house.2026.consumedCumulative', {val: 1});
		adapter.getOutputTreeStates = async () => Object.fromEntries([...states.entries()].filter(([id]) => id.startsWith('sourceanalytix.0.house.')));
		adapter.getObjectAsync = async () => ({type: 'device', native: {sourceState: stateID}});
		adapter.getForeignObjectAsync = async id => objects.get(id) || null;
		adapter.stopStatisticsJsonUpdates = () => {};
		adapter.unsubscribeForeignStates = () => {};
		let customRemoved = false;
		adapter.extendForeignObjectAsync = async (_id, extension) => { customRemoved = extension.common.custom['sourceanalytix.0'] === null; };
		let deleted = null;
		adapter.deleteOutputTree = async deviceName => { deleted = deviceName; };

		const preview = await adapter.handleActionMessage('deleteSourceData', {source: stateID, dryRun: true});
		assert.deepEqual({states: preview.states, years: preview.years, cumulative: preview.cumulative}, {states: 2, years: [2026], cumulative: 1000});
		assert.equal(deleted, null);

		await adapter.handleActionMessage('deleteSourceData', {source: stateID});
		assert.equal(deleted, 'house');
		assert.equal(customRemoved, true);
		assert.equal(adapter.activeStates[stateID], undefined);
	});
});
