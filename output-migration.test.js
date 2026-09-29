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

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function createAdapterHarness() {
	const adapter = Object.create(Sourceanalytix.prototype);
	const objects = new Map();
	const states = new Map();
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	let customWrites = 0;

	adapter.namespace = 'sourceanalytix.0';
	adapter.activeStates = {};
	adapter.migratingStates = new Set();
	adapter.customConfigBackfills = new Map();
	adapter.statisticsJsonTimers = {};
	adapter.statisticsJsonSnapshots = {};
	adapter.statisticsJsonLastValues = {};
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	adapter.setTimeout = () => 1;
	adapter.stopStatisticsJsonUpdates = () => {};
	adapter.unsubscribeForeignStates = () => {};
	adapter.errorHandling = (context, error) => logs.error.push(`${context}: ${error}`);

	const fullId = id => id.startsWith(`${adapter.namespace}.`) || id.startsWith('alias.0.')
		? id
		: `${adapter.namespace}.${id}`;
	adapter.getObjectListAsync = async range => ({
		rows: [...objects.keys()]
			.filter(id => id >= range.startkey && id <= range.endkey)
			.map(id => ({id})),
	});
	adapter.getForeignObjectAsync = async id => clone(objects.get(id) || null);
	adapter.getObjectAsync = async id => clone(objects.get(`${adapter.namespace}.${id}`) || null);
	adapter.setForeignObjectAsync = async (id, object) => objects.set(id, {...clone(object), _id: id});
	adapter.setObjectAsync = async (id, object) => {
		const objectId = `${adapter.namespace}.${id}`;
		objects.set(objectId, {...clone(object), _id: objectId});
	};
	adapter.extendObjectAsync = async (id, extension) => {
		const objectId = `${adapter.namespace}.${id}`;
		const current = objects.get(objectId) || {};
		objects.set(objectId, {
			...current,
			...clone(extension),
			common: {...(current.common || {}), ...(clone(extension.common) || {})},
			native: {...(current.native || {}), ...(clone(extension.native) || {})},
			_id: objectId,
		});
	};
	adapter.delForeignObjectAsync = async id => objects.delete(id);
	adapter.getForeignStatesAsync = async pattern => {
		const prefix = pattern.endsWith('.*') ? pattern.slice(0, -1) : pattern;
		return Object.fromEntries([...states.entries()].filter(([id]) => id.startsWith(prefix)).map(([id, state]) => [id, clone(state)]));
	};
	adapter.setForeignStateAsync = async (id, state) => states.set(id, clone(state));
	adapter.delForeignStateAsync = async id => states.delete(id);
	adapter.getObjectViewAsync = async () => ({
		rows: [...objects.entries()]
			.filter(([id, object]) => id.startsWith(`${adapter.namespace}.`) && object.type === 'device')
			.map(([id]) => ({id})),
	});
	adapter.extendForeignObjectAsync = async (id, extension) => {
		customWrites++;
		const current = objects.get(id) || {type: 'state', common: {}};
		const currentCustom = current.common && current.common.custom || {};
		const extensionCustom = extension.common && extension.common.custom || {};
		objects.set(id, {
			...current,
			common: {
				...(current.common || {}),
				...(clone(extension.common) || {}),
				custom: {
					...clone(currentCustom),
					...Object.fromEntries(Object.entries(extensionCustom).map(([namespace, settings]) => [namespace, {
						...(clone(currentCustom[namespace]) || {}),
						...clone(settings),
					}])),
				},
			},
		});
	};

	return {
		adapter,
		objects,
		states,
		logs,
		get customWrites() { return customWrites; },
		putObject(id, object) { objects.set(fullId(id), {...clone(object), _id: fullId(id)}); },
		putState(id, state) { states.set(fullId(id), clone(state)); },
	};
}

function putOutputTree(harness, root = 'old', sourceId = 'alias.0.meter') {
	harness.putObject(root, {type: 'device', common: {name: 'Meter'}, native: {sourceState: sourceId}});
	harness.putObject(`${root}.value`, {
		type: 'state',
		common: {name: 'Value', type: 'number', custom: {'history.0': {enabled: true}}},
		native: {},
	});
	harness.putState(`${root}.value`, {val: 42, ack: true, q: 0, ts: 1234});
}

