'use strict';

/**
 * @param {{day?: unknown, week?: unknown, month?: unknown, quarter?: unknown, year?: unknown}} previous - Previous date identifiers
 * @param {{day?: unknown, week?: unknown, month?: unknown, quarter?: unknown, year?: unknown}} current - Current date identifiers
 * @returns {{day: boolean, week: boolean, month: boolean, quarter: boolean, year: boolean}} Changed periods
 */
function getPeriodChanges(previous, current) {
	return {
		day: previous.day !== current.day,
		week: previous.week !== current.week,
		month: previous.month !== current.month,
		quarter: previous.quarter !== current.quarter,
		year: previous.year !== current.year,
	};
}

/**
 * Classify a new cumulative reading before it changes the high-water mark.
 * @param {number} reading - Converted cumulative reading
 * @param {number} previousReading - Last accepted cumulative reading
 * @param {boolean} resetDetectionEnabled - Whether device resets should be detected
 * @param {number} threshold - Configured reset threshold in the target unit
 * @returns {{type: 'normal' | 'jitter' | 'reset' | 'decrease', decrease: number}} Reading classification
 */
function classifyCumulativeReading(reading, previousReading, resetDetectionEnabled, threshold) {
	if (!Number.isFinite(reading) || !Number.isFinite(previousReading) || reading >= previousReading) {
		return {type: 'normal', decrease: 0};
	}

	const decrease = previousReading - reading;
	const normalizedThreshold = Number.isFinite(threshold) && threshold >= 0 ? threshold : 0;
	if (resetDetectionEnabled && decrease <= normalizedThreshold) return {type: 'jitter', decrease};
	if (resetDetectionEnabled) return {type: 'reset', decrease};
	return {type: 'decrease', decrease};
}

/**
 * Resolve a raw cumulative meter reading against the persisted reset offset.
 * @param {number} reading - Raw converted device reading
 * @param {number} resetOffset - Persisted offset from earlier device resets
 * @param {number} previousReading - Last accepted cumulative reading
 * @param {boolean} resetDetectionEnabled - Whether device resets should be detected
 * @param {number} threshold - Maximum backwards jitter in the target unit
 * @returns {{type: 'normal' | 'jitter' | 'reset' | 'decrease' | 'invalid', reading: number, resetOffset: number, decrease: number}} Resolved cumulative reading and offset
 */
function resolveCumulativeReading(reading, resetOffset, previousReading, resetDetectionEnabled, threshold) {
	const normalizedOffset = Number.isFinite(resetOffset) ? resetOffset : 0;
	if (!Number.isFinite(reading)) {
		return {
			type: 'invalid',
			decrease: 0,
			reading: Number.isFinite(previousReading) ? previousReading : 0,
			resetOffset: normalizedOffset,
		};
	}
	const cumulativeReading = reading + normalizedOffset;
	if (!Number.isFinite(cumulativeReading)) {
		return {
			type: 'invalid',
			decrease: 0,
			reading: Number.isFinite(previousReading) ? previousReading : 0,
			resetOffset: normalizedOffset,
		};
	}
	const classification = classifyCumulativeReading(cumulativeReading, previousReading, resetDetectionEnabled, threshold);

	if (classification.type === 'jitter') {
		return {...classification, reading: previousReading, resetOffset: normalizedOffset};
	}
	if (classification.type === 'reset') {
		const nextOffset = previousReading - reading;
		return {...classification, reading: previousReading, resetOffset: nextOffset};
	}
	return {...classification, reading: cumulativeReading, resetOffset: normalizedOffset};
}

/**
 * Calculate accumulated calendar shares of a monthly basic price.
 * A month is charged when it starts; day and week values use daily calendar shares.
 * @param {number} monthlyPrice - Basic price per calendar month
 * @param {Date} date - Date for the current calculation
 * @returns {{priceDay: number, priceWeek: number, priceMonth: number, priceQuarter: number, priceYear: number}} Basic-price totals
 */
function calculateBasicPriceTotals(monthlyPrice, date) {
	if (!Number.isFinite(monthlyPrice) || monthlyPrice === 0 || !(date instanceof Date) || Number.isNaN(date.getTime())) {
		return {priceDay: 0, priceWeek: 0, priceMonth: 0, priceQuarter: 0, priceYear: 0};
	}

	const dailyPrice = value => monthlyPrice / new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
	const priceDay = dailyPrice(date);
	const isoWeekday = date.getDay() || 7;
	let priceWeek = 0;
	for (let offset = isoWeekday - 1; offset >= 0; offset--) {
		const weekDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset, 12);
		priceWeek += dailyPrice(weekDate);
	}

	return {
		priceDay,
		priceWeek,
		priceMonth: monthlyPrice,
		priceQuarter: monthlyPrice * ((date.getMonth() % 3) + 1),
		priceYear: monthlyPrice * (date.getMonth() + 1),
	};
}

module.exports = {
	calculateBasicPriceTotals,
	classifyCumulativeReading,
	getPeriodChanges,
	resolveCumulativeReading,
};
