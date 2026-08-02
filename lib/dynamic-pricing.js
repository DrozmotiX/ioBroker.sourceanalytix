'use strict';

/**
 * @param {unknown} value - Price value from settings, persistence or an ioBroker state
 * @returns {number | null} Parsed price, or null if the value is not numeric
 */
function parsePriceValue(value) {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		const normalizedValue = value.trim();
		if (normalizedValue === '') return null;
		const parsedValue = Number(normalizedValue.replace(',', '.'));
		return Number.isFinite(parsedValue) ? parsedValue : null;
	}
	return null;
}

/**
 * @param {unknown} value - Configured date, ISO date string or timestamp
 * @param {number} fallback - Timestamp used for an empty or invalid value
 * @returns {number} Parsed timestamp
 */
function parseValidityTimestamp(value, fallback) {
	if (value === null || value === undefined || value === '') return fallback;
	const numericValue = Number(value);
	if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;
	const parsedDate = Date.parse(String(value));
	return Number.isFinite(parsedDate) ? parsedDate : fallback;
}

/**
 * Parse a tariff date as a local calendar-day boundary.
 * ioBroker date pickers may serialize a selected day as a UTC ISO string, but
 * tariff dates are calendar dates and must become effective at local midnight.
 * @param {unknown} value - Configured tariff date or timestamp
 * @param {number} fallback - Timestamp used for an empty or invalid value
 * @returns {number} Parsed timestamp
 */
function parseTariffValidityTimestamp(value, fallback) {
	if (typeof value === 'string') {
		const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value.trim());
		if (match) {
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			const date = new Date(year, month - 1, day);
			if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date.getTime();
			return fallback;
		}
	}
	return parseValidityTimestamp(value, fallback);
}

/**
 * Select one of two tariffs from a boolean, contact or configured selector value.
 * @param {ioBroker.StateValue} value - Selector state value
 * @param {ioBroker.StateValue} basePrice - Price for the inactive selector
 * @param {ioBroker.StateValue} alternatePrice - Price for the active selector
 * @param {ioBroker.StateValue} [activeValue] - Optional value which activates the alternate tariff
 * @returns {number | null} Selected unit price
 */
function getSelectorPrice(value, basePrice, alternatePrice, activeValue) {
	const base = parsePriceValue(basePrice);
	const alternate = parsePriceValue(alternatePrice);
	if (base === null || alternate === null) return null;

	let active;
	if (activeValue !== null && activeValue !== undefined && activeValue !== '') {
		active = String(value) === String(activeValue);
	} else if (typeof value === 'string') {
		active = !['', '0', 'false', 'off', 'no', 'closed'].includes(value.trim().toLowerCase());
	} else {
		active = value === true || (typeof value === 'number' && value !== 0);
	}
	return active ? alternate : base;
}

/**
 * @param {Array<{ts: number | string, price: ioBroker.StateValue}>} historyEntries - Raw history entries
 * @returns {Array<{ts: number, price: number}>} Sorted and validated price history
 */
function normalizePriceHistory(historyEntries) {
	if (!Array.isArray(historyEntries)) return [];

	const normalizedHistory = [];
	for (const entry of historyEntries) {
		if (!entry) continue;
		const timestamp = Number(entry.ts);
		const price = parsePriceValue(entry.price);
		if (!Number.isFinite(timestamp) || timestamp <= 0 || price === null) continue;
		normalizedHistory.push({ts: timestamp, price});
	}
	normalizedHistory.sort((a, b) => a.ts - b.ts);

	const deduplicatedHistory = [];
	for (const entry of normalizedHistory) {
		const previousEntry = deduplicatedHistory.at(-1);
		if (previousEntry && previousEntry.ts === entry.ts) {
			previousEntry.price = entry.price;
		} else if (!previousEntry || previousEntry.price !== entry.price) {
			deduplicatedHistory.push(entry);
		}
	}
	return deduplicatedHistory;
}

/**
 * Move the history entry which belongs to a configured tariff without
 * changing unrelated historical prices.
 * @param {Array<{ts: number | string, price: ioBroker.StateValue}>} historyEntries - Raw history entries
 * @param {ioBroker.StateValue} configuredPrice - Price from adapter settings
 * @param {number | null} previousTimestamp - Previously remembered effective timestamp
 * @param {number} requestedTimestamp - New effective timestamp
 * @returns {{history: Array<{ts: number, price: number}>, changed: boolean}} Updated normalized history
 */
function moveConfiguredPriceHistoryEntry(historyEntries, configuredPrice, previousTimestamp, requestedTimestamp) {
	const history = normalizePriceHistory(historyEntries);
	const price = parsePriceValue(configuredPrice);
	const previous = Number(previousTimestamp);
	const requested = Number(requestedTimestamp);
	if (price === null || !Number.isFinite(requested) || requested <= 0) return {history, changed: false};

	let entry = Number.isFinite(previous) && previous > 0
		? history.find(item => item.ts === previous && item.price === price)
		: null;
	if (!entry && history.length === 1 && history[0].price === price) entry = history[0];
	if (!entry || entry.ts === requested) return {history, changed: false};

	entry.ts = requested;
	return {history: normalizePriceHistory(history), changed: true};
}

