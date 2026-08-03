'use strict';

const assert = require('node:assert/strict');
const schema = require('./admin/jsonCustom.json').items;

function executeCustom(expression, data, customObj) {
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
	)(data, {}, {}, {}, customObj, {}, 0, {}, false);
}

describe('custom settings validation', () => {
	const source = {_id: '0_userdata.0.energy', common: {unit: 'kWh'}};

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
});
