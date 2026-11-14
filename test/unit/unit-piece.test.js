'use strict';

const assert = require('node:assert/strict');
const {areUnitsCompatible, buildUnitConfig, convertUnitValue, resolveUnit} = require('../../lib/calculation');
const instanceConfig = require('../../admin/jsonConfig.json');

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

	it('offers piece as unit of a price definition', () => {
		const select = findUnitTypeSelect(instanceConfig);
		assert.ok(select);
		assert.ok(select.options.some(option => option.value === 'piece'));
	});
});
