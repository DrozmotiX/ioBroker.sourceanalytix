'use strict';

/**
 * Units supported by SourceAnalytix, grouped by category.
 * The exponent is the power of ten relative to the base unit of the category
 * (W, Wh, m³, l, g, m). Cubic units scale with the cube of the length (1 m³ = 1000 dm³),
 * so their exponents step by three (#1278).
 */
const UNIT_DEFINITIONS = {
	Watt: {GW: 9, MW: 6, kW: 3, W: 0, mW: -3},
	Watt_hour: {GWh: 9, MWh: 6, kWh: 3, Wh: 0, mWh: -3},
	Cubic_meter: {'km³': 9, 'm³': 0, 'dm³': -3, 'cm³': -6, 'mm³': -9},
	Liter: {hl: 2, l: 0, dl: -1, cl: -2, ml: -3},
	Kilogram: {t: 6, kg: 3, g: 0},
	Meter: {km: 3, m: 0, dm: -1, cm: -2, mm: -3, µm: -6, nm: -9},
	// Counters without a physical unit, such as burner starts (#304) or pulses (#74)
	Piece: {piece: 0},
	// Pulse rate, integrated over time like power (#74)
	Piece_rate: {'piece/min': 0},
};

/**
 * Other spellings of supported units, compared without letter case (#304).
 */
const UNIT_ALIASES = {
	pcs: 'piece',
	pc: 'piece',
	pieces: 'piece',
	stk: 'piece',
	'stk.': 'piece',
	stück: 'piece',
	pulse: 'piece',
	pulses: 'piece',
	imp: 'piece',
	impulse: 'piece',
	impulses: 'piece',
	'pcs/min': 'piece/min',
	'pulse/min': 'piece/min',
	'pulses/min': 'piece/min',
	'imp/min': 'piece/min',
	'impulses/min': 'piece/min',
};

/**
 * Categories that count pieces or pulses; they convert into physical units with a pulse factor (#74).
 */
const COUNT_CATEGORIES = ['Piece', 'Piece_rate'];

/**
 * Build the unit definitions supported by SourceAnalytix.
 * @returns {Record<string, {exponent: number, category: string}>} Definitions indexed by unit symbol
 */
function buildUnitConfig() {
	const unitConfig = Object.create(null);
	for (const [category, units] of Object.entries(UNIT_DEFINITIONS)) {
		for (const [unit, exponent] of Object.entries(units)) {
			unitConfig[unit] = {exponent, category};
		}
	}
	return unitConfig;
}

/**
 * ISO 8601 week number and week-numbering year of a local date.
 * 29–31 December can belong to week 01 of the next year, 1–3 January to week 52/53 of the previous year.
 * @param {Date} date - Local date
 * @returns {{week: string, weekYear: number}} Two-digit week number and its ISO week-numbering year
 */
function getIsoWeek(date) {
	const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	// Move to the Thursday of the same ISO week (Monday = 1 … Sunday = 7)
	thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
	const weekYear = thursday.getUTCFullYear();
	const yearStart = Date.UTC(weekYear, 0, 1);
	const week = Math.ceil((((thursday.getTime() - yearStart) / 86400000) + 1) / 7);
	return {week: week.toString().padStart(2, '0'), weekYear};
}

/**
 * Share of the consumption of a reading gap that belongs to the ending day (#1260).
 * The consumption between the last reading before the rollover and the first reading after it
 * is split proportionally by time. Only the part of the gap that lies inside the ending day is
 * booked to it; the rest stays with the running period.
 * @param {{lastTs: number, lastTotal: number, oldDayStart: number, oldDayEnd: number}} gap - Last reading before the rollover and the ending day
 * @param {number} reading - First cumulative reading after the rollover
 * @param {number} timestamp - Timestamp of that reading
 * @returns {number} Consumption that belongs to the ending day (0 if nothing)
 */
