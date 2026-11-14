'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {findSharedBasicRates} = require('./lib/source-checks');
const customConfig = require('./admin/jsonCustom.json');
const schema = customConfig.items;

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
Reflect.set(Module, '_load', originalModuleLoad);

function executeCustom(expression, data, customObj) {
	return new Function('data', 'originalData', '_system', 'instanceObj', 'customObj', '_socket', 'arrayIndex', 'globalData', '_changed', `return ${expression}`,
	)(data, {}, {}, {}, customObj, {}, 0, {}, false);
}

/**
 * Evaluate a pattern like Admin does, as template literal.
 * @param {string} pattern - Pattern of a "pattern" field
 * @param {object} data - Custom settings
 * @param {object} customObj - Source object
 * @returns {string} Rendered text
 */
function renderPattern(pattern, data, customObj) {
	return new Function('data', 'customObj', `return \`${pattern}\``)(data, customObj);
}

const activeStates = {
	'meter.0.house': {stateDetails: {stateType: 'Electricity', basicRate: true}},
	'meter.0.heatpump': {stateDetails: {stateType: 'Electricity', basicRate: true}},
	'meter.0.garage': {stateDetails: {stateType: 'Electricity', basicRate: false}},
	'meter.0.gas': {stateDetails: {stateType: 'Gas', basicRate: true}},
};

describe('basic fee included by several sources (#1268)', () => {
	it('finds price definitions whose basic fee is included more than once', () => {
		assert.deepEqual(findSharedBasicRates([
			{id: 'b', priceDefinition: 'Electricity', basicRate: true},
			{id: 'a', priceDefinition: 'Electricity', basicRate: true},
			{id: 'c', priceDefinition: 'Electricity', basicRate: false},
			{id: 'd', priceDefinition: 'Gas', basicRate: true},
		]), {Electricity: ['a', 'b']});
		assert.deepEqual(findSharedBasicRates([]), {});
	});

	it('logs one hint per shared price definition at start', () => {
		const adapter = Object.create(Sourceanalytix.prototype);
		const infos = [];
		adapter.log = {info: message => infos.push(message)};
		adapter.activeStates = activeStates;
		adapter.logSharedBasicRates();
		assert.equal(infos.length, 1);
		assert.match(infos[0], /price definition Electricity is included by 2 sources \(meter\.0\.heatpump, meter\.0\.house\)/);
	});

	it('provides the sources with basic fee to the dialog', () => {
		const adapter = Object.create(Sourceanalytix.prototype);
		adapter.activeStates = activeStates;
		assert.deepEqual(adapter.getBasicRateSources(), {Electricity: ['meter.0.house', 'meter.0.heatpump'], Gas: ['meter.0.gas']});
	});

	describe('custom dialog', () => {
		const sources = {Electricity: ['meter.0.house', 'meter.0.heatpump'], Gas: ['meter.0.gas']};
		const hintHidden = (data, customObj) => executeCustom(schema._basicRateHint.hidden, data, customObj);

		it('asks the adapter for the sources with basic fee', () => {
			assert.equal(schema._basicRateSources.defaultSendTo, 'getBasicRateSources');
			assert.equal(schema._basicRateSources.allowSaveWithError, true);
		});

		it('shows the hint when another source already includes the basic fee', () => {
			const data = {basicRate: true, selectedPrice: 'Electricity', _basicRateSources: sources};
			assert.equal(hintHidden(data, {_id: 'meter.0.garage'}), false);
			assert.equal(hintHidden(data, {_id: 'meter.0.house'}), false);
			assert.equal(renderPattern(schema._basicRateOthers.pattern, data, {_id: 'meter.0.house'}), 'meter.0.heatpump');
		});

		it('hides the hint when this source is the only one', () => {
			assert.equal(hintHidden({basicRate: true, selectedPrice: 'Gas', _basicRateSources: sources}, {_id: 'meter.0.gas'}), true);
			assert.equal(hintHidden({basicRate: true, selectedPrice: 'Water', _basicRateSources: sources}, {_id: 'meter.0.water'}), true);
		});

		it('hides the hint without basic fee, without data from the adapter and in multi-edit', () => {
			assert.equal(hintHidden({basicRate: false, selectedPrice: 'Electricity', _basicRateSources: sources}, {_id: 'meter.0.garage'}), true);
			assert.equal(hintHidden({basicRate: true, selectedPrice: 'Electricity'}, {_id: 'meter.0.garage'}), true);
			assert.equal(hintHidden({basicRate: true, selectedPrice: 'Electricity', _basicRateSources: sources}, {common: {custom: {}}, native: {}}), true);
		});
	});
});