describe('output ID migration lifecycle', () => {
	it('copies and verifies the complete tree before deleting the source', async () => {
		const harness = createAdapterHarness();
		putOutputTree(harness);

		assert.equal(await harness.adapter.migrateOutputTree('alias.0.meter', 'old', 'new'), true);
		assert.equal(harness.objects.has('sourceanalytix.0.old'), false);
		assert.equal(harness.objects.has('sourceanalytix.0.old.value'), false);
		assert.equal(harness.states.has('sourceanalytix.0.old.value'), false);
		assert.deepEqual(harness.objects.get('sourceanalytix.0.new.value').common.custom, {'history.0': {enabled: true}});
		assert.equal(harness.states.get('sourceanalytix.0.new.value').val, 42);
		assert.equal(harness.objects.get('sourceanalytix.0.new').native.outputMigration, undefined);
	});

	it('rolls back only the target after a copy fails midway', async () => {
		const harness = createAdapterHarness();
		putOutputTree(harness);
		const setObject = harness.adapter.setForeignObjectAsync;
		let writes = 0;
		harness.adapter.setForeignObjectAsync = async (...args) => {
			if (++writes === 2) throw new Error('injected copy failure');
			return setObject(...args);
		};

		assert.equal(await harness.adapter.migrateOutputTree('alias.0.meter', 'old', 'new'), false);
		assert.equal(harness.objects.has('sourceanalytix.0.old.value'), true);
		assert.equal(harness.states.has('sourceanalytix.0.old.value'), true);
		assert.equal(harness.objects.has('sourceanalytix.0.new'), false);
	});

	it('never deletes foreign target children when the pre-check fails', async () => {
		const harness = createAdapterHarness();
		putOutputTree(harness);
		harness.putObject('taken.foreign', {type: 'state', common: {name: 'Foreign'}, native: {owner: 'other'}});

		assert.equal(await harness.adapter.migrateOutputTree('alias.0.meter', 'old', 'taken'), false);
		assert.equal(harness.objects.has('sourceanalytix.0.taken.foreign'), true);
		assert.equal(harness.objects.has('sourceanalytix.0.old'), true);
	});

	it('rolls back a copying migration after restart', async () => {
		const harness = createAdapterHarness();
		putOutputTree(harness);
		harness.putObject('new', {
			type: 'device', common: {name: 'Meter'},
			native: {sourceState: 'alias.0.meter', outputMigration: {from: 'old', status: 'copying'}},
		});
		harness.putObject('new.partial', {type: 'state', common: {name: 'Partial'}, native: {}});

		await harness.adapter.recoverOutputMigration('alias.0.meter', 'new');
		assert.equal(harness.objects.has('sourceanalytix.0.new'), false);
		assert.equal(harness.objects.has('sourceanalytix.0.new.partial'), false);
		assert.equal(harness.objects.has('sourceanalytix.0.old'), true);
	});

	it('finishes cleanup of a verified migration after restart', async () => {
		const harness = createAdapterHarness();
		putOutputTree(harness);
		harness.putObject('new', {
			type: 'device', common: {name: 'Meter'},
			native: {sourceState: 'alias.0.meter', outputMigration: {from: 'old', status: 'verified'}},
		});

		await harness.adapter.recoverOutputMigration('alias.0.meter', 'new');
		assert.equal(harness.objects.has('sourceanalytix.0.old'), false);
		assert.equal(harness.objects.get('sourceanalytix.0.new').native.outputMigration, undefined);
	});

	it('finds legacy and renamed roots while ignoring a copying target', async () => {
		const harness = createAdapterHarness();
		const sourceId = 'alias.0.meter';
		const legacy = 'alias__0__meter';
		harness.putObject(legacy, {type: 'device', common: {name: 'Legacy'}, native: {}});
		harness.putObject('new', {
			type: 'device', common: {name: 'Copy'},
			native: {sourceState: sourceId, outputMigration: {from: legacy, status: 'copying'}},
		});
		assert.equal(await harness.adapter.findCurrentOutputId(sourceId, 'new'), legacy);

		harness.objects.clear();
		harness.putObject('new', {type: 'device', common: {name: 'Renamed'}, native: {sourceState: sourceId}});
		assert.equal(await harness.adapter.findCurrentOutputId(sourceId, 'new'), 'new');
	});

	it('rejects several live roots which claim the same source', async () => {
		const harness = createAdapterHarness();
		harness.putObject('old', {type: 'device', common: {name: 'Old'}, native: {sourceState: 'alias.0.meter'}});
		harness.putObject('new', {type: 'device', common: {name: 'New'}, native: {sourceState: 'alias.0.meter'}});
		await assert.rejects(harness.adapter.findCurrentOutputId('alias.0.meter', 'missing'), /owns several output trees/);
	});

	it('prefers a verified target over its source tree awaiting cleanup', async () => {
		const harness = createAdapterHarness();
		harness.putObject('old', {type: 'device', common: {name: 'Old'}, native: {sourceState: 'alias.0.meter'}});
		harness.putObject('new', {
			type: 'device', common: {name: 'New'},
			native: {sourceState: 'alias.0.meter', outputMigration: {from: 'old', status: 'verified'}},
		});
		assert.equal(await harness.adapter.findCurrentOutputId('alias.0.meter', 'missing'), 'new');
	});
});

