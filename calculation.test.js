'use strict';

const assert = require('node:assert/strict');
const {calculatePowerEnergy, normalizePowerReading} = require('./lib/calculation');

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

describe('Negative power readings', () => {
	const start = Date.UTC(2026, 0, 1, 20);
	const fifteenMinutesLater = start + 15 * 60 * 1000;

	it('passes readings through unchanged while the option is disabled', () => {
		assert.equal(normalizePowerReading(-3000, false), -3000);
		assert.equal(normalizePowerReading(250, false), 250);
	});

	it('treats a negative reading as zero watts while the option is enabled', () => {
		assert.equal(normalizePowerReading(-3000, true), 0);
	});

	it('leaves positive readings and zero untouched', () => {
		assert.equal(normalizePowerReading(250, true), 250);
		assert.equal(normalizePowerReading(0, true), 0);
	});

	it('does not coerce non-finite readings, so they stay detectable as invalid', () => {
		assert.ok(Number.isNaN(normalizePowerReading(Number.NaN, true)));
	});

	it('contributes no energy once a switched-off inverter is clamped', () => {
		const clamped = normalizePowerReading(-3000, true);
		assert.equal(calculatePowerEnergy(clamped, clamped, start, fifteenMinutesLater, false), 0);
		assert.equal(calculatePowerEnergy(clamped, clamped, start, fifteenMinutesLater, true), 0);
	});

	it('would otherwise subtract energy from the total', () => {
		assert.equal(calculatePowerEnergy(-3000, -3000, start, fifteenMinutesLater, false), -750);
	});
});
