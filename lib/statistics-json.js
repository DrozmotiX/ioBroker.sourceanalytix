'use strict';

const BASIC_PERIODS = {
	'01_currentDay': ['current', 'day'],
	'02_currentWeek': ['current', 'week'],
	'03_currentMonth': ['current', 'month'],
	'04_currentQuarter': ['current', 'quarter'],
	'05_currentYear': ['current', 'year'],
	'01_previousDay': ['previous', 'day'],
	'02_previousWeek': ['previous', 'week'],
	'03_previousMonth': ['previous', 'month'],
	'04_previousQuarter': ['previous', 'quarter'],
	'05_previousYear': ['previous', 'year'],
};

/**
 * @param {boolean} enabled - Whether the section is enabled
 * @param {object} options - Period collection settings
 * @returns {object|null} Empty statistics section
 */
function createValueSection(enabled, options) {
	if (!enabled) return null;
	return {
		current: {
			day: null,
			week: null,
			month: null,
			quarter: null,
			year: null,
		},
		previous: options.previous ? {
			day: null,
			week: null,
			month: null,
			quarter: null,
			year: null,
		} : null,
		periods: {
			weekdays: options.days ? {} : null,
			previousWeekdays: options.days && options.previous ? {} : null,
			weeks: options.weeks ? {} : null,
			months: options.months ? {} : null,
			quarters: options.quarters ? {} : null,
		},
	};
}

/**
 * Create an empty, stable statistics JSON structure.
 * @param {object} options - Source and adapter configuration
 * @returns {object} Statistics snapshot
 */
function createStatisticsSnapshot(options) {
	const periods = {
		days: options.days === true,
		weeks: options.weeks === true,
		months: options.months === true,
		quarters: options.quarters === true,
		previous: options.previous === true,
	};
	const quantityValues = createValueSection(options.consumption === true, periods);
	const financialValues = createValueSection(options.costs === true, periods);
	const meterReadings = createValueSection(options.meterValues === true, periods);
	if (meterReadings) {
		meterReadings.current = null;
	}
	const quantity = quantityValues ? {
		type: options.quantityType,
		...quantityValues,
	} : null;
	const financial = financialValues ? {
		type: options.financialType,
		currency: options.currency,
		...financialValues,
	} : null;

	return {
		schemaVersion: 1,
		year: options.year,
		source: {
			id: options.sourceId,
			name: normalizeName(options.sourceName),
			unit: options.unit,
		},
		quantity,
		financial,
		meterReadings,
	};
}

/**
 * @param {unknown} name - ioBroker common.name value
 * @returns {string} Display name
 */
function normalizeName(name) {
	if (typeof name === 'string') return name;
	if (name && typeof name === 'object') {
		const translatedName = Reflect.get(name, 'en') || Reflect.get(name, 'de')
			|| Object.values(name).find(value => typeof value === 'string');
		return typeof translatedName === 'string' ? translatedName : '';
	}
	return '';
}

/**
 * @param {unknown} value - State value
 * @returns {number|null} Numeric value
 */
function normalizeValue(value) {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

/**
 * @param {string} collection - Internal collection name
 * @param {string} stateName - Internal state name
 * @returns {string|null} Language-neutral period key
 */
function getPeriodKey(collection, stateName) {
	if (collection === 'currentWeek' || collection === 'previousWeek') {
		const match = stateName.match(/^0?([1-7])_/);
		return match ? match[1] : null;
	}
	if (collection === 'weeks') {
		const match = stateName.match(/^(\d{1,2})/);
		return match ? match[1].padStart(2, '0') : null;
	}
	if (collection === 'months') {
		const match = stateName.match(/^(\d{1,2})/);
		return match ? match[1].padStart(2, '0') : null;
	}
	if (collection === 'quarters') {
		const match = stateName.match(/^Q?([1-4])$/);
		return match ? match[1] : null;
	}
	return null;
}

/**
 * Apply one existing SourceAnalytix state to a statistics snapshot.
 * @param {object} snapshot - Mutable statistics snapshot
 * @param {string} relativePath - Path below the source device
 * @param {unknown} value - State value
 * @returns {boolean} Whether the path belongs to the snapshot
 */
function applyStatisticsState(snapshot, relativePath, value) {
	const normalizedValue = normalizeValue(value);
	if (relativePath === 'cumulativeReading') {
		if (!snapshot.meterReadings) return false;
		snapshot.meterReadings.current = normalizedValue;
		return true;
	}

	const match = relativePath.match(/^currentYear\.(consumed|delivered|costs|earnings|meterReadings)\.(.+)$/);
	if (!match) return false;

	const [, category, suffix] = match;
	const section = category === 'consumed' || category === 'delivered'
		? snapshot.quantity
		: category === 'costs' || category === 'earnings'
			? snapshot.financial
			: snapshot.meterReadings;
	if (!section) return false;
	if (category !== 'meterReadings' && section.type !== category) return false;

	const basicPeriod = BASIC_PERIODS[suffix];
	if (basicPeriod) {
		const [group, period] = basicPeriod;
		if (group === 'current' && category === 'meterReadings') return false;
		if (!section[group]) return false;
		section[group][period] = normalizedValue;
		return true;
	}

	const periodMatch = suffix.match(/^(currentWeek|previousWeek|weeks|months|quarters)\.(.+)$/);
	if (!periodMatch) return false;
	const [, collection, stateName] = periodMatch;
	const targetName = collection === 'currentWeek'
		? 'weekdays'
		: collection === 'previousWeek'
			? 'previousWeekdays'
			: collection;
	const target = section.periods[targetName];
	const key = getPeriodKey(collection, stateName);
	if (!target || !key) return false;
	target[key] = normalizedValue;
	return true;
}

/**
 * @param {object} snapshot - Statistics snapshot
 * @returns {string} Serialized state value
 */
function serializeStatisticsSnapshot(snapshot) {
	return JSON.stringify(snapshot);
}

module.exports = {
	applyStatisticsState,
	createStatisticsSnapshot,
	serializeStatisticsSnapshot,
};
