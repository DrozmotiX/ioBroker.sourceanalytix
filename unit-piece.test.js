'use strict';

const assert = require('node:assert/strict');
const {areUnitsCompatible, buildUnitConfig, convertUnitValue, resolveUnit, UNIT_ALIASES} = require('./lib/calculation');
const customConfig = require('./admin/jsonCustom.json');
const instanceConfig = require('./admin/jsonConfig.json');

function executeCustom(expression, data, customObj) {
	return new Function('data', 'originalData', '_system', 'instanceObj', 'customObj', '_socket', 'arrayIndex', 'globalData', '_changed', `return ${expression}`,
	)(data, {}, {}, {}, customObj, {}, 0, {}, false);
}

/**
 * Find the unit select of the price definition table in the instance settings.
 * @param {unknown} node - Part of the instance settings
 * @returns {any} The select definition
 */
function findUnitTypeSelect(node) {
	if (!node || typeof node !== 'object') return null;
	if (/** @type {any} */ (node).attr === 'unitType') return node;
	for (const value of Object.values(node)) {
		const found = findUnitTypeSelect(value);
		if (found) return found;
	}
	return null;
}

describe('unit piece for counters without a unit (#304)', () => {
	const units = buildUnitConfig();

	it('counts in pieces with factor 1', () => {
		assert.deepEqual(units.piece, {exponent: 0, category: 'Piece'});
		assert.equal(convertUnitValue(42, units.piece, units.piece), 42);
		assert.equal(areUnitsCompatible(units.piece, units.piece), true);
		assert.equal(areUnitsCompatible(units.piece, units.kWh), false);
		assert.equal(areUnitsCompatible(units.kWh, units.piece), false);
	});

	it('accepts common spellings of piece', () => {
		for (const unit of ['piece', 'pcs', 'PCS', 'pc', 'Stk', 'Stk.', 'Stück', 'pieces']) assert.equal(resolveUnit(unit, units), 'piece', unit);
	});

	it('accepts the same spellings in the state settings', () => {
		const validator = customConfig.items.selectedUnit.validator;
		const match = validator.match(/(\['pcs'[^\]]+\]), \['GW'/);
		assert.ok(match);
		assert.deepEqual(Function(`"use strict"; return ${match[1]};`)().sort(), Object.keys(UNIT_ALIASES).sort());
		for (const unit of ['Stück', 'pcs', 'Stk']) {
			assert.equal(executeCustom(validator, {enabled: true, selectedUnit: 'Detect automatically'}, {_id: 'heating.0.burnerStarts', common: {unit}}), true, unit);
		}
		assert.equal(executeCustom(validator, {enabled: true, selectedUnit: 'piece'}, {_id: 'heating.0.burnerStarts', common: {}}), true);
	});

	it('offers piece as unit of a price definition', () => {
		const select = findUnitTypeSelect(instanceConfig);
		assert.ok(select);
		assert.ok(select.options.some(option => option.value === 'piece'));
	});
});
