'use strict';

/**
 * Pure helpers for the instant actions of a source (sendTo commands, settings page #1269):
 * align meter reading (#640), meter swapped, recalculate costs (#947) and delete data (#1265).
 */

const {getIsoWeek} = require('./calculation');
const {calculatePriceDelta} = require('./dynamic-pricing');

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

/**
 * Monday 00:00 (local time) of an ISO week.
 * @param {number} weekYear - ISO week-numbering year
 * @param {number} week - ISO week number
 * @returns {Date} Start of the week
 */
function getIsoWeekStart(weekYear, week) {
	const jan4 = new Date(weekYear, 0, 4);
	const jan4Weekday = jan4.getDay() || 7;
	return new Date(weekYear, 0, 4 - jan4Weekday + 1 + (week - 1) * 7);
}

/**
 * @param {Date} date - Local date
 * @param {number} [days] - Days to add
 * @returns {number} Local midnight of the date plus the days
 */
function midnight(date, days = 0) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/**
 * List all period states whose costs are recalculated from a date (#947).
 * Paths are relative to the output folder of the source; `{cat}` stands for the category
 * (consumed/delivered for the quantity, costs/earnings for the money).
 * @param {object} options - Options
 * @param {number} options.from - Recalculate periods that end after this timestamp
 * @param {number} options.now - Current timestamp
 * @param {object} options.config - Instance configuration (currentYear*, store_*)
 * @param {string[]} options.weekdays - Weekday state names, index = Date#getDay()
 * @param {string[]} options.months - Month state names, index = Date#getMonth()
 * @returns {Array<{path: string, kind: string, start: number, end: number}>} Affected periods, end capped at now
 */
function listRecalcPeriods({from, now, config, weekdays, months}) {
	const nowDate = new Date(now);
	const year = nowDate.getFullYear();
	const periods = [];
	const add = (path, kind, start, end) => {
		const cappedEnd = Math.min(end, now);
		if (cappedEnd <= from || start >= cappedEnd) return;
		periods.push({path, kind, start, end: cappedEnd});
	};

	const today = midnight(nowDate);
	const isoWeekday = nowDate.getDay() || 7;
	const weekStart = midnight(nowDate, -(isoWeekday - 1));
	const monthStart = new Date(year, nowDate.getMonth(), 1).getTime();
	const quarterMonth = nowDate.getMonth() - (nowDate.getMonth() % 3);
	const quarterStart = new Date(year, quarterMonth, 1).getTime();
	const yearStart = new Date(year, 0, 1).getTime();

	add('currentYear.{cat}.01_currentDay', 'day', today, now);
	add('currentYear.{cat}.02_currentWeek', 'week', weekStart, now);
	add('currentYear.{cat}.03_currentMonth', 'month', monthStart, now);
	add('currentYear.{cat}.04_currentQuarter', 'quarter', quarterStart, now);
	add('currentYear.{cat}.05_currentYear', 'year', yearStart, now);

	if (config.currentYearPrevious) {
		add('currentYear.{cat}.01_previousDay', 'day', midnight(nowDate, -1), today);
		add('currentYear.{cat}.02_previousWeek', 'week', midnight(new Date(weekStart), -7), weekStart);
		add('currentYear.{cat}.03_previousMonth', 'month', new Date(year, nowDate.getMonth() - 1, 1).getTime(), monthStart);
		add('currentYear.{cat}.04_previousQuarter', 'quarter', new Date(year, quarterMonth - 3, 1).getTime(), quarterStart);
		add('currentYear.{cat}.05_previousYear', 'year', new Date(year - 1, 0, 1).getTime(), yearStart);
	}

	if (config.currentYearDays) {
		for (let offset = 0; offset < 7; offset++) {
			const day = new Date(weekStart);
			day.setDate(day.getDate() + offset);
			add(`currentYear.{cat}.currentWeek.${weekdays[day.getDay()]}`, 'day', day.getTime(), midnight(day, 1));
			if (config.currentYearPrevious) {
				const previousDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 7);
				add(`currentYear.{cat}.previousWeek.${weekdays[previousDay.getDay()]}`, 'day', previousDay.getTime(), midnight(previousDay, 1));
			}
		}
	}

	const addYearCollections = (root, collectionYear, weeks, monthsEnabled, quarters) => {
		if (weeks) {
			for (let week = 1; week <= 53; week++) {
				const start = getIsoWeekStart(collectionYear, week);
				if (getIsoWeek(start).weekYear !== collectionYear) break;
				add(`${root}.weeks.${week.toString().padStart(2, '0')}`, 'week', start.getTime(), midnight(start, 7));
			}
		}
		if (monthsEnabled) {
			for (let month = 0; month < 12; month++) {
				add(`${root}.months.${months[month]}`, 'month', new Date(collectionYear, month, 1).getTime(), new Date(collectionYear, month + 1, 1).getTime());
			}
		}
		if (quarters) {
			for (let quarter = 0; quarter < 4; quarter++) {
				add(`${root}.quarters.Q${quarter + 1}`, 'quarter', new Date(collectionYear, quarter * 3, 1).getTime(), new Date(collectionYear, quarter * 3 + 3, 1).getTime());
			}
		}
	};

	addYearCollections('currentYear.{cat}', year, !!config.currentYearWeek, !!config.currentYearMonth, !!config.currentYearQuarter);

	const archive = config.store_weeks || config.store_months || config.store_quarters;
	if (archive) {
		const firstYear = new Date(from).getFullYear() - 1;
		for (let archiveYear = Math.max(firstYear, 2000); archiveYear <= year; archiveYear++) {
			add(`${archiveYear}.{cat}Cumulative`, 'year', new Date(archiveYear, 0, 1).getTime(), new Date(archiveYear + 1, 0, 1).getTime());
			addYearCollections(`${archiveYear}.{cat}`, archiveYear, !!config.store_weeks, !!config.store_months, !!config.store_quarters);
		}
	}
	return periods;
}

