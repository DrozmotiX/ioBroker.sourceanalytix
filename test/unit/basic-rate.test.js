'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {findSharedBasicRates} = require('../../lib/source-checks');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('../../main');
Reflect.set(Module, '_load', originalModuleLoad);

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

});
