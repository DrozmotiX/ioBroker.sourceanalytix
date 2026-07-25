'use strict';

const assert = require('node:assert/strict');
const {
	calculateBasicPriceTotals,
	classifyCumulativeReading,
	getPeriodChanges,
	resolveCumulativeReading,
} = require('./lib/calculation');
const {
	calculatePriceDelta,
	getSelectorPrice,
	getPriceForTimestamp,
	normalizeDynamicCostMemory,
	normalizePriceHistory,
	parsePriceValue,
	parseValidityTimestamp,
} = require('./lib/dynamic-pricing');

const minute = 60_000;
const at = (hour, minutes = 0) => Date.UTC(2026, 0, 1, hour, minutes);

describe('dynamic pricing', () => {
	describe('parsePriceValue', () => {
		it('accepts numbers and decimal commas', () => {
			assert.equal(parsePriceValue(0.25), 0.25);
			assert.equal(parsePriceValue('0,40'), 0.4);
		});

		it('rejects empty and non-numeric values', () => {
			assert.equal(parsePriceValue(''), null);
			assert.equal(parsePriceValue('invalid'), null);
			assert.equal(parsePriceValue(false), null);
		});
	});

	describe('tariff configuration', () => {
		it('parses timestamps and ISO dates for scheduled fixed prices', () => {
			assert.equal(parseValidityTimestamp('2026-01-01T10:00:00.000Z', 1), at(10));
			assert.equal(parseValidityTimestamp('', 123), 123);
		});

		it('switches tariffs with boolean, contact and configured values', () => {
			assert.equal(getSelectorPrice(false, 0.2, 0.4), 0.2);
			assert.equal(getSelectorPrice(true, 0.2, 0.4), 0.4);
			assert.equal(getSelectorPrice('closed', 0.2, 0.4), 0.2);
			assert.equal(getSelectorPrice('night', 0.2, 0.4, 'night'), 0.4);
		});
	});

	describe('normalizePriceHistory', () => {
		it('sorts entries and removes invalid, duplicate and unchanged prices', () => {
			const history = normalizePriceHistory([
				{ts: at(11), price: '0,40'},
				{ts: 0, price: 99},
				{ts: at(10), price: 0.25},
				{ts: at(10), price: 0.3},
				{ts: at(10, 30), price: 0.3},
				{ts: at(12), price: 'invalid'},
			]);

			assert.deepEqual(history, [
				{ts: at(10), price: 0.3},
				{ts: at(11), price: 0.4},
			]);
		});
	});

	describe('getPriceForTimestamp', () => {
		const history = [
			{ts: at(10), price: 0.25},
			{ts: at(11), price: 0.4},
		];

		it('uses the price valid at the consumption timestamp', () => {
			assert.equal(getPriceForTimestamp(history, at(10, 30)), 0.25);
			assert.equal(getPriceForTimestamp(history, at(11)), 0.4);
			assert.equal(getPriceForTimestamp(history, at(11, 30)), 0.4);
		});

		it('uses a configured fallback before the first known price', () => {
			assert.equal(getPriceForTimestamp(history, at(9, 30), 0.2), 0.2);
		});

		it('returns no price before the first known entry without a fallback', () => {
			assert.equal(getPriceForTimestamp(history, at(9, 30)), null);
		});
	});

	describe('calculatePriceDelta', () => {
		const history = [
			{ts: at(10), price: 0.25},
			{ts: at(11), price: 0.4},
			{ts: at(12), price: 0.5},
		];

		it('prices consumption within each historical interval', () => {
			assert.equal(calculatePriceDelta(history, 1, at(10), at(10, 30)), 0.25);
			assert.equal(calculatePriceDelta(history, 1, at(11), at(11, 30)), 0.4);
			assert.equal(calculatePriceDelta(history, 1, at(12), at(12, 30)), 0.5);
		});

		it('keeps a price change at the reading endpoint out of the preceding interval', () => {
			assert.equal(calculatePriceDelta(history, 1, at(10, 45), at(11)), 0.25);
		});

		it('splits a meter delta proportionally over 15-minute price intervals', () => {
			const quarterHourlyHistory = [
				{ts: at(10), price: 0.2},
				{ts: at(10, 15), price: 0.3},
				{ts: at(10, 30), price: 0.4},
				{ts: at(10, 45), price: 0.5},
			];

			assert.equal(calculatePriceDelta(quarterHourlyHistory, 4, at(10), at(11)), 1.4);
		});

		it('does not change previously accumulated costs when a later price is added', () => {
			const initialHistory = history.slice(0, 2);
			const costAt1030 = calculatePriceDelta(initialHistory, 1, at(10), at(10, 30));
			const costAt1130 = calculatePriceDelta(initialHistory, 1, at(11), at(11, 30));
			if (costAt1030 === null || costAt1130 === null) assert.fail('Expected historical prices');
			const historicalTotal = costAt1030 + costAt1130;

			const extendedHistory = [...initialHistory, {ts: at(12), price: 0.5}];
			assert.equal(costAt1030, 0.25);
			assert.equal(costAt1130, 0.4);
			assert.equal(historicalTotal, 0.65);
			assert.equal(calculatePriceDelta(extendedHistory, 1, at(12), at(12, 30)), 0.5);
		});

		it('produces the same result after persisted history is restored', () => {
			const restoredHistory = normalizePriceHistory(JSON.parse(JSON.stringify(history)));
			assert.equal(calculatePriceDelta(restoredHistory, 2, at(10, 30), at(11, 30)), 0.65);
		});

		it('falls back to the price at the reading for missing interval timestamps', () => {
			assert.equal(calculatePriceDelta(history, 2, null, at(11, 30)), 0.8);
			assert.equal(calculatePriceDelta([], 2, null, at(11, 30)), null);
		});

		it('handles millisecond intervals without rounding the result', () => {
			const shortHistory = [
				{ts: at(10), price: 0.2},
				{ts: at(10) + minute, price: 0.4},
			];
			const result = calculatePriceDelta(shortHistory, 2, at(10), at(10) + 2 * minute);
			if (result === null) assert.fail('Expected a calculated price delta');
			assert.ok(Math.abs(result - 0.6) < 1e-12);
		});
	});

	describe('normalizeDynamicCostMemory', () => {
		const preciseMemory = {
			version: 1,
			priceDefinition: 'Electricity',
			lastReading: 7837.556,
			lastTs: at(11),
			totals: {
				priceDay: 0.960789,
				priceWeek: 0.960789,
				priceMonth: 1.340789,
				priceQuarter: 1.340789,
				priceYear: 1.340789,
			},
		};

		it('preserves unrounded costs through a JSON restart round-trip', () => {
			const restoredMemory = normalizeDynamicCostMemory(JSON.parse(JSON.stringify(preciseMemory)));
			assert.deepEqual(restoredMemory, preciseMemory);
		});

		it('continues from precise totals after a restart', () => {
			const restoredMemory = normalizeDynamicCostMemory(JSON.parse(JSON.stringify(preciseMemory)));
			if (!restoredMemory) assert.fail('Expected valid persisted memory');

			const history = [
				{ts: at(10), price: 0.25},
				{ts: at(11), price: 0.4},
			];
			const priceDelta = calculatePriceDelta(history, 1, at(10, 30), at(11, 30));
			if (priceDelta === null) assert.fail('Expected a calculated price delta');

			assert.equal(priceDelta, 0.325);
			assert.equal(restoredMemory.totals.priceDay + priceDelta, 1.285789);
		});

		it('rejects incompatible versions and incomplete totals', () => {
			assert.equal(normalizeDynamicCostMemory({...preciseMemory, version: 2}), null);
			assert.equal(normalizeDynamicCostMemory({...preciseMemory, totals: {priceDay: 1}}), null);
			assert.equal(normalizeDynamicCostMemory(null), null);
		});
	});
});

