'use strict';

/**
 * Build the unit definitions supported by SourceAnalytix.
 * @param {object} helperUnits - Unit definitions from iobroker-adapter-helpers
 * @returns {Record<string, {exponent: number, category: string}>} Definitions indexed by unit symbol
 */
function buildUnitConfig(helperUnits) {
	const unitConfig = Object.create(null);
	const supportedCategories = {
		electricity: ['Watt', 'Watt_hour'],
		volume: ['Liter', 'Cubic_meter'],
		mass: ['Kilogram'],
		length: ['Meter'],
	};

	for (const [group, categories] of Object.entries(supportedCategories)) {
		for (const category of categories) {
			const definitions = helperUnits[group] && helperUnits[group][category];
			if (!Array.isArray(definitions)) continue;
			for (const definition of definitions) {
				unitConfig[definition.unit] = {
					exponent: definition.exponent,
					category,
				};
			}
		}
	}

	// The helper currently defines kilograms and grams, but not metric tonnes.
	unitConfig.t = {exponent: 6, category: 'Kilogram'};
	return unitConfig;
}

/**
 * Convert a cumulative value between supported decimal units.
 * @param {number} value - Source value
 * @param {{exponent: number, category: string}} sourceUnit - Source unit definition
 * @param {{exponent: number, category: string}} targetUnit - Target unit definition
 * @returns {number | null} Converted value, or null for incompatible units
 */
function convertUnitValue(value, sourceUnit, targetUnit) {
	if (
		!Number.isFinite(value)
		|| !sourceUnit
		|| !targetUnit
		|| !Number.isFinite(sourceUnit.exponent)
		|| !Number.isFinite(targetUnit.exponent)
	) {
		return null;
	}

	let categoryFactor = 1;
	if (sourceUnit.category !== targetUnit.category) {
		if (sourceUnit.category === 'Liter' && targetUnit.category === 'Cubic_meter') {
			categoryFactor = 1 / 1000;
		} else if (sourceUnit.category === 'Cubic_meter' && targetUnit.category === 'Liter') {
			categoryFactor = 1000;
		} else {
			return null;
		}
	}

	return value * categoryFactor * Math.pow(10, sourceUnit.exponent - targetUnit.exponent);
}

/**
 * @param {{date?: unknown, day?: unknown, week?: unknown, month?: unknown, quarter?: unknown, year?: unknown}} previous - Previous date identifiers
 * @param {{date?: unknown, day?: unknown, week?: unknown, month?: unknown, quarter?: unknown, year?: unknown}} current - Current date identifiers
 * @returns {{day: boolean, week: boolean, month: boolean, quarter: boolean, year: boolean}} Changed periods
 */
function getPeriodChanges(previous, current) {
	return {
		day: previous.date !== undefined || current.date !== undefined
			? previous.date !== current.date
			: previous.day !== current.day,
		week: previous.week !== current.week,
		month: previous.month !== current.month,
		quarter: previous.quarter !== current.quarter,
		year: previous.year !== current.year,
	};
}

/**
 * Resolve a configured number of decimals, falling back when it is not set.
 * An empty value inherits the fallback, a negative value disables rounding.
 * @param {unknown} value - Configured decimals
 * @param {number} fallback - Value used when nothing is configured
 * @returns {number} Decimals to apply, or -1 to keep the exact value
 */
function normalizeDecimals(value, fallback) {
	if (value === null || value === undefined || value === '') return fallback;
	const parsedValue = Number(value);
	if (!Number.isFinite(parsedValue)) return fallback;
	const decimals = Math.trunc(parsedValue);
	if (decimals < 0) return -1;
	return Math.min(decimals, 15);
}

/**
 * Round a calculated value to the configured number of decimals.
 * @param {unknown} value - Value to round
 * @param {number} decimals - Decimals to apply, negative keeps the exact value
 * @returns {number | null} Rounded value, or null when the input is not numeric
 */
function roundValue(value, decimals) {
	if (value === null || value === undefined || value === '') return null;
	const numericValue = Number(value);
	if (!Number.isFinite(numericValue)) return null;
	if (!Number.isFinite(Number(decimals)) || Number(decimals) < 0) return numericValue;
	const factor = Math.pow(10, Math.min(Math.trunc(Number(decimals)), 15));
	return Math.round(numericValue * factor) / factor;
}

