'use strict';

const assert = require('node:assert/strict');
const customConfig = require('./admin/jsonCustom.json');
const schema = customConfig.items;

function executeCustom(expression, data, customObj, instanceObj = {}) {
	return new Function(
		'data',
		'originalData',
		'_system',
		'instanceObj',
		'customObj',
		'_socket',
		'arrayIndex',
		'globalData',
		'_changed',
		`return ${expression}`,
	)(data, {}, {}, instanceObj, customObj, {}, 0, {}, false);
}

describe('custom settings validation', () => {
	const source = {_id: '0_userdata.0.energy', common: {unit: 'kWh'}};

	it('opts into blocking validation without triggering legacy field dialogs', () => {
		assert.equal(customConfig.validatorNoSaveOnError, true);
		assert.equal(Object.hasOwn(schema.outputId, 'validatorNoSaveOnError'), false);
		assert.equal(Object.hasOwn(schema.selectedPrice, 'validatorNoSaveOnError'), false);
		assert.equal(Object.hasOwn(schema.selectedUnit, 'validatorNoSaveOnError'), false);
	});

	it('restricts prices and units to the options provided by the adapter', () => {
		assert.equal(schema.selectedPrice.type, 'selectSendTo');
		assert.equal(schema.selectedPrice.manual, false);
		assert.equal(schema.selectedUnit.type, 'selectSendTo');
		assert.equal(schema.selectedUnit.manual, false);
	});

	it('pre-fills the backward-compatible output ID', () => {
		assert.equal(executeCustom(schema.outputId.defaultFunc, {}, source), '0_userdata__0__energy');
	});

	it('requires an output ID and price definition when enabled', () => {
		assert.equal(executeCustom(schema.outputId.validator, {enabled: true, outputId: ''}, source), false);
		assert.equal(executeCustom(schema.outputId.validator, {enabled: true, outputId: 'Kitchen'}, source), true);
		assert.equal(executeCustom(schema.selectedPrice.validator, {enabled: true}, source), false);
		assert.equal(executeCustom(schema.selectedPrice.validator, {enabled: true, selectedPrice: 'Electricity'}, source), true);
	});

	it('rejects an output ID owned by another source', () => {
		assert.equal(executeCustom(schema.outputId.validator, {
			enabled: true,
			outputId: 'Kitchen',
			_usedOutputIds: {Kitchen: 'alias.0.other'},
		}, source), false);
		assert.equal(executeCustom(schema.outputId.validator, {
			enabled: true,
			outputId: 'Kitchen',
			_usedOutputIds: {Kitchen: source._id},
		}, source), true);
	});

	it('handles output ID validation without a single source object', () => {
		assert.equal(executeCustom(schema.outputId.validator, {
			enabled: true,
			outputId: 'Kitchen',
			_usedOutputIds: {Kitchen: 'alias.0.other'},
		}, {common: {custom: {}}, native: {}}), false);
	});

	it('accepts detected or manually selected supported units', () => {
		assert.equal(executeCustom(schema.selectedUnit.validator, {enabled: true, selectedUnit: 'Detect automatically'}, source), true);
		assert.equal(executeCustom(schema.selectedUnit.validator, {enabled: true, selectedUnit: 'kW'}, {_id: source._id, common: {}}), true);
		assert.equal(executeCustom(schema.selectedUnit.validator, {enabled: true, selectedUnit: 'Detect automatically'}, {_id: source._id, common: {}}), false);
	});

	it('pre-fills explicit rounding values from the selected instance', () => {
		const instance = {native: {decimalsQuantity: 5, decimalsCosts: 4}};
		assert.equal(executeCustom(schema.decimalsQuantity.defaultFunc, {}, source, instance), 5);
		assert.equal(executeCustom(schema.decimalsCosts.defaultFunc, {}, source, instance), 4);
		assert.equal(executeCustom(schema.decimalsQuantity.defaultFunc, {}, source), 3);
		assert.equal(executeCustom(schema.decimalsCosts.defaultFunc, {}, source), 2);
	});

	it('normalizes unusual instance templates before pre-filling a source', () => {
		assert.equal(executeCustom(schema.decimalsQuantity.defaultFunc, {}, source, {native: {decimalsQuantity: 0}}), 0);
		assert.equal(executeCustom(schema.decimalsCosts.defaultFunc, {}, source, {native: {decimalsCosts: -1}}), -1);
		assert.equal(executeCustom(schema.decimalsQuantity.defaultFunc, {}, source, {native: {decimalsQuantity: ''}}), 3);
		assert.equal(executeCustom(schema.decimalsCosts.defaultFunc, {}, source, {native: {decimalsCosts: 'invalid'}}), 2);
		assert.equal(executeCustom(schema.decimalsQuantity.defaultFunc, {}, source, {native: {decimalsQuantity: 99}}), 15);
		assert.equal(executeCustom(schema.decimalsCosts.defaultFunc, {}, source, {native: {decimalsCosts: -5}}), -1);
	});
});