function getGapShareOfEndingDay(gap, reading, timestamp) {
	if (
		!gap
		|| ![gap.lastTs, gap.lastTotal, gap.oldDayStart, gap.oldDayEnd, reading, timestamp].every(Number.isFinite)
		|| timestamp <= gap.lastTs
		|| timestamp <= gap.oldDayEnd
		|| reading <= gap.lastTotal
	) {
		return 0;
	}
	const sliceStart = Math.max(gap.lastTs, gap.oldDayStart);
	const sliceEnd = Math.min(timestamp, gap.oldDayEnd);
	if (sliceEnd <= sliceStart) return 0;
	return (reading - gap.lastTotal) * (sliceEnd - sliceStart) / (timestamp - gap.lastTs);
}

/**
 * Resolve a unit as reported by a device to a supported unit symbol.
 * Accepts the exact symbol, "3" instead of "³" (m3 → m³) and a different letter case
 * when only one supported unit matches (kwh → kWh), and other spellings such as pcs or Stück
 * for piece (#304). Ambiguous spellings such as "mwh" (MWh or mWh) are not resolved.
 * @param {unknown} unit - Unit from the state object or the custom settings
 * @param {Record<string, unknown>} unitConfig - Supported units indexed by symbol
 * @returns {string | null} Supported unit symbol, or null if the unit cannot be resolved
 */
function resolveUnit(unit, unitConfig) {
	if (typeof unit !== 'string' || !unitConfig) return null;
	const trimmed = unit.trim();
	if (!trimmed) return null;
	if (Object.prototype.hasOwnProperty.call(unitConfig, trimmed)) return trimmed;

	const normalized = trimmed.replace(/\^?3$/, '³');
	if (Object.prototype.hasOwnProperty.call(unitConfig, normalized)) return normalized;

	const lowerCase = normalized.toLowerCase();
	const matches = Object.keys(unitConfig).filter(symbol => symbol.toLowerCase() === lowerCase);
	if (matches.length === 1) return matches[0];
	const alias = Object.prototype.hasOwnProperty.call(UNIT_ALIASES, lowerCase) ? UNIT_ALIASES[lowerCase] : null;
	return alias && Object.prototype.hasOwnProperty.call(unitConfig, alias) ? alias : null;
}

/**
 * Check whether a source unit can be calculated into the unit of a price definition (#1278).
 * Power is integrated over time and needs an energy target; all other units need the
 * same category, except litres and cubic metres, which convert into each other.
 * @param {{exponent: number, category: string} | undefined} sourceUnit - Unit definition of the source
 * @param {{exponent: number, category: string} | undefined} targetUnit - Unit definition of the price definition
 * @param {unknown} [pulsesPerUnit] - Pulses per target unit for piece and pulse rate sources (#74)
 * @returns {boolean} True if the combination can be calculated
 */
function areUnitsCompatible(sourceUnit, targetUnit, pulsesPerUnit = 0) {
	if (!sourceUnit || !targetUnit) return false;
	if (sourceUnit.category === 'Watt') return targetUnit.category === 'Watt_hour';
	if (COUNT_CATEGORIES.includes(sourceUnit.category)) {
		// Pieces stay pieces; any other quantity needs the number of pulses per unit (#74)
		if (targetUnit.category === 'Piece') return true;
		return !['Watt', 'Piece_rate'].includes(targetUnit.category) && normalizePulsesPerUnit(pulsesPerUnit) > 0;
	}
	if (sourceUnit.category === targetUnit.category) return true;
	const volume = ['Liter', 'Cubic_meter'];
	return volume.includes(sourceUnit.category) && volume.includes(targetUnit.category);
}

/**
 * Whether a source unit is a rate that SourceAnalytix integrates over time, such as power.
 * Such sources have no meter reading of their own: their total starts at 0 and grows with
 * every interval, so they need no start value initialisation and no reset detection (#1267).
 * @param {string} unit - Supported unit symbol of the source
 * @param {Record<string, {exponent: number, category: string}>} unitConfig - Supported units
 * @returns {boolean} True for integrated units
 */
function isIntegratedUnit(unit, unitConfig) {
	const definition = unitConfig && typeof unit === 'string' ? unitConfig[unit] : undefined;
	return !!definition && (definition.category === 'Watt' || definition.category === 'Piece_rate');
}