/**
 * Local midnight of the day a rollover is processed on.
 * @param {Date} date - Local date of the rollover
 * @returns {number} Unix timestamp of the period boundary
 */
function getPeriodBoundaryTimestamp(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Timestamp the completed period is stamped with, so previous values are logged
 * inside the period they belong to instead of at the start of the new one.
 * @param {Date} date - Local date of the rollover
 * @returns {number} Unix timestamp of 23:59:59 on the last day of the completed period
 */
function getPreviousPeriodTimestamp(date) {
	return getPeriodBoundaryTimestamp(date) - 1000;
}

/**
 * Validate period identifiers restored from persistent adapter state.
 * @param {unknown} value - Persisted period snapshot
 * @returns {{date?: string, day: string, week: string, month: string, quarter: number, year: number} | null} Normalized snapshot
 */
function normalizePeriodSnapshot(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const snapshot = Object.assign({
		date: undefined,
		day: undefined,
		week: undefined,
		month: undefined,
		quarter: undefined,
		year: undefined,
	}, value);
	const quarter = Number(snapshot.quarter);
	const year = Number(snapshot.year);
	if (
		typeof snapshot.day !== 'string'
		|| snapshot.day === ''
		|| typeof snapshot.week !== 'string'
		|| snapshot.week === ''
		|| typeof snapshot.month !== 'string'
		|| snapshot.month === ''
		|| !Number.isInteger(quarter)
		|| quarter < 1
		|| quarter > 4
		|| !Number.isInteger(year)
		|| year < 1970
	) {
		return null;
	}
	if (snapshot.date !== undefined && (typeof snapshot.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date))) {
		return null;
	}
	return {
		...(snapshot.date === undefined ? {} : {date: snapshot.date}),
		day: snapshot.day,
		week: snapshot.week,
		month: snapshot.month,
		quarter,
		year,
	};
}

/**
 * Initialize empty period starts from the current cumulative reading.
 * Legacy custom dialogs stored empty number fields as zero, so zero is considered
 * unset only during the first activation.
 * @param {object} startValues - Configured period starts
 * @param {number} reading - Current normalized cumulative reading
 * @param {boolean} firstActivation - Whether SourceAnalytix has never processed this source
 * @returns {{start_day: unknown, start_week: unknown, start_month: unknown, start_quarter: unknown, start_year: unknown}} Period starts
 */
function initializePeriodStartValues(startValues, reading, firstActivation) {
	const fields = ['start_day', 'start_week', 'start_month', 'start_quarter', 'start_year'];
	const initialized = {
		start_day: undefined,
		start_week: undefined,
		start_month: undefined,
		start_quarter: undefined,
		start_year: undefined,
	};
	for (const field of fields) {
		const configured = startValues ? startValues[field] : undefined;
		const numericValue = configured === '' || configured === null || configured === undefined
			? null
			: Number(configured);
		initialized[field] = firstActivation && Number.isFinite(reading) && (!Number.isFinite(numericValue) || numericValue === 0)
			? reading
			: configured;
	}
	return initialized;
}

/**
 * Build the optional current-year state definitions controlled by adapter settings.
 * @param {object} config - Adapter configuration
 * @param {string[]} weekdays - Localized weekday state IDs
 * @param {string[]} months - Localized month state IDs
 * @returns {Array<{stateRoot: string, name: string, enabled: boolean, collection: string}>} State definitions
 */
