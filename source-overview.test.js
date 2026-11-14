'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {buildUnitConfig} = require('./lib/calculation');
const {buildProblems, checkStartValues, diagnoseSourceConfig, getSourceStatus} = require('./lib/source-overview');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
Reflect.set(Module, '_load', originalModuleLoad);

const unitConfig = buildUnitConfig();
const pricesConfig = {power: {unitType: 'kWh'}, gas: {unitType: 'm³'}};

describe('source configuration check (#1269)', () => {
	it('accepts a complete configuration', () => {
		assert.deepEqual(diagnoseSourceConfig({custom: {selectedPrice: 'power'}, unit: 'Wh', pricesConfig, unitConfig}), []);
	});

	it('reports missing price, missing unit and incompatible units', () => {
		assert.deepEqual(diagnoseSourceConfig({custom: {selectedPrice: 'Choose'}, unit: 'Wh', pricesConfig, unitConfig}).map(f => f.code), ['noPrice']);
		assert.deepEqual(diagnoseSourceConfig({custom: {selectedPrice: 'water'}, unit: 'Wh', pricesConfig, unitConfig}).map(f => f.code), ['priceMissing']);
		assert.deepEqual(diagnoseSourceConfig({custom: {selectedPrice: 'gas'}, unit: '', pricesConfig, unitConfig}).map(f => f.code), ['unitMissing']);
		assert.deepEqual(diagnoseSourceConfig({custom: {selectedPrice: 'gas'}, unit: 'kWh', pricesConfig, unitConfig}).map(f => f.code), ['unitIncompatible']);
	});

	it('uses a manually selected unit', () => {
		assert.deepEqual(diagnoseSourceConfig({custom: {selectedPrice: 'gas', selectedUnit: 'm³'}, unit: '', pricesConfig, unitConfig}), []);
	});
});

describe('start value check (#1267, #1269)', () => {
	// Thursday 12.11.2026: week started on Monday 09.11., month on 01.11., quarter on 01.10.
	const date = new Date(2026, 10, 12, 15);

	it('accepts ordered values and empty fields', () => {
		assert.deepEqual(checkStartValues({start_day: '1000,5', start_week: 990, start_month: 950, start_quarter: '', start_year: 500}, 1001, date), {});
	});

	it('rejects values above the total and recognises Wh', () => {
		const errors = checkStartValues({start_day: 1_000_000, start_year: 5_000_000}, 1001, date);
		assert.deepEqual(errors.start_day, {code: 'aboveTotalWh', suggestion: 1000});
		assert.deepEqual(errors.start_year, {code: 'aboveTotal'});
	});

	it('requires a later period to start at least as high as an earlier one', () => {
		const errors = checkStartValues({start_day: 900, start_week: 950}, 1000, date);
		assert.deepEqual(errors.start_week, {code: 'order', other: 'start_day', otherValue: 900});
	});

	it('places the week by its first day', () => {
		// Monday 02.11.2026 – week started in November, after the month
		const monday = new Date(2026, 10, 2, 9);
		assert.deepEqual(checkStartValues({start_week: 900, start_month: 950}, 1000, monday), {start_month: {code: 'order', other: 'start_week', otherValue: 900}});
		// Sunday 01.11.2026 – week started in October, before the month
		const sunday = new Date(2026, 10, 1, 9);
		assert.deepEqual(checkStartValues({start_week: 900, start_month: 950}, 1000, sunday), {});
	});

	it('rejects text and negative values', () => {
		assert.deepEqual(checkStartValues({start_day: 'abc', start_week: -1}, 1000, date), {start_day: {code: 'notNumber'}, start_week: {code: 'negative'}});
	});
});