/**
 * Normalize the configured number of pulses per unit of the price definition (#74).
 * @param {unknown} value - Configured pulses per unit, for example 1000 for 1000 imp/kWh
 * @returns {number} Pulses per unit, 0 when not set or invalid
 */
function normalizePulsesPerUnit(value) {
	if (value === null || value === undefined || value === '') return 0;
	const pulses = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value);
	return Number.isFinite(pulses) && pulses > 0 ? pulses : 0;
}

/**
 * Convert the result of an integrated source into the unit of the price definition.
 * Power integrated over hours gives energy (W · h = Wh). A pulse rate per minute integrated
 * over hours gives pulses after multiplying with 60, which the pulse factor turns into the
 * target unit (#74).
 * @param {number} value - Integrated value (source value × hours)
 * @param {{exponent: number, category: string}} sourceUnit - Source unit definition
 * @param {{exponent: number, category: string}} targetUnit - Target unit definition
 * @param {unknown} [pulsesPerUnit] - Pulses per target unit
 * @returns {number | null} Value in the target unit, or null if it cannot be converted
 */
function convertIntegratedValue(value, sourceUnit, targetUnit, pulsesPerUnit = 0) {
	if (!Number.isFinite(value) || !sourceUnit || !targetUnit) return null;
	if (sourceUnit.category === 'Watt') return value * Math.pow(10, sourceUnit.exponent - targetUnit.exponent);
	if (sourceUnit.category === 'Piece_rate') return convertUnitValue(value * 60, {exponent: 0, category: 'Piece'}, targetUnit, pulsesPerUnit);
	return null;
}

/**
 * Convert a cumulative value between supported decimal units.
 * @param {number} value - Source value
 * @param {{exponent: number, category: string}} sourceUnit - Source unit definition
 * @param {{exponent: number, category: string}} targetUnit - Target unit definition
 * @param {unknown} [pulsesPerUnit] - Pulses per target unit, converts pieces into other units (#74)
 * @returns {number | null} Converted value, or null for incompatible units
 */
