'use strict';

const assert = require('node:assert/strict');
const {calculatePowerEnergy} = require('./lib/calculation');

describe('Power-to-energy calculation', () => {
	const start = Date.UTC(2026, 0, 1, 10);
	const fifteenMinutesLater = start + 15 * 60 * 1000;

	it('uses the previous power value by default', () => {
		assert.equal(calculatePowerEnergy(100, 300, start, fifteenMinutesLater, false), 25);
	});

	it('averages both power values when enabled', () => {
		assert.equal(calculatePowerEnergy(100, 300, start, fifteenMinutesLater, true), 50);
	});

	it('includes intervals that start at zero watts when averaging', () => {
		assert.equal(calculatePowerEnergy(0, 300, start, fifteenMinutesLater, true), 37.5);
	});

	it('rejects readings whose timestamp moves backwards', () => {
		assert.equal(calculatePowerEnergy(100, 300, fifteenMinutesLater, start, true), null);
	});
});
