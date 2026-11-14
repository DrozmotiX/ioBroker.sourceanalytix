'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {isPowerGapExceeded, normalizeMaxPowerGap} = require('../../lib/calculation');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('../../main');
Reflect.set(Module, '_load', originalModuleLoad);

const minute = 60_000;
const start = Date.UTC(2026, 0, 1, 8);

/**
 * @param {unknown} maxPowerGap - Configured maximum gap
 */
function createAdapter(maxPowerGap) {
	const adapter = Object.create(Sourceanalytix.prototype);
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);
	adapter.activeStates = {
		'meter.0.power': {
			stateDetails: {stateUnit: 'W', averagePowerValues: false, ignoreNegativeValues: false, maxPowerGap: normalizeMaxPowerGap(maxPowerGap)},
			calcValues: {previousReadingWatt: 1000, previousReadingWattTs: start},
		},
	};
	return {adapter, logs};
}

describe('maximum gap for power sources (#1266)', () => {
	it('is off by default and for invalid values', () => {
		for (const value of [undefined, null, '', 0, -5, 'abc']) assert.equal(normalizeMaxPowerGap(value), 0, JSON.stringify(value));
		assert.equal(normalizeMaxPowerGap(15), 15);
		assert.equal(normalizeMaxPowerGap('7,5'), 7.5);
	});

	it('detects intervals longer than the maximum gap', () => {
		assert.equal(isPowerGapExceeded(start, start + 16 * minute, 15), true);
		assert.equal(isPowerGapExceeded(start, start + 15 * minute, 15), false);
		assert.equal(isPowerGapExceeded(start, start + 24 * 60 * minute, 0), false);
	});

	it('extrapolates the last power value over any pause when switched off', async () => {
		const {adapter, logs} = createAdapter('');
		const energy = await adapter.wattToWattHour('meter.0.power', {val: 500, ts: start + 120 * minute});
		assert.equal(energy, 2000);
		assert.equal(logs.info.length, 0);
	});

	it('does not count an interval longer than the maximum gap and logs it', async () => {
		const {adapter, logs} = createAdapter(30);
		const energy = await adapter.wattToWattHour('meter.0.power', {val: 500, ts: start + 120 * minute});
		assert.equal(energy, 0);
		assert.equal(logs.info.length, 1);
		assert.match(logs.info[0], /for 120 min, longer than the maximum gap of 30 min/);
		// The new value is the baseline for the next interval
		const next = await adapter.wattToWattHour('meter.0.power', {val: 500, ts: start + 126 * minute});
		assert.equal(next, 50);
	});

	it('counts intervals within the maximum gap as before', async () => {
		const {adapter, logs} = createAdapter(30);
		const energy = await adapter.wattToWattHour('meter.0.power', {val: 500, ts: start + 6 * minute});
		assert.equal(energy, 100);
		assert.equal(logs.info.length, 0);
	});
});