function getCurrentYearPeriodStateDefinitions(config, weekdays, months) {
	const definitions = [];
	for (const weekday of weekdays) {
		definitions.push({
			stateRoot: `currentWeek.${weekday}`,
			name: weekday,
			enabled: config.currentYearDays === true,
			collection: 'currentWeek',
		});
		definitions.push({
			stateRoot: `previousWeek.${weekday}`,
			name: weekday,
			enabled: config.currentYearDays === true && config.currentYearPrevious === true,
			collection: 'previousWeek',
		});
	}
	for (let yearWeek = 1; yearWeek < 54; yearWeek++) {
		const weekNumber = yearWeek.toString().padStart(2, '0');
		definitions.push({
			stateRoot: `weeks.${weekNumber}`,
			name: weekNumber,
			enabled: config.currentYearWeek === true,
			collection: 'weeks',
		});
	}
	for (const month of months) {
		definitions.push({
			stateRoot: `months.${month}`,
			name: month,
			enabled: config.currentYearMonth === true,
			collection: 'months',
		});
	}
	for (let quarter = 1; quarter < 5; quarter++) {
		definitions.push({
			stateRoot: `quarters.Q${quarter}`,
			name: `Q${quarter}`,
			enabled: config.currentYearQuarter === true,
			collection: 'quarters',
		});
	}
	return definitions;
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

/**
 * Calculate full monthly basic-price charges for the current calendar periods.
 * The first charge occurs when the tariff becomes valid; subsequent charges occur
 * at the beginning of each calendar month with the price valid at that time.
 * @param {Array<{ts: number, price: number}>} history - Ordered basic-price history
 * @param {Date} date - Date for the current calculation
 * @returns {{priceDay: number, priceWeek: number, priceMonth: number, priceQuarter: number, priceYear: number}} Basic-price totals
 */
function calculateHistoricalBasicPriceTotals(history, date) {
	const totals = {priceDay: 0, priceWeek: 0, priceMonth: 0, priceQuarter: 0, priceYear: 0};
	if (!Array.isArray(history) || !(date instanceof Date) || Number.isNaN(date.getTime())) return totals;

	const calculationTimestamp = date.getTime();
	const entries = history
		.filter(entry => entry && Number.isFinite(Number(entry.ts)) && Number(entry.ts) > 0 && Number.isFinite(Number(entry.price)))
		.map(entry => ({ts: Number(entry.ts), price: Number(entry.price)}))
		.sort((a, b) => a.ts - b.ts);
	const firstEntry = entries.find(entry => entry.ts <= calculationTimestamp);
	if (!firstEntry) return totals;

	const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const isoWeekday = date.getDay() || 7;
	const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() - isoWeekday + 1).getTime();
	const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
	const quarterStart = new Date(date.getFullYear(), date.getMonth() - (date.getMonth() % 3), 1).getTime();
	const yearStart = new Date(date.getFullYear(), 0, 1).getTime();
	const periodStarts = {
		priceDay: dayStart,
		priceWeek: weekStart,
		priceMonth: monthStart,
		priceQuarter: quarterStart,
		priceYear: yearStart,
	};

	const firstDate = new Date(firstEntry.ts);
	const chargeMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
	const finalMonthTimestamp = monthStart;
	while (chargeMonth.getTime() <= finalMonthTimestamp) {
		const isFirstMonth = chargeMonth.getFullYear() === firstDate.getFullYear() && chargeMonth.getMonth() === firstDate.getMonth();
		const chargeTimestamp = isFirstMonth ? firstEntry.ts : chargeMonth.getTime();
		if (chargeTimestamp <= calculationTimestamp) {
			const priceEntry = entries.filter(entry => entry.ts <= chargeTimestamp).at(-1);
			if (priceEntry) {
				for (const [key, periodStart] of Object.entries(periodStarts)) {
					if (chargeTimestamp >= periodStart) totals[key] += priceEntry.price;
				}
			}
		}
		chargeMonth.setMonth(chargeMonth.getMonth() + 1);
	}

	return totals;
}

/**
 * Calculate variable cost totals from one cumulative reading and its period starts.
 * @param {number | string} reading - Current cumulative reading
 * @param {object} startValues - Period start readings
 * @param {number | string} unitPrice - Price per consumed unit
 * @returns {{priceDay: number, priceWeek: number, priceMonth: number, priceQuarter: number, priceYear: number}} Variable costs without a basic price
 */
function calculateVariablePriceTotals(reading, startValues, unitPrice) {
	const parseNumber = value => {
		if (value === null || value === undefined) return null;
		if (typeof value === 'string' && value.trim() === '') return null;
		const parsed = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	};
	const readingNumber = parseNumber(reading);
	const unitPriceNumber = parseNumber(unitPrice);
	const safeReading = readingNumber === null ? 0 : readingNumber;
	const safeUnitPrice = unitPriceNumber === null ? 0 : unitPriceNumber;
	const costSince = key => {
		const start = parseNumber(startValues && startValues[key]);
		return safeUnitPrice * (safeReading - (start === null ? safeReading : start));
	};

	return {
		priceDay: costSince('start_day'),
		priceWeek: costSince('start_week'),
		priceMonth: costSince('start_month'),
		priceQuarter: costSince('start_quarter'),
		priceYear: costSince('start_year'),
	};
}