describe('period and cumulative calculations', () => {
	describe('getPeriodChanges', () => {
		it('identifies all affected periods at a year boundary', () => {
			assert.deepEqual(
				getPeriodChanges(
					{day: '03_Wednesday', week: '53', month: '12_December', quarter: 4, year: 2025},
					{day: '04_Thursday', week: '01', month: '01_January', quarter: 1, year: 2026},
				),
				{day: true, week: true, month: true, quarter: true, year: true},
			);
		});

		it('changes only the day during a normal midnight rollover', () => {
			assert.deepEqual(
				getPeriodChanges(
					{day: '02_Tuesday', week: '30', month: '07_July', quarter: 3, year: 2026},
					{day: '03_Wednesday', week: '30', month: '07_July', quarter: 3, year: 2026},
				),
				{day: true, week: false, month: false, quarter: false, year: false},
			);
		});
	});

	describe('classifyCumulativeReading', () => {
		it('ignores a small backwards fluctuation within the configured threshold', () => {
			const result = classifyCumulativeReading(7837.612, 7837.613, true, 1);
			assert.equal(result.type, 'jitter');
			assert.ok(Math.abs(result.decrease - 0.001) < 1e-9);
		});

		it('keeps large decreases as device resets', () => {
			assert.deepEqual(classifyCumulativeReading(100, 102, true, 1), {type: 'reset', decrease: 2});
		});

		it('preserves explicitly disabled reset handling', () => {
			assert.deepEqual(classifyCumulativeReading(100, 100.5, false, 1), {type: 'decrease', decrease: 0.5});
		});
	});

	describe('resolveCumulativeReading', () => {
		it('anchors a reset at the previous cumulative value and continues from there', () => {
			assert.deepEqual(resolveCumulativeReading(0, 0, 102, true, 1), {
				type: 'reset', decrease: 102, reading: 102, resetOffset: 102,
			});
			assert.deepEqual(resolveCumulativeReading(1, 102, 102, true, 1), {
				type: 'normal', decrease: 0, reading: 103, resetOffset: 102,
			});
		});

		it('supports replacement meters which start above zero', () => {
			assert.equal(resolveCumulativeReading(50, 0, 102, true, 1).resetOffset, 52);
			assert.equal(resolveCumulativeReading(51, 52, 102, true, 1).reading, 103);
		});

		it('keeps small backwards jitter at the accepted high-water mark', () => {
			assert.deepEqual(resolveCumulativeReading(99.9, 0, 100, true, 0.2), {
				type: 'jitter', decrease: 0.09999999999999432, reading: 100, resetOffset: 0,
			});
		});

		it('keeps the last valid reading when the device reports a non-finite value', () => {
			assert.deepEqual(resolveCumulativeReading(Number.NaN, 12, 100, true, 1), {
				type: 'invalid', decrease: 0, reading: 100, resetOffset: 12,
			});
			assert.deepEqual(resolveCumulativeReading(Number.POSITIVE_INFINITY, 12, 100, true, 1), {
				type: 'invalid', decrease: 0, reading: 100, resetOffset: 12,
			});
		});
	});

	describe('calculateBasicPriceTotals', () => {
		it('allocates a monthly price over calendar periods', () => {
			const totals = calculateBasicPriceTotals(29, new Date(2024, 1, 15, 12));
			assert.equal(totals.priceDay, 1);
			assert.equal(totals.priceMonth, 29);
			assert.equal(totals.priceQuarter, 58);
			assert.equal(totals.priceYear, 58);
		});

		it('uses the correct daily shares when a week crosses a month boundary', () => {
			const totals = calculateBasicPriceTotals(31, new Date(2026, 3, 1, 12));
			assert.ok(Math.abs(totals.priceDay - (31 / 30)) < 1e-12);
			assert.ok(Math.abs(totals.priceWeek - (2 + (31 / 30))) < 1e-12);
			assert.equal(totals.priceMonth, 31);
			assert.equal(totals.priceQuarter, 31);
			assert.equal(totals.priceYear, 124);
		});
	});
});
