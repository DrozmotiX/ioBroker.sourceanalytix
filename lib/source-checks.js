'use strict';

/**
 * Checks of source settings that are shared by the adapter (log at start) and the
 * custom dialog (validators in admin/jsonCustom.json mirror these rules).
 */

const START_FIELDS = ['start_day', 'start_week', 'start_month', 'start_quarter', 'start_year'];

/**
 * Parse a start value as entered in the custom dialog (#1267).
 * Comma and dot are accepted as decimal mark; thousands separators are not.
 * @param {unknown} value - Configured start value
 * @returns {number | null} Parsed value, null when empty, NaN when invalid
 */
function parseStartValueInput(value) {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
	if (typeof value !== 'string') return NaN;
	const trimmed = value.trim();
	if (trimmed === '') return null;
	return /^\d+([.,]\d+)?$/.test(trimmed) ? Number(trimmed.replace(',', '.')) : NaN;
}

/**
 * Local start of the running day, ISO week (Monday), month, quarter and year.
 * @param {Date} date - Current local date
 * @returns {Record<string, number>} Start timestamps indexed by start value field
 */
function getPeriodStartTimestamps(date) {
	const year = date.getFullYear();
	const month = date.getMonth();
	const day = date.getDate();
	return {
		start_day: new Date(year, month, day).getTime(),
		start_week: new Date(year, month, day - ((date.getDay() || 7) - 1)).getTime(),
		start_month: new Date(year, month, 1).getTime(),
		start_quarter: new Date(year, month - (month % 3), 1).getTime(),
		start_year: new Date(year, 0, 1).getTime(),
	};
}

/**
 * Check configured start values against the current total and against each other (#1267).
 * A period that began earlier cannot have a larger start value than a period that began
 * later. The week is placed by its start date, so it can lie before the month or year.
 * @param {Record<string, unknown>} startValues - Configured start values
 * @param {number | null | undefined} reading - Current total in the unit of the price definition, if known
 * @param {Date} date - Current local date
 * @returns {Array<{field: string, problem: 'format' | 'aboveReading' | 'order', other?: string}>} Problems found
 */
function checkStartValues(startValues, reading, date) {
	const problems = [];
	const values = Object.fromEntries([]);
	for (const field of START_FIELDS) {
		const value = parseStartValueInput(startValues ? startValues[field] : undefined);
		if (value === null) continue;
		if (!Number.isFinite(value) || value < 0) {
			problems.push(startValueProblem(field, 'format'));
			continue;
		}
		values[field] = value;
		if (Number.isFinite(reading) && value > Number(reading) + tolerance(Number(reading))) {
			problems.push(startValueProblem(field, 'aboveReading'));
		}
	}
	const starts = getPeriodStartTimestamps(date);
	const fields = Object.keys(values);
	for (let i = 0; i < fields.length; i++) {
		for (let j = i + 1; j < fields.length; j++) {
			const [earlier, later] = starts[fields[i]] <= starts[fields[j]] ? [fields[i], fields[j]] : [fields[j], fields[i]];
			if (values[earlier] > values[later] + tolerance(values[later])) {
				problems.push(startValueProblem(earlier, 'order', later));
			} else if (starts[earlier] === starts[later] && values[later] > values[earlier] + tolerance(values[earlier])) {
				// Periods that began at the same moment need the same start value
				problems.push(startValueProblem(later, 'order', earlier));
			}
		}
	}
	return problems;
}

/**
 * @param {string} field - Start value field
 * @param {'format' | 'aboveReading' | 'order'} problem - Kind of problem
 * @param {string} [other] - Start value field it conflicts with
 * @returns {{field: string, problem: 'format' | 'aboveReading' | 'order', other?: string}} Problem entry
 */
function startValueProblem(field, problem, other) {
	return other ? {field, problem, other} : {field, problem};
}

/**
 * @param {number} value - Compared value
 * @returns {number} Rounding tolerance for comparisons
 */
function tolerance(value) {
	return 1e-9 * Math.max(1, Math.abs(value));
}

module.exports = {
	START_FIELDS,
	checkStartValues,
	getPeriodStartTimestamps,
	parseStartValueInput,
};