/**
 * Convert legacy accumulated costs to variable-only totals.
 * @param {object} legacyTotals - Totals stored by schema version 1
 * @param {object} basicTotals - Basic-price shares for the same periods
 * @param {object} fallbackTotals - Totals rebuilt from fixed price and period starts
 * @param {string} priceSource - static, state or selector
 * @param {number} priceHistoryLength - Number of known historical prices
 * @param {boolean} hasBasicPrice - Whether the source includes a monthly basic price
 * @returns {object} Variable-only cost totals
 */
function migrateLegacyVariableCostTotals(legacyTotals, basicTotals, fallbackTotals, priceSource, priceHistoryLength, hasBasicPrice) {
	if (priceSource === 'static' && priceHistoryLength <= 1) return {...fallbackTotals};
	if (!hasBasicPrice) return {...legacyTotals};

	const migratedTotals = {};
	for (const key of Object.keys(legacyTotals)) {
		const legacyValue = Number(legacyTotals[key]);
		const basicValue = Number(basicTotals[key]);
		migratedTotals[key] = (Number.isFinite(legacyValue) ? legacyValue : 0) - (Number.isFinite(basicValue) ? basicValue : 0);
	}

	const fallbackValues = Object.values(fallbackTotals).map(Number).filter(Number.isFinite);
	if (fallbackValues.length === 0 || fallbackValues.every(value => value === 0)) return {...legacyTotals};
	const distanceFromFallback = totals => Object.keys(legacyTotals).reduce((distance, key) => {
		const total = Number(totals[key]);
		const fallback = Number(fallbackTotals[key]);
		return Number.isFinite(total) && Number.isFinite(fallback) ? distance + Math.abs(total - fallback) : distance;
	}, 0);

	return distanceFromFallback(migratedTotals) < distanceFromFallback(legacyTotals) ? migratedTotals : {...legacyTotals};
}

/**
 * Normalize a raw power reading before it is integrated over an interval.
 * Some inverters report a strongly negative power while they are switched off.
 * Such a reading is clamped to zero instead of being dropped, so the interval
 * still advances and contributes no energy. Dropping it would keep the last
 * positive power as the baseline and integrate it across the whole downtime.
 * @param {number} value - Raw power reading in watts
 * @param {boolean} ignoreNegativeValues - Whether negative readings count as zero
 * @returns {number} Power reading to use for the calculation
 */
function normalizePowerReading(value, ignoreNegativeValues) {
	if (!ignoreNegativeValues || !Number.isFinite(value)) return value;
	return value < 0 ? 0 : value;
}

/**
 * Calculate the energy represented by two timestamped power readings.
 * @param {number} previousPower - Power at the beginning of the interval in watts
 * @param {number} currentPower - Power at the end of the interval in watts
 * @param {number} previousTimestamp - Beginning of the interval in milliseconds
 * @param {number} currentTimestamp - End of the interval in milliseconds
 * @param {boolean} averagePowerValues - Whether to average both power readings
 * @returns {number | null} Energy in watt-hours, or null for invalid input
 */
function calculatePowerEnergy(previousPower, currentPower, previousTimestamp, currentTimestamp, averagePowerValues) {
	if (
		!Number.isFinite(previousPower)
		|| !Number.isFinite(currentPower)
		|| !Number.isFinite(previousTimestamp)
		|| !Number.isFinite(currentTimestamp)
		|| previousTimestamp <= 0
		|| currentTimestamp < previousTimestamp
	) {
		return null;
	}

	const intervalPower = averagePowerValues
		? (previousPower + currentPower) / 2
		: previousPower;
	return (currentTimestamp - previousTimestamp) * intervalPower / 3600000;
}

module.exports = {
	buildUnitConfig,
	calculateBasicPriceTotals,
	calculateHistoricalBasicPriceTotals,
	calculateVariablePriceTotals,
	calculatePowerEnergy,
	classifyCumulativeReading,
	convertUnitValue,
	getCurrentYearPeriodStateDefinitions,
	getPeriodBoundaryTimestamp,
	getPeriodChanges,
	getPreviousPeriodTimestamp,
	initializePeriodStartValues,
	migrateLegacyVariableCostTotals,
	normalizeDecimals,
	normalizePeriodSnapshot,
	normalizePowerReading,
	resolveCumulativeReading,
	roundValue,
};
