'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {
	areUnitsCompatible,
	buildUnitConfig,
	convertIntegratedValue,
	convertUnitValue,
	isIntegratedUnit,
	normalizePulsesPerUnit,
	resolveUnit,
} = require('../../lib/calculation');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('../../main');
Reflect.set(Module, '_load', originalModuleLoad);

const units = buildUnitConfig();
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

/**
 * Adapter with one active source and the calculation writes stubbed out.
 * @param {Record<string, unknown>} stateDetails - Source settings
 * @param {number} cumulativeValue - Known total
 */
function createAdapter(stateDetails, cumulativeValue = 0) {
	const adapter = Object.create(Sourceanalytix.prototype);
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	adapter.namespace = 'sourceanalytix.0';
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);
	adapter.unitPriceDef = {unitConfig: units};
	adapter.config = {store_weeks: false, store_months: false, store_quarters: false};
	adapter.setStateChangedAsync = async () => {};
	adapter.recordStatisticsValue = () => {};
	adapter.roundDigits = async value => value;
	adapter.usesHistoricalCostCalculation = () => false;
	adapter.extendForeignObject = async () => {};
	adapter.rememberSourceCustomUpdate = () => {};
	const activeState = {
		firstActivation: false,
		stateDetails: {
			deviceName: 'meter', meter_values: false, costs: false, consumption: false,
			deviceResetLogicEnabled: true, threshold: 1, averagePowerValues: false, ignoreNegativeValues: false, maxPowerGap: 0,
			...stateDetails,
		},
		calcValues: {cumulativeValue, valueAtDeviceReset: 0, previousReadingWatt: null, previousReadingWattTs: null},
		prices: {unitPrice: 0},
	};
	adapter.activeStates = {'meter.0.pulses': activeState};
	return {adapter, logs, activeState};
}