function convertUnitValue(value, sourceUnit, targetUnit, pulsesPerUnit = 0) {
	if (
		!Number.isFinite(value)
		|| !sourceUnit
		|| !targetUnit
		|| !Number.isFinite(sourceUnit.exponent)
		|| !Number.isFinite(targetUnit.exponent)
	) {
		return null;
	}

	if (sourceUnit.category === 'Piece' && targetUnit.category !== 'Piece') {
		const pulses = normalizePulsesPerUnit(pulsesPerUnit);
		if (pulses <= 0 || ['Watt', 'Piece_rate'].includes(targetUnit.category)) return null;
		return value / pulses;
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
 * Resolve the explicit decimals stored for a source from its configured template.
 * @param {unknown} value - Source-specific decimals
 * @param {unknown} configuredDefault - Instance template for sources without a value
 * @param {number} factoryDefault - Factory fallback when the template is unusable
 * @returns {number} Effective decimals to store for the source
 */
function resolveDecimals(value, configuredDefault, factoryDefault) {
	return normalizeDecimals(value, normalizeDecimals(configuredDefault, factoryDefault));
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
 * Decide whether a confirmed device reset has to be rolled back (#1258).
 * A device that sends two identical low readings (1000 → 0 → 0) confirms a reset. If the
 * previous level then returns in a single step (→ 1000), it was a glitch and the old offset
 * is restored instead of adding the old level on top of the new offset. A genuine reset
 * climbs gradually from the low reading; once it has climbed half of the way the memory
 * is cleared.
 * @param {number} reading - Raw converted device reading
 * @param {{rawReading: number, previousRawReading: number, previousOffset: number, lastRawReading: number} | null} confirmedReset - Memory of the last confirmed reset
 * @param {number} threshold - Maximum backwards jitter in the target unit
 * @returns {{action: 'rollback' | 'keep' | 'clear', resetOffset: number | null, confirmedReset: {rawReading: number, previousRawReading: number, previousOffset: number, lastRawReading: number} | null}} Decision and remaining memory
 */
function checkConfirmedResetRollback(reading, confirmedReset, threshold) {
	if (
		!confirmedReset
		|| !Number.isFinite(reading)
		|| !Number.isFinite(confirmedReset.rawReading)
		|| !Number.isFinite(confirmedReset.previousRawReading)
		|| !Number.isFinite(confirmedReset.previousOffset)
		|| !Number.isFinite(confirmedReset.lastRawReading)
	) {
		return {action: 'clear', resetOffset: null, confirmedReset: null};
	}
	const normalizedThreshold = Number.isFinite(threshold) && threshold >= 0 ? threshold : 0;
	const range = confirmedReset.previousRawReading - confirmedReset.rawReading;
	if (range <= 0) return {action: 'clear', resetOffset: null, confirmedReset: null};
	// Another drop is handled by the regular reset detection
	if (reading + normalizedThreshold < confirmedReset.lastRawReading) return {action: 'clear', resetOffset: null, confirmedReset: null};

	const step = reading - confirmedReset.lastRawReading;
	if (reading + normalizedThreshold >= confirmedReset.previousRawReading && step >= range / 2) {
		return {action: 'rollback', resetOffset: confirmedReset.previousOffset, confirmedReset: null};
	}
	if (reading >= confirmedReset.rawReading + range / 2) return {action: 'clear', resetOffset: null, confirmedReset: null};
	return {
		action: 'keep',
		resetOffset: null,
		confirmedReset: {...confirmedReset, lastRawReading: Math.max(confirmedReset.lastRawReading, reading)},
	};
}

/**
 * Resolve a raw cumulative meter reading against the persisted reset offset.
 * @param {number} reading - Raw converted device reading
 * @param {number} resetOffset - Persisted offset from earlier device resets
 * @param {number} previousReading - Last accepted cumulative reading
 * @param {boolean} resetDetectionEnabled - Whether device resets should be detected
 * @param {number} threshold - Maximum backwards jitter in the target unit
 * @param {{rawReading: number, previousRawReading: number, previousReading: number} | null} [pendingReset] - Unconfirmed reset candidate
 * @returns {{type: 'normal' | 'jitter' | 'resetPending' | 'resetRejected' | 'reset' | 'decrease' | 'invalid', reading: number, resetOffset: number, decrease: number, pendingReset: {rawReading: number, previousRawReading: number, previousReading: number} | null}} Resolved cumulative reading and offset
 */
function resolveCumulativeReading(reading, resetOffset, previousReading, resetDetectionEnabled, threshold, pendingReset = null) {
	const normalizedOffset = Number.isFinite(resetOffset) ? resetOffset : 0;
	const normalizedThreshold = Number.isFinite(threshold) && threshold >= 0 ? threshold : 0;
	const validPendingReset = pendingReset
		&& Number.isFinite(pendingReset.rawReading)
		&& Number.isFinite(pendingReset.previousRawReading)
		&& Number.isFinite(pendingReset.previousReading)
		? pendingReset
		: null;
	if (!Number.isFinite(reading)) {
		return {
			type: 'invalid',
			decrease: 0,
			reading: Number.isFinite(previousReading) ? previousReading : 0,
			resetOffset: normalizedOffset,
			pendingReset: validPendingReset,
		};
	}
	const cumulativeReading = reading + normalizedOffset;
	if (!Number.isFinite(cumulativeReading)) {
		return {
			type: 'invalid',
			decrease: 0,
			reading: Number.isFinite(previousReading) ? previousReading : 0,
			resetOffset: normalizedOffset,
			pendingReset: validPendingReset,
		};
	}

	if (resetDetectionEnabled && validPendingReset) {
		const candidateRange = validPendingReset.previousRawReading - validPendingReset.rawReading;
		const distanceFromCandidate = reading - validPendingReset.rawReading;
		const returnedToPreviousRange = reading + normalizedThreshold >= validPendingReset.previousRawReading
			|| (reading >= validPendingReset.rawReading
				&& candidateRange > 0
				&& distanceFromCandidate >= candidateRange / 2);
		if (returnedToPreviousRange) {
			const classification = classifyCumulativeReading(cumulativeReading, previousReading, true, normalizedThreshold);
			return {
				type: 'resetRejected',
				decrease: classification.decrease,
				reading: cumulativeReading < previousReading ? previousReading : cumulativeReading,
				resetOffset: normalizedOffset,
				pendingReset: null,
			};
		}
		if (reading >= validPendingReset.rawReading) {
			const nextOffset = validPendingReset.previousReading - validPendingReset.rawReading;
			return {
				type: 'reset',
				decrease: validPendingReset.previousRawReading - validPendingReset.rawReading,
				reading: reading + nextOffset,
				resetOffset: nextOffset,
				pendingReset: null,
			};
		}
		return {
			type: 'resetPending',
			decrease: validPendingReset.previousRawReading - reading,
			reading: validPendingReset.previousReading,
			resetOffset: normalizedOffset,
			pendingReset: {...validPendingReset, rawReading: reading},
		};
	}

	const classification = classifyCumulativeReading(cumulativeReading, previousReading, resetDetectionEnabled, threshold);

	if (classification.type === 'jitter') {
		return {...classification, reading: previousReading, resetOffset: normalizedOffset, pendingReset: null};
	}
	if (classification.type === 'reset') {
		return {
			type: 'resetPending',
			decrease: classification.decrease,
			reading: previousReading,
			resetOffset: normalizedOffset,
			pendingReset: {
				rawReading: reading,
				previousRawReading: previousReading - normalizedOffset,
				previousReading,
			},
		};
	}
	return {...classification, reading: cumulativeReading, resetOffset: normalizedOffset, pendingReset: null};
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

/**
 * Normalize the configured maximum gap between two power readings (#1266).
 * @param {unknown} value - Configured maximum gap in minutes
 * @returns {number} Maximum gap in minutes, 0 when switched off
 */
function normalizeMaxPowerGap(value) {
	if (value === null || value === undefined || value === '') return 0;
	const minutes = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : Number(value);
	return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/**
 * Whether the interval between two power readings is longer than the configured maximum gap (#1266).
 * Such an interval is not extrapolated with the last power value, so a device or network
 * outage does not produce a huge consumption.
 * @param {number} previousTimestamp - Beginning of the interval in milliseconds
 * @param {number} currentTimestamp - End of the interval in milliseconds
 * @param {number} maxGapMinutes - Maximum gap in minutes, 0 switches the check off
 * @returns {boolean} True if the interval must be discarded
 */
function isPowerGapExceeded(previousTimestamp, currentTimestamp, maxGapMinutes) {
	if (!Number.isFinite(maxGapMinutes) || maxGapMinutes <= 0) return false;
	if (!Number.isFinite(previousTimestamp) || !Number.isFinite(currentTimestamp)) return false;
	return currentTimestamp - previousTimestamp > maxGapMinutes * 60000;
}

module.exports = {
	UNIT_ALIASES,
	areUnitsCompatible,
	buildUnitConfig,
	calculateBasicPriceTotals,
	calculateHistoricalBasicPriceTotals,
	calculateVariablePriceTotals,
	calculatePowerEnergy,
	convertIntegratedValue,
	checkConfirmedResetRollback,
	classifyCumulativeReading,
	convertUnitValue,
	getCurrentYearPeriodStateDefinitions,
	getGapShareOfEndingDay,
	getIsoWeek,
	getPeriodBoundaryTimestamp,
	getPeriodChanges,
	getPreviousPeriodTimestamp,
	initializePeriodStartValues,
	isIntegratedUnit,
	isPowerGapExceeded,
	migrateLegacyVariableCostTotals,
	normalizeDecimals,
	normalizeMaxPowerGap,
	normalizePulsesPerUnit,
	resolveDecimals,
	resolveUnit,
	normalizePeriodSnapshot,
	normalizePowerReading,
	resolveCumulativeReading,
	roundValue,
};
