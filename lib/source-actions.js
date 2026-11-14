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

/**
 * Plan the action "Meter swapped": the total continues from the end reading of the old meter,
 * the new meter counts on from its start reading. The consumption between the last known total
 * and the end reading belongs to the running periods.
 * @param {object} input - Values entered by the user and the current total
 * @param {number | null} input.oldEnd - Total at the removal of the old meter (calculation unit)
 * @param {number | null} input.newStart - Reading of the new meter at installation (calculation unit)
 * @param {number} input.cumulative - Current total (cumulativeReading)
 * @returns {{valid: boolean, error?: string, cumulative?: number, offset?: number, addedConsumption?: number}} Plan
 */
function planMeterSwap({oldEnd, newStart, cumulative}) {
	if (!isFiniteNumber(oldEnd)) return {valid: false, error: 'invalidOldEnd'};
	if (!isFiniteNumber(newStart) || newStart < 0) return {valid: false, error: 'invalidNewStart'};
	const known = isFiniteNumber(cumulative) ? cumulative : 0;
	// Tolerate rounding of the displayed total
	if (oldEnd < known - 1e-9) return {valid: false, error: 'oldEndBelowTotal'};
	return {valid: true, cumulative: oldEnd, offset: oldEnd - newStart, addedConsumption: oldEnd - known};
}

/**
 * Decide whether a device value after "Meter swapped" still comes from the old meter.
 * A value belongs to the new meter once it is closer to the start reading of the new meter
 * than to the last value of the old one.
 * @param {number} rawReading - Device value converted to the calculation unit
 * @param {{rawAtSwap: number | null, newStart: number}} pendingSwap - Remembered swap
 * @returns {boolean} True if the value is from the old meter and must be ignored
 */
function isOldMeterReading(rawReading, pendingSwap) {
	if (!pendingSwap || !isFiniteNumber(rawReading)) return false;
	const rawAtSwap = pendingSwap.rawAtSwap;
	if (typeof rawAtSwap !== 'number' || !Number.isFinite(rawAtSwap)) return false;
	return Math.abs(rawReading - rawAtSwap) < Math.abs(rawReading - pendingSwap.newStart);
}

module.exports = {
	isOldMeterReading,
	planAlignMeterReading,
	planMeterSwap,
};