describe('pulse counters (#74, #479)', () => {
	describe('units', () => {
		it('recognises pulse spellings', () => {
			assert.equal(resolveUnit('imp', units), 'piece');
			assert.equal(resolveUnit('Pulses', units), 'piece');
			assert.equal(resolveUnit('pulses/min', units), 'piece/min');
			assert.equal(resolveUnit('imp/min', units), 'piece/min');
		});

		it('integrates the pulse rate over time like power', () => {
			assert.equal(isIntegratedUnit('piece/min', units), true);
			assert.equal(isIntegratedUnit('piece', units), false);
		});

		it('needs the pulses per unit to convert pulses into another unit', () => {
			assert.equal(normalizePulsesPerUnit('1000'), 1000);
			assert.equal(normalizePulsesPerUnit('0,5'), 0.5);
			assert.equal(normalizePulsesPerUnit(''), 0);
			assert.equal(normalizePulsesPerUnit(-1), 0);
			assert.equal(areUnitsCompatible(units.piece, units.kWh), false);
			assert.equal(areUnitsCompatible(units.piece, units.kWh, 1000), true);
			assert.equal(areUnitsCompatible(units.piece, units['m³'], 100), true);
			assert.equal(areUnitsCompatible(units['piece/min'], units.piece), true);
			assert.equal(areUnitsCompatible(units['piece/min'], units.kWh), false);
			assert.equal(areUnitsCompatible(units['piece/min'], units.kWh, 1000), true);
			assert.equal(areUnitsCompatible(units.piece, units.W, 1000), false);
			assert.equal(areUnitsCompatible(units.piece, units['piece/min'], 1000), false);
			assert.equal(areUnitsCompatible(units.kWh, units.piece), false);
		});

		it('converts counted pulses with the pulse factor', () => {
			close(convertUnitValue(12345, units.piece, units.kWh, 1000), 12.345);
			close(convertUnitValue(250, units.piece, units['m³'], 100), 2.5);
			assert.equal(convertUnitValue(12345, units.piece, units.kWh), null);
			assert.equal(convertUnitValue(12345, units.piece, units.piece, 1000), 12345);
		});

		it('turns an integrated pulse rate into pulses or the target unit', () => {
			// 60 pulses/min for one hour = 3600 pulses
			close(convertIntegratedValue(60, units['piece/min'], units.piece), 3600);
			close(convertIntegratedValue(60, units['piece/min'], units.kWh, 1000), 3.6);
			assert.equal(convertIntegratedValue(60, units['piece/min'], units.kWh), null);
			// Power stays as before: 2000 W for one hour = 2 kWh
			close(convertIntegratedValue(2000, units.W, units.kWh), 2);
		});
	});

	describe('meter reading of pulses (#74)', () => {
		it('converts the pulse count into the unit of the price definition', async () => {
			const {adapter, activeState} = createAdapter({stateUnit: 'piece', useUnit: 'kWh', pulsesPerUnit: 1000});
			await adapter.calculationHandler('meter.0.pulses', {val: 1000, ts: 1000});
			await adapter.calculationHandler('meter.0.pulses', {val: 1500, ts: 2000});
			close(activeState.calcValues.cumulativeValue, 1.5);
		});
	});

	describe('pulse rate (#74)', () => {
		it('adds the integrated pulses to the total', async () => {
			const {adapter, activeState} = createAdapter({stateUnit: 'piece/min', useUnit: 'kWh', pulsesPerUnit: 1000}, 10);
			await adapter.calculationHandler('meter.0.pulses', {val: 50, ts: 1_000_000});
			// 50 pulses/min for 30 minutes = 1500 pulses = 1.5 kWh
			await adapter.calculationHandler('meter.0.pulses', {val: 50, ts: 1_000_000 + 30 * 60_000});
			close(activeState.calcValues.cumulativeValue, 11.5);
		});
	});

	describe('each update adds its value (#479)', () => {
		it('adds identical values sent for every pulse', async () => {
			const {adapter, activeState} = createAdapter({stateUnit: 'kWh', useUnit: 'kWh', incrementValues: true}, 5);
			// The value does not change, so lc stays the same; ts tells the updates apart
			for (let pulse = 1; pulse <= 3; pulse++) {
				await adapter.calculationHandler('meter.0.pulses', {val: 0.001, ts: 1000 * pulse, lc: 1000});
			}
			close(activeState.calcValues.cumulativeValue, 5.003);
		});

		it('counts true as one pulse and converts it with the pulse factor', async () => {
			const {adapter, activeState} = createAdapter({stateUnit: 'piece', useUnit: 'm³', incrementValues: true, pulsesPerUnit: 100});
			await adapter.calculationHandler('meter.0.pulses', {val: true, ts: 1000});
			await adapter.calculationHandler('meter.0.pulses', {val: false, ts: 1500});
			await adapter.calculationHandler('meter.0.pulses', {val: true, ts: 2000});
			close(activeState.calcValues.cumulativeValue, 0.02);
		});

		it('counts the same update only once and ignores negative values', async () => {
			const {adapter, activeState} = createAdapter({stateUnit: 'piece', useUnit: 'piece', incrementValues: true}, 10);
			await adapter.calculationHandler('meter.0.pulses', {val: 1, ts: 1000});
			await adapter.calculationHandler('meter.0.pulses', {val: 1, ts: 1000});
			await adapter.calculationHandler('meter.0.pulses', {val: -1, ts: 2000});
			assert.equal(activeState.calcValues.cumulativeValue, 11);
		});

		it('never treats a small increment as a meter reset', async () => {
			const {adapter, activeState, logs} = createAdapter({stateUnit: 'kWh', useUnit: 'kWh', incrementValues: true}, 500);
			await adapter.calculationHandler('meter.0.pulses', {val: 0.5, ts: 1000});
			assert.equal(activeState.calcValues.cumulativeValue, 500.5);
			assert.deepEqual(logs.warn, []);
		});

		it('does not count the current value again when the source starts', async () => {
			const {adapter, activeState} = createAdapter({stateUnit: 'piece', useUnit: 'piece', incrementValues: true}, 10);
			const calls = [];
			adapter.config = {};
			adapter.extendObjectIfChanged = async () => {};
			adapter.initializeCurrentYearPeriodStates = async () => {};
			adapter.initializeYearStatisticsStates = async () => {};
			adapter.doLocalStateCreate = async () => {};
			adapter.ensureStatisticsJsonState = async () => {};
			adapter.refreshStatisticsJson = async () => {};
			adapter.processPeriodRollover = async () => {};
			adapter.subscribeForeignStates = () => {};
			adapter.getForeignStateAsync = async () => ({val: 1, ts: 5000});
			adapter.calculationHandler = async (...args) => calls.push(args);
			await adapter.initialize('meter.0.pulses');
			assert.equal(calls.length, 0);
			assert.equal(activeState.lastIncrementTs, 5000);
		});
	});
});