/**
 * All monthly basic-price charges up to a timestamp, with the same rules as
 * calculateHistoricalBasicPriceTotals: the first charge when the tariff becomes valid,
 * then one charge at the start of each calendar month with the price valid then.
 * @param {Array<{ts: number, price: number}>} history - Basic-price history
 * @param {number} untilTs - Last timestamp to consider
 * @returns {Array<{ts: number, price: number}>} Charges in time order
 */
function getBasicPriceCharges(history, untilTs) {
	if (!Array.isArray(history)) return [];
	const entries = history
		.filter(entry => entry && Number.isFinite(Number(entry.ts)) && Number(entry.ts) > 0 && Number.isFinite(Number(entry.price)))
		.map(entry => ({ts: Number(entry.ts), price: Number(entry.price)}))
		.sort((a, b) => a.ts - b.ts);
	const firstEntry = entries[0];
	if (!firstEntry || firstEntry.ts > untilTs) return [];
	const charges = [];
	const firstDate = new Date(firstEntry.ts);
	const chargeMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
	while (chargeMonth.getTime() <= untilTs) {
		const isFirstMonth = chargeMonth.getFullYear() === firstDate.getFullYear() && chargeMonth.getMonth() === firstDate.getMonth();
		const chargeTs = isFirstMonth ? firstEntry.ts : chargeMonth.getTime();
		if (chargeTs <= untilTs) {
			const priceEntry = entries.filter(entry => entry.ts <= chargeTs).at(-1);
			if (priceEntry) charges.push({ts: chargeTs, price: priceEntry.price});
		}
		chargeMonth.setMonth(chargeMonth.getMonth() + 1);
	}
	return charges;
}

/**
 * Costs of one period: the consumption is spread evenly over the period and priced with the
 * price history, plus all basic-price charges inside the period.
 * @param {object} input - Period and prices
 * @param {number} input.consumption - Consumption of the period
 * @param {number} input.start - Period start
 * @param {number} input.end - Period end (capped at now)
 * @param {Array<{ts: number, price: number}>} input.priceHistory - Unit-price history
 * @param {number | string | null | undefined} input.fallbackPrice - Price if the history has no entry yet
 * @param {Array<{ts: number, price: number}>} [input.basicCharges] - Basic-price charges, empty if not booked
 * @returns {{variable: number, basic: number, total: number} | null} Costs, null if no price is known
 */
function calculatePeriodCosts({consumption, start, end, priceHistory, fallbackPrice, basicCharges = []}) {
	const variable = consumption === 0 ? 0 : calculatePriceDelta(priceHistory || [], consumption, start, end, fallbackPrice);
	if (variable === null) return null;
	let basic = 0;
	for (const charge of basicCharges) {
		if (charge.ts >= start && charge.ts < end) basic += charge.price;
	}
	return {variable, basic, total: variable + basic};
}

/**
 * Summarise an output folder for the "Delete data" dialog (#1265).
 * @param {string} root - Full output root, e.g. sourceanalytix.0.house
 * @param {string[]} stateIds - Full IDs of the states below the root
 * @returns {{states: number, years: number[]}} Number of states and archive years
 */
function summarizeOutputTree(root, stateIds) {
	const years = new Set();
	let states = 0;
	for (const id of stateIds) {
		if (id !== root && !id.startsWith(`${root}.`)) continue;
		states++;
		const match = /^(\d{4})(\.|$)/.exec(id.slice(root.length + 1));
		if (match) years.add(Number(match[1]));
	}
	return {states, years: [...years].sort((a, b) => a - b)};
}

module.exports = {
	calculatePeriodCosts,
	getBasicPriceCharges,
	getIsoWeekStart,
	isOldMeterReading,
	listRecalcPeriods,
	planAlignMeterReading,
	planMeterSwap,
	summarizeOutputTree,
};