describe('problem list (#1269)', () => {
	const now = new Date(2026, 10, 12, 15).getTime();
	const base = {
		enabled: true, active: true, sourceExists: true, outputId: 'x', values: {}, diagnostics: [],
		resetDetection: true, cumulative: 1000, settings: {}, periodDate: '2026-11-12', kind: 'meter',
	};

	it('finds the problems of the design table', () => {
		const sources = [
			{...base, id: 'a', name: 'Hausstrom', priceDefinition: 'power', basicRate: true},
			{...base, id: 'b', name: 'Wallbox', priceDefinition: 'power', basicRate: true, resetDetection: false, decreasesWhileResetOff: 3},
			{...base, id: 'c', name: 'Gas', active: false, diagnostics: [{code: 'unitMissing', severity: 'error'}]},
			{...base, id: 'd', name: 'Wärmepumpe', kind: 'power', lastValueTs: now - 4 * 3_600_000},
			{...base, id: 'e', name: 'Wasser', pendingRealign: true, periodDate: '2026-11-11', settings: {start_day: 2000}},
			{...base, id: 'f', name: 'Alt', sourceExists: false},
			{...base, id: 'g', name: 'Weg', orphan: true, enabled: false, active: false, sourceExists: false},
		];
		const {problems, passed} = buildProblems(sources, now);
		const codes = problems.map(problem => `${problem.source}:${problem.code}`).sort();
		assert.deepEqual(codes, [
			'b:basicFeeTwice', 'b:resetDetectionOff', 'c:unitMissing', 'd:powerSilent',
			'e:offsetAboveTotal', 'e:rolloverMissed', 'e:startValue', 'f:sourceDeleted', 'g:sourceDeleted',
		]);
		assert.deepEqual(passed, ['noPrice', 'stringValue']);
		assert.equal(getSourceStatus(/** @type {any} */ (sources[0]), problems), 'ok');
		assert.equal(getSourceStatus(/** @type {any} */ (sources[1]), problems), 'warning');
		assert.equal(getSourceStatus(/** @type {any} */ (sources[4]), problems), 'error');
		assert.equal(getSourceStatus(/** @type {any} */ ({...sources[0], enabled: false}), problems), 'disabled');
	});
});

describe('saveSource and setSourceEnabled (#1269)', () => {
	function createHarness() {
		const adapter = Object.create(Sourceanalytix.prototype);
		const objects = new Map();
		adapter.namespace = 'sourceanalytix.0';
		adapter.activeStates = {};
		adapter.unitPriceDef = {unitConfig, pricesConfig};
		adapter.log = {info: () => {}, debug: () => {}, warn: () => {}, error: () => {}};
		adapter.getForeignObjectAsync = async id => objects.get(id) || null;
		adapter.extendForeignObjectAsync = async (id, extension) => {
			const object = objects.get(id);
			const current = object.common.custom && object.common.custom['sourceanalytix.0'] || {};
			object.common.custom = {...object.common.custom, 'sourceanalytix.0': {...current, ...extension.common.custom['sourceanalytix.0']}};
		};
		adapter.getUsedOutputIds = async () => ({house: 'other.0.meter'});
		return {adapter, objects};
	}

	it('creates the settings of a new source with defaults', async () => {
		const {adapter, objects} = createHarness();
		objects.set('shelly.0.energy', {type: 'state', common: {unit: 'Wh'}});
		const result = await adapter.handleActionMessage('saveSource', {source: 'shelly.0.energy', settings: {selectedPrice: 'power', alias: 'Trockner', valueAtDeviceReset: 5}});
		assert.equal(result.ok, true);
		const custom = objects.get('shelly.0.energy').common.custom['sourceanalytix.0'];
		assert.equal(custom.enabled, true);
		assert.equal(custom.costs, true);
		assert.equal(custom.alias, 'Trockner');
		assert.equal(custom.valueAtDeviceReset, undefined, 'calculation memory cannot be written from the page');
	});

	it('rejects a used output ID, a missing price and bad start values', async () => {
		const {adapter, objects} = createHarness();
		objects.set('shelly.0.energy', {type: 'state', common: {unit: 'Wh'}});
		adapter.activeStates['shelly.0.energy'] = {calcValues: {cumulativeValue: 100}};
		const result = await adapter.handleActionMessage('saveSource', {source: 'shelly.0.energy', settings: {selectedPrice: 'water', outputId: 'house', start_day: 200}});
		assert.equal(result.error, 'invalidSettings');
		assert.deepEqual(Object.keys(result.errors).sort(), ['outputId', 'selectedPrice', 'start_day']);
		assert.equal(objects.get('shelly.0.energy').common.custom, undefined);
	});

	it('deactivates and activates a source and keeps the settings', async () => {
		const {adapter, objects} = createHarness();
		objects.set('shelly.0.energy', {type: 'state', common: {unit: 'Wh', custom: {'sourceanalytix.0': {enabled: true, selectedPrice: 'power'}}}});
		await adapter.handleActionMessage('setSourceEnabled', {source: 'shelly.0.energy', enabled: false});
		assert.deepEqual(objects.get('shelly.0.energy').common.custom['sourceanalytix.0'], {enabled: false, selectedPrice: 'power'});
		const missing = await adapter.handleActionMessage('setSourceEnabled', {source: 'x.0.y', enabled: true});
		assert.equal(missing.error, 'notConfigured');
	});
});