/**
 * @param {Array<{ts: number, price: number}>} history - Normalized price history
 * @param {number} timestamp - Timestamp to price
 * @param {ioBroker.StateValue} [fallbackPrice] - Fallback when no historical price exists
 * @returns {number | null} Price valid at the timestamp, or null if none is available
 */
function getPriceForTimestamp(history, timestamp, fallbackPrice) {
	let selectedEntry = null;
	for (const entry of history) {
		if (entry.ts <= timestamp) {
			selectedEntry = entry;
		} else {
			break;
		}
	}
	if (selectedEntry) return selectedEntry.price;

	const fallbackPriceNumber = parsePriceValue(fallbackPrice);
	if (fallbackPriceNumber !== null) return fallbackPriceNumber;
	return null;
}

/**
 * Splits a cumulative meter delta proportionally over all price intervals it spans.
 * @param {Array<{ts: number, price: number}>} history - Normalized price history
 * @param {number} delta - Consumption delta
 * @param {number | string | null | undefined} startTimestamp - Previous reading timestamp
 * @param {number | string | null | undefined} endTimestamp - Current reading timestamp
 * @param {ioBroker.StateValue} [fallbackPrice] - Fallback unit price
 * @returns {number | null} Cost delta across all applicable price intervals
 */
function calculatePriceDelta(history, delta, startTimestamp, endTimestamp, fallbackPrice) {
	const startTs = Number(startTimestamp);
	const endTs = Number(endTimestamp);
	if (!Number.isFinite(endTs) || endTs <= 0) return null;
	if (!Number.isFinite(startTs) || startTs <= 0 || startTs >= endTs) {
		const priceAtReading = getPriceForTimestamp(history, endTs, fallbackPrice);
		return priceAtReading === null ? null : delta * priceAtReading;
	}

	const intervalChanges = history.filter(entry => entry.ts > startTs && entry.ts < endTs);
	if (intervalChanges.length === 0) {
		const priceAtStart = getPriceForTimestamp(history, startTs, fallbackPrice);
		return priceAtStart === null ? null : delta * priceAtStart;
	}

	const totalDuration = endTs - startTs;
	let segmentStart = startTs;
	let priceDelta = 0;

	for (const change of intervalChanges) {
		const segmentPrice = getPriceForTimestamp(history, segmentStart, fallbackPrice);
		if (segmentPrice === null) return null;
		priceDelta += delta * ((change.ts - segmentStart) / totalDuration) * segmentPrice;
		segmentStart = change.ts;
	}

	const finalSegmentPrice = getPriceForTimestamp(history, segmentStart, fallbackPrice);
	if (finalSegmentPrice === null) return null;
	priceDelta += delta * ((endTs - segmentStart) / totalDuration) * finalSegmentPrice;
	return priceDelta;
}

/**
 * @param {Record<string, unknown> | null | undefined} memory - Raw persisted dynamic cost memory
 * @returns {{version: number, priceDefinition: string, lastReading: number, lastTs: number, totals: {priceDay: number, priceWeek: number, priceMonth: number, priceQuarter: number, priceYear: number}} | null} Validated dynamic cost memory
 */
function normalizeDynamicCostMemory(memory) {
	if (!memory || typeof memory.priceDefinition !== 'string') return null;
	const version = Number(memory.version);
	if (![1, 2].includes(version)) return null;

	const lastReading = parsePriceValue(memory.lastReading);
	const lastTs = Number(memory.lastTs);
	if (lastReading === null || !Number.isFinite(lastTs) || lastTs <= 0) return null;

	if (!memory.totals || typeof memory.totals !== 'object') return null;
	const priceDay = parsePriceValue(Reflect.get(memory.totals, 'priceDay'));
	const priceWeek = parsePriceValue(Reflect.get(memory.totals, 'priceWeek'));
	const priceMonth = parsePriceValue(Reflect.get(memory.totals, 'priceMonth'));
	const priceQuarter = parsePriceValue(Reflect.get(memory.totals, 'priceQuarter'));
	const priceYear = parsePriceValue(Reflect.get(memory.totals, 'priceYear'));
	if (priceDay === null || priceWeek === null || priceMonth === null || priceQuarter === null || priceYear === null) return null;

	return {
		version,
		priceDefinition: memory.priceDefinition,
		lastReading,
		lastTs,
		totals: {priceDay, priceWeek, priceMonth, priceQuarter, priceYear},
	};
}

module.exports = {
	calculatePriceDelta,
	getSelectorPrice,
	getPriceForTimestamp,
	moveConfiguredPriceHistoryEntry,
	normalizeDynamicCostMemory,
	normalizePriceHistory,
	parsePriceValue,
	parseTariffValidityTimestamp,
	parseValidityTimestamp,
};
