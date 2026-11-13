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

const hour = 3_600_000;

async function createAdapter(calcValues, unit = 'W') {
	const adapter = Object.create(Sourceanalytix.prototype);
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	const calls = [];
	adapter.namespace = 'sourceanalytix.0';
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);
	// The in-memory calendar describes today, the rollover runs for the start of tomorrow
	await adapter.refreshDates();
	const today = adapter.getPeriodSnapshot(new Date());
	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const tomorrowStart = new Date(todayStart);
	tomorrowStart.setDate(tomorrowStart.getDate() + 1);
	adapter.activeStates = {
		'meter.0.power': {stateDetails: {stateUnit: unit}, calcValues: {cumulativeValue: 10, ...calcValues(tomorrowStart.getTime())}},
	};
	adapter.loadPeriodMemory = async () => today;
	adapter.calculationHandler = async (stateID, state, date) => calls.push({stateID, state, date});
	return {adapter, logs, calls, rolloverDate: new Date(tomorrowStart.getTime() + 1000), boundary: tomorrowStart.getTime()};
}

describe('power sources at the period rollover', () => {
	it('books the running interval up to the boundary to the ending day', async () => {
		const {adapter, calls, rolloverDate, boundary} = await createAdapter(boundaryTs => ({
			previousReadingWatt: 500,
			previousReadingWattTs: boundaryTs - hour,
		}));
		await adapter.closePowerIntervals(rolloverDate);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].state.val, 500);
		assert.equal(calls[0].state.ts, boundary - 1);
		assert.equal(calls[0].date.getTime(), boundary - 1);
	});

	it('does not extrapolate an interval that started before the ending day', async () => {
		const {adapter, calls, rolloverDate} = await createAdapter(boundaryTs => ({
			previousReadingWatt: 500,
			previousReadingWattTs: boundaryTs - 30 * hour,
		}));
		await adapter.closePowerIntervals(rolloverDate);
		assert.equal(calls.length, 0);
	});

	it('ignores sources without a running interval and cumulative sources', async () => {
		const withoutReading = await createAdapter(() => ({previousReadingWatt: null, previousReadingWattTs: null}));
		await withoutReading.adapter.closePowerIntervals(withoutReading.rolloverDate);
		assert.equal(withoutReading.calls.length, 0);

		const cumulative = await createAdapter(boundaryTs => ({previousReadingWatt: 500, previousReadingWattTs: boundaryTs - hour}), 'kWh');
		await cumulative.adapter.closePowerIntervals(cumulative.rolloverDate);
		assert.equal(cumulative.calls.length, 0);
	});

	it('does nothing when no day rollover is due', async () => {
		const {adapter, calls} = await createAdapter(boundaryTs => ({
			previousReadingWatt: 500,
			previousReadingWattTs: boundaryTs - 2 * hour,
		}));
		await adapter.closePowerIntervals(new Date());
		assert.equal(calls.length, 0);
	});
});
