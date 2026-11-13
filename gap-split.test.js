'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {getGapShareOfEndingDay} = require('./lib/calculation');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
Reflect.set(Module, '_load', originalModuleLoad);

const hour = 3_600_000;
const oldDayStart = new Date(2026, 2, 10).getTime();
const oldDayEnd = new Date(2026, 2, 11).getTime();

describe('reading gap across midnight', () => {
	describe('getGapShareOfEndingDay', () => {
		const gap = {lastTs: oldDayEnd - 2 * hour, lastTotal: 100, oldDayStart, oldDayEnd};

		it('splits the consumption of the gap proportionally by time', () => {
			// 22:00 → 02:00: half of the gap lies in the ending day
			assert.equal(getGapShareOfEndingDay(gap, 110, oldDayEnd + 2 * hour), 5);
			// 22:00 → 06:00: a quarter
			assert.equal(getGapShareOfEndingDay(gap, 120, oldDayEnd + 6 * hour), 5);
		});

		it('only books the part of a multi-day gap that lies in the ending day', () => {
			const longGap = {...gap, lastTs: oldDayStart - 12 * hour};
			// 12:00 the day before → 12:00 the day after: 24 of 48 hours lie in the ending day
			assert.equal(getGapShareOfEndingDay(longGap, 148, oldDayEnd + 12 * hour), 24);
		});

		it('books nothing without consumption or for a reading before the boundary', () => {
			assert.equal(getGapShareOfEndingDay(gap, 100, oldDayEnd + hour), 0);
			assert.equal(getGapShareOfEndingDay(gap, 90, oldDayEnd + hour), 0);
			assert.equal(getGapShareOfEndingDay(gap, 110, oldDayEnd - hour), 0);
			assert.equal(getGapShareOfEndingDay({...gap, lastTs: oldDayEnd + hour}, 110, oldDayEnd + 2 * hour), 0);
		});
	});

	function createAdapter(config = {}) {
		const adapter = Object.create(Sourceanalytix.prototype);
		/** @type {Record<string, string[]>} */
		const logs = {debug: [], info: [], warn: [], error: []};
		const states = new Map();
		const customWrites = [];
		adapter.namespace = 'sourceanalytix.0';
		adapter.config = {
			currentYearPrevious: true,
			currentYearDays: true,
			currentYearWeek: true,
			currentYearMonth: true,
			currentYearQuarter: true,
			store_weeks: true,
			store_months: true,
			store_quarters: true,
			...config,
		};
		adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
		adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);
		adapter.getDecimals = () => 3;
		adapter.getStateAsync = async id => states.has(id) ? {val: states.get(id), ts: 0} : null;
		adapter.setStateAsync = async (id, state) => states.set(id, state.val);
		adapter.extendForeignObject = async (_id, extension) => customWrites.push(extension.common.custom['sourceanalytix.0']);
		adapter.rememberSourceCustomUpdate = () => {};
		adapter.refreshStatisticsJson = async () => {};
		adapter.usesHistoricalCostCalculation = () => false;
		adapter.loadPriceHistory = async () => [];
		adapter.activeStates = {
			'meter.0.gas': {
				stateDetails: {deviceName: 'gas', stateUnit: 'm³', headCategory: 'consumed', financialCategory: 'costs', consumption: true, costs: true, stateType: 'Gas'},
				calcValues: {cumulativeValue: 100, start_day: 100, start_week: 80, start_month: 100, start_quarter: 50, start_year: 10},
				prices: {unitPrice: 2},
			},
		};
		return {adapter, logs, states, customWrites};
	}

	it('remembers the last reading at a day rollover and books the ending day share at the next reading', async () => {
		const {adapter, states, customWrites} = createAdapter();
		const activeState = adapter.activeStates['meter.0.gas'];
		activeState.lastReadingTs = oldDayEnd - 2 * hour;
		// 10 to 11 March 2026: only the day changes
		const changes = {day: true, week: false, month: false, quarter: false, year: false};
		await adapter.rememberReadingGap('meter.0.gas', changes, {date: '2026-03-10'}, 100, oldDayEnd - 1000);
		assert.ok(activeState.readingGap);

		const oldDay = activeState.readingGap.oldPeriods.day;
		states.set('gas.currentYear.consumed.01_previousDay', 3);
		states.set(`gas.currentYear.consumed.currentWeek.${oldDay}`, 3);
		states.set('gas.currentYear.costs.01_previousDay', 6);
		states.set(`gas.currentYear.costs.currentWeek.${oldDay}`, 6);

		await adapter.splitReadingGap('meter.0.gas', 110, oldDayEnd + 2 * hour);

		assert.equal(activeState.readingGap, null);
		assert.equal(activeState.calcValues.start_day, 105);
		assert.equal(activeState.calcValues.start_week, 80);
		assert.deepEqual(customWrites, [{start_day: 105}]);
		assert.equal(states.get('gas.currentYear.consumed.01_previousDay'), 8);
		assert.equal(states.get(`gas.currentYear.consumed.currentWeek.${oldDay}`), 8);
		assert.equal(states.get('gas.currentYear.costs.01_previousDay'), 16);
		assert.equal(states.get(`gas.currentYear.costs.currentWeek.${oldDay}`), 16);
	});

	it('lists previous values, collections and archives of all periods that ended', () => {
		const {adapter} = createAdapter();
		const gap = {
			changes: {day: true, week: true, month: true, quarter: true, year: false},
			oldPeriods: {day: 'Sunday', week: '13', weekYear: 2026, month: '03_March', quarter: 1, year: 2026},
		};
		assert.deepEqual(adapter.getEndedPeriodStateIds({deviceName: 'gas'}, 'consumed', gap), [
			'gas.currentYear.consumed.01_previousDay',
			'gas.currentYear.consumed.02_previousWeek',
			'gas.currentYear.consumed.03_previousMonth',
			'gas.currentYear.consumed.04_previousQuarter',
			'gas.currentYear.consumed.previousWeek.Sunday',
			'gas.currentYear.consumed.weeks.13',
			'gas.currentYear.consumed.months.03_March',
			'gas.currentYear.consumed.quarters.Q1',
			'gas.2026.consumed.weeks.13',
			'gas.2026.consumed.months.03_March',
			'gas.2026.consumed.quarters.Q1',
		]);
	});

	it('uses only the archive and the yearly total of the old year at a year change', () => {
		const {adapter} = createAdapter({currentYearPrevious: false, currentYearDays: false});
		const gap = {
			changes: {day: true, week: false, month: true, quarter: true, year: true},
			oldPeriods: {day: 'Thursday', week: '53', weekYear: 2026, month: '12_December', quarter: 4, year: 2026},
		};
		assert.deepEqual(adapter.getEndedPeriodStateIds({deviceName: 'gas'}, 'costs', gap), [
			'gas.2026.costs.months.12_December',
			'gas.2026.costs.quarters.Q4',
			'gas.2026.costsCumulative',
		]);
	});

	it('drops the memory when a second rollover follows without a reading', async () => {
		const {adapter} = createAdapter();
		const activeState = adapter.activeStates['meter.0.gas'];
		activeState.lastReadingTs = oldDayEnd - 2 * hour;
		const changes = {day: true, week: false, month: false, quarter: false, year: false};
		await adapter.rememberReadingGap('meter.0.gas', changes, {date: '2026-03-10'}, 100, oldDayEnd - 1000);
		await adapter.rememberReadingGap('meter.0.gas', changes, {date: '2026-03-11'}, 100, oldDayEnd + 24 * hour - 1000);
		assert.equal(activeState.readingGap, null);
	});
});