describe('output ID configuration recovery', () => {
	it('keeps the existing tree and writes its ID back in one write with the defaults', async () => {
		const harness = createAdapterHarness();
		const sourceId = 'alias.0.meter';
		const customData = {enabled: true, outputId: 'taken'};
		harness.putObject(sourceId, {
			type: 'state',
			common: {custom: {'history.0': {enabled: true}, 'sourceanalytix.0': customData}},
			native: {},
		});

		assert.equal(await harness.adapter.restoreEffectiveOutputId(sourceId, 'old', 'taken', 'already exists'), 'old');
		assert.equal(harness.customWrites, 0);

		await harness.adapter.persistCustomConfigDefaults(sourceId, customData, 'old', 3, 2, true);
		const updatedObject = harness.objects.get(sourceId);
		assert.equal(harness.customWrites, 1);
		assert.deepEqual(updatedObject.common.custom['history.0'], {enabled: true});
		assert.deepEqual(updatedObject.common.custom['sourceanalytix.0'], {enabled: true, outputId: 'old', decimalsQuantity: 3, decimalsCosts: 2});
		assert.deepEqual(harness.adapter.customConfigBackfills.get(sourceId), updatedObject.common.custom['sourceanalytix.0']);

		await harness.adapter.persistCustomConfigDefaults(sourceId, updatedObject.common.custom['sourceanalytix.0'], 'old', 3, 2);
		assert.equal(harness.customWrites, 1);
	});

	it('does not start a fresh tree when a new source requests an occupied ID', async () => {
		const harness = createAdapterHarness();
		putOutputTree(harness, 'taken', 'alias.0.other');

		assert.equal(await harness.adapter.restoreEffectiveOutputId('alias.0.meter', null, 'taken', 'already exists'), '');
		assert.equal(harness.customWrites, 0);
		assert.match(harness.logs.error[0], /no existing output tree to keep/);
	});

	it('does not abandon an interrupted migration whose source tree is gone', async () => {
		const harness = createAdapterHarness();
		harness.putObject('new', {
			type: 'device', common: {name: 'Meter'},
			native: {sourceState: 'alias.0.meter', outputMigration: {from: 'old', status: 'copying'}},
		});
		harness.putObject('new.value', {type: 'state', common: {name: 'Value'}, native: {}});

		await assert.rejects(harness.adapter.recoverOutputMigration('alias.0.meter', 'new'), /no intact source tree/);
		assert.equal(await harness.adapter.restoreEffectiveOutputId('alias.0.meter', null, 'new', 'recovery failed'), '');
		assert.equal(harness.objects.has('sourceanalytix.0.new.value'), true);
		assert.equal(harness.objects.has('sourceanalytix.0.alias__0__meter'), false);
	});

	it('ignores the object change generated by its own write-back', async () => {
		const harness = createAdapterHarness();
		const sourceId = 'alias.0.meter';
		const customData = {enabled: true};
		harness.putObject(sourceId, {type: 'state', common: {custom: {'sourceanalytix.0': customData}}, native: {}});
		await harness.adapter.persistCustomConfigDefaults(sourceId, customData, 'old', 3, 2);
		let builds = 0;
		harness.adapter.buildStateDetailsArray = async () => { builds++; };
		await harness.adapter.onObjectChange(sourceId, harness.objects.get(sourceId));
		assert.equal(builds, 0);
		assert.equal(harness.adapter.customConfigBackfills.has(sourceId), false);
	});
});

describe('calculation configuration snapshot', () => {
	it('finishes safely when a source is disabled during an awaited calculation', async () => {
		const harness = createAdapterHarness();
		const sourceId = 'alias.0.power';
		const activeState = {
			firstActivation: false,
			calcValues: {cumulativeValue: 5, start_day: 0, start_week: 0, start_month: 0, start_quarter: 0, start_year: 0},
			stateDetails: {
				stateUnit: 'W', useUnit: 'kWh', deviceName: 'power', meter_values: false,
				costs: false, consumption: false,
			},
			prices: {unitPrice: 0},
		};
		harness.adapter.activeStates[sourceId] = activeState;
		harness.adapter.unitPriceDef = {unitConfig: {
			W: {category: 'Watt', exponent: 0},
			kWh: {category: 'Watt', exponent: 3},
		}};
		harness.adapter.config = {store_weeks: false, store_months: false, store_quarters: false};
		harness.adapter.setStateChangedAsync = async () => {};
		harness.adapter.recordStatisticsValue = () => {};
		harness.adapter.roundDigits = async value => value;
		harness.adapter.usesHistoricalCostCalculation = () => false;
		/** @type {(value: number) => void} */
		let releaseCalculation = () => {};
		harness.adapter.wattToWattHour = () => new Promise(resolve => { releaseCalculation = resolve; });

		const calculation = harness.adapter.calculationHandler(sourceId, {val: 100, ts: 1000});
		await new Promise(resolve => setImmediate(resolve));
		delete harness.adapter.activeStates[sourceId];
		releaseCalculation(1);
		await calculation;

		assert.equal(activeState.calcValues.cumulativeValue, 5.001);
		assert.deepEqual(harness.logs.error, []);
	});
});
