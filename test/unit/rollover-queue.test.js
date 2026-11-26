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

describe('values arriving during a period rollover (#1270)', () => {
	it('are processed in order after the rollover instead of being dropped', async () => {
		const adapter = Object.create(Sourceanalytix.prototype);
		/** @type {Record<string, string[]>} */
		const logs = {debug: [], info: [], warn: [], error: []};
		adapter.namespace = 'sourceanalytix.0';
		adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
		adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);
		adapter.rolloverRunning = false;
		adapter.queueStateChanges = false;
		adapter.queuedStateChanges = [];
		adapter.priceControlStates = {};
		adapter.dynamicPriceStates = {};
		adapter.migratingStates = new Set();
		adapter.activeStates = {'meter.0.gas': {}};
		/** @type {unknown[]} */
		const processed = [];
		adapter.calculationHandler = async (id, state) => processed.push(state.val);
		adapter.closePowerIntervals = async () => {};
		adapter.refreshDates = async () => {};
		adapter.refreshScheduledPrices = async () => {};
		adapter.processPeriodRollover = async () => {
			await adapter.onStateChange('meter.0.gas', {val: 101, ack: true, ts: 1, lc: 1});
			await adapter.onStateChange('meter.0.gas', {val: 102, ack: true, ts: 2, lc: 2});
			return true;
		};
		/** @type {() => void} */
		let release = () => {};
		adapter.clearTimeout = () => {};
		adapter.setTimeout = callback => {
			release = callback;
			return 1;
		};

		await adapter.runPeriodRollovers('test');
		assert.deepEqual(processed, []);
		release();
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(processed, [101, 102]);
		assert.equal(adapter.queueStateChanges, false);

		// The block is released: new values are processed right away
		await adapter.onStateChange('meter.0.gas', {val: 103, ack: true, ts: 3, lc: 3});
		assert.deepEqual(processed, [101, 102, 103]);
		assert.deepEqual(logs.error, []);
	});
});
