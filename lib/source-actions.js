'use strict';

/**
 * Pure helpers for the instant actions of a source (sendTo commands, settings page #1269):
 * align meter reading (#640), meter swapped, recalculate costs (#947) and delete data (#1265).
 */

const startKeys = ['start_day', 'start_week', 'start_month', 'start_quarter', 'start_year'];

/**
 * @param {unknown} value - Value to check
 * @returns {value is number} Whether the value is a finite number
 */
function isFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Plan the action "Align meter reading" (#640): the total jumps to the value shown by the
 * meter, the offset follows so the next device value continues from there, and all period
 * start values move by the same amount so the consumption of the running periods is unchanged.
 * @param {object} input - Current values of the source
 * @param {number | null} input.target - Meter reading entered by the user (calculation unit)
 * @param {number} input.cumulative - Current total (cumulativeReading)
 * @param {number | null} input.offset - Current valueAtDeviceReset
 * @param {number | null} input.rawReading - Current device value converted to the calculation unit, null if unknown
 * @param {object} input.startValues - Current start values (start_day … start_year)
 * @returns {{valid: boolean, error?: string, cumulative?: number, offset?: number, delta?: number, startValues?: object}} Plan
 */
function planAlignMeterReading({target, cumulative, offset, rawReading, startValues}) {
	if (!isFiniteNumber(target)) return {valid: false, error: 'invalidValue'};
	if (target < 0) return {valid: false, error: 'negativeValue'};
	const known = isFiniteNumber(cumulative) ? cumulative : 0;
	const delta = target - known;
	const currentOffset = typeof offset === 'number' && Number.isFinite(offset) ? offset : 0;
	const newOffset = typeof rawReading === 'number' && Number.isFinite(rawReading) ? target - rawReading : currentOffset + delta;
	const shifted = {};
	for (const key of startKeys) {
		const value = startValues ? startValues[key] : undefined;
		if (isFiniteNumber(value)) shifted[key] = value + delta;
	}
	return {valid: true, cumulative: target, offset: newOffset, delta, startValues: shifted};
}

module.exports = {
	planAlignMeterReading,
};
