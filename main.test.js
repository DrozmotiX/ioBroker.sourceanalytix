'use strict';

const assert = require('node:assert/strict');
const adapterHelpers = require('iobroker-adapter-helpers');
const {
	buildUnitConfig,
	calculateBasicPriceTotals,
	calculateHistoricalBasicPriceTotals,
	calculateVariablePriceTotals,
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
	resolveCumulativeReading,
	roundValue,
} = require('./lib/calculation');
const {
	calculatePriceDelta,
	getSelectorPrice,
	getPriceForTimestamp,
	moveConfiguredPriceHistoryEntry,
	normalizeDynamicCostMemory,
	normalizePriceHistory,
	parsePriceValue,
	parseTariffValidityTimestamp,
	parseValidityTimestamp,
} = require('./lib/dynamic-pricing');

const minute = 60_000;
const at = (hour, minutes = 0) => Date.UTC(2026, 0, 1, hour, minutes);

describe('unit conversion', () => {
	const units = buildUnitConfig(adapterHelpers.units);

	it('provides mass and length units for automatic detection and price definitions', () => {
		assert.deepEqual(units.t, {exponent: 6, category: 'Kilogram'});
		assert.deepEqual(units.kg, {exponent: 3, category: 'Kilogram'});
		assert.deepEqual(units.g, {exponent: 0, category: 'Kilogram'});
		assert.deepEqual(units.km, {exponent: 3, category: 'Meter'});
		assert.deepEqual(units.m, {exponent: 0, category: 'Meter'});
	});

	it('converts mass values between tonnes, kilograms and grams', () => {
		assert.equal(convertUnitValue(1.5, units.t, units.kg), 1500);
		assert.equal(convertUnitValue(1000, units.kg, units.t), 1);
		assert.equal(convertUnitValue(2.5, units.kg, units.g), 2500);
	});

	it('converts distance values between metric units', () => {
		assert.equal(convertUnitValue(2500, units.m, units.km), 2.5);
		assert.equal(convertUnitValue(1, units.km, units.cm), 100000);
	});

	it('retains existing liter and cubic-meter conversion behavior', () => {
		assert.equal(convertUnitValue(1000, units.l, units['m³']), 1);
		assert.equal(convertUnitValue(1, units['m³'], units.l), 1000);
	});

	it('rejects conversions between incompatible quantities', () => {
		assert.equal(convertUnitValue(1, units.kg, units.km), null);
	});
});

describe('dynamic pricing', () => {
	describe('parsePriceValue', () => {
		it('accepts numbers and decimal commas', () => {
			assert.equal(parsePriceValue(0.25), 0.25);
			assert.equal(parsePriceValue('0,40'), 0.4);
		});

		it('rejects empty and non-numeric values', () => {
			assert.equal(parsePriceValue(''), null);
			assert.equal(parsePriceValue('   '), null);
			assert.equal(parsePriceValue('invalid'), null);
			assert.equal(parsePriceValue(false), null);
		});
	});

	describe('tariff configuration', () => {
		it('parses timestamps and ISO dates for scheduled fixed prices', () => {
			assert.equal(parseValidityTimestamp('2026-01-01T10:00:00.000Z', 1), at(10));
			assert.equal(parseValidityTimestamp('', 123), 123);
		});

		it('treats date-picker tariff dates as local calendar days', () => {
			const localMidnight = new Date(2026, 8, 1).getTime();
			assert.equal(parseTariffValidityTimestamp('2026-09-01', 1), localMidnight);
			assert.equal(parseTariffValidityTimestamp('2026-09-01T00:00:00.000Z', 1), localMidnight);
			assert.equal(parseTariffValidityTimestamp('2026-02-30', 123), 123);
			assert.equal(parseTariffValidityTimestamp('', 123), 123);
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

	describe('moveConfiguredPriceHistoryEntry', () => {
		it('moves only the remembered configured tariff entry', () => {
			const moved = moveConfiguredPriceHistoryEntry([
				{ts: at(10), price: 0.25},
				{ts: at(11), price: 0.4},
			], 0.4, at(11), at(12));

			assert.equal(moved.changed, true);
			assert.deepEqual(moved.history, [
				{ts: at(10), price: 0.25},
				{ts: at(12), price: 0.4},
			]);
		});

		it('moves a single matching migration entry without metadata', () => {
			const moved = moveConfiguredPriceHistoryEntry([{ts: at(10), price: 0.25}], 0.25, null, at(12));
			assert.equal(moved.changed, true);
			assert.deepEqual(moved.history, [{ts: at(12), price: 0.25}]);
		});

		it('leaves ambiguous and unrelated histories untouched', () => {
			const history = [{ts: at(10), price: 0.25}, {ts: at(11), price: 0.4}];
			assert.deepEqual(moveConfiguredPriceHistoryEntry(history, 0.4, null, at(12)), {
				history,
				changed: false,
			});
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
			version: 2,
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

		it('accepts legacy memory for migration', () => {
			const legacyMemory = normalizeDynamicCostMemory({...preciseMemory, version: 1});
			assert.ok(legacyMemory);
			assert.equal(legacyMemory.version, 1);
		});

		it('rejects incompatible versions and incomplete totals', () => {
			assert.equal(normalizeDynamicCostMemory({...preciseMemory, version: 3}), null);
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

		it('detects elapsed whole weeks even when the weekday name is unchanged', () => {
			assert.deepEqual(
				getPeriodChanges(
					{date: '2026-07-20', day: '01_Monday', week: '30', month: '07_July', quarter: 3, year: 2026},
					{date: '2026-07-27', day: '01_Monday', week: '31', month: '07_July', quarter: 3, year: 2026},
				),
				{day: true, week: true, month: false, quarter: false, year: false},
			);
		});
	});

	describe('period persistence', () => {
		it('normalizes valid persisted period identifiers', () => {
			assert.deepEqual(normalizePeriodSnapshot({
				date: '2026-07-28',
				day: '02_Tuesday',
				week: '31',
				month: '07_July',
				quarter: '3',
				year: '2026',
			}), {
				date: '2026-07-28',
				day: '02_Tuesday',
				week: '31',
				month: '07_July',
				quarter: 3,
				year: 2026,
			});
		});

		it('rejects incomplete or invalid persisted period identifiers', () => {
			assert.equal(normalizePeriodSnapshot(null), null);
			assert.equal(normalizePeriodSnapshot({day: '01_Monday'}), null);
			assert.equal(normalizePeriodSnapshot({
				date: 'not-a-date', day: '01_Monday', week: '31', month: '07_July', quarter: 3, year: 2026,
			}), null);
		});
	});

	describe('configurable rounding', () => {
		it('keeps the previous defaults when nothing is configured', () => {
			assert.equal(normalizeDecimals(undefined, 3), 3);
			assert.equal(normalizeDecimals('', 2), 2);
			assert.equal(normalizeDecimals(null, 3), 3);
			assert.equal(roundValue(1.23456789, 3), 1.235);
			assert.equal(roundValue(1.23456789, 2), 1.23);
		});

		it('applies a configured number of decimals', () => {
			assert.equal(roundValue(7837.6127, 0), 7838);
			assert.equal(roundValue(7837.6127, 1), 7837.6);
			assert.equal(roundValue(0.000123456, 6), 0.000123);
		});

		it('keeps the exact value when rounding is disabled', () => {
			assert.equal(normalizeDecimals(-1, 3), -1);
			assert.equal(normalizeDecimals(-5, 3), -1);
			assert.equal(roundValue(1.234567890123, -1), 1.234567890123);
		});

		it('rounds values which previously returned unrounded', () => {
			// roundDigits used to return the raw input whenever the result was 0
			assert.equal(roundValue(0.0004, 3), 0);
			assert.equal(roundValue(-0.0004, 3), -0);
		});

		it('falls back for unusable settings and rejects non-numeric values', () => {
			assert.equal(normalizeDecimals('not a number', 3), 3);
			assert.equal(normalizeDecimals(2.7, 3), 2);
			assert.equal(normalizeDecimals(99, 3), 15);
			assert.equal(roundValue('abc', 3), null);
			assert.equal(roundValue(null, 3), null);
			assert.equal(roundValue(undefined, 3), null);
		});
	});

	describe('previous period timestamps', () => {
		it('stamps completed periods at 23:59:59 of their last day', () => {
			const rolloverDate = new Date(2026, 6, 29, 0, 0, 0, 120);
			const previous = new Date(getPreviousPeriodTimestamp(rolloverDate));
			assert.equal(previous.getFullYear(), 2026);
			assert.equal(previous.getMonth(), 6);
			assert.equal(previous.getDate(), 28);
			assert.equal(previous.getHours(), 23);
			assert.equal(previous.getMinutes(), 59);
			assert.equal(previous.getSeconds(), 59);
		});

		it('stays inside the completed month and year at their boundaries', () => {
			const newYear = new Date(getPreviousPeriodTimestamp(new Date(2027, 0, 1, 0, 0, 3)));
			assert.equal(newYear.getFullYear(), 2026);
			assert.equal(newYear.getMonth(), 11);
			assert.equal(newYear.getDate(), 31);

			const newMonth = new Date(getPreviousPeriodTimestamp(new Date(2026, 2, 1, 0, 0, 0)));
			assert.equal(newMonth.getMonth(), 1);
			assert.equal(newMonth.getDate(), 28);
		});

		it('uses the current day for a rollover recovered later in the day', () => {
			const recovered = new Date(2026, 6, 29, 10, 42, 17);
			assert.equal(
				getPeriodBoundaryTimestamp(recovered),
				new Date(2026, 6, 29).getTime(),
			);
			assert.equal(
				getPreviousPeriodTimestamp(recovered),
				getPeriodBoundaryTimestamp(recovered) - 1000,
			);
		});
	});

	describe('first activation period starts', () => {
		it('uses the current reading for empty legacy start values', () => {
			assert.deepEqual(initializePeriodStartValues({
				start_day: 0,
				start_week: '',
				start_month: null,
				start_quarter: undefined,
				start_year: 0,
			}, 7837.612, true), {
				start_day: 7837.612,
				start_week: 7837.612,
				start_month: 7837.612,
				start_quarter: 7837.612,
				start_year: 7837.612,
			});
		});

		it('preserves explicitly configured starts and all values after activation', () => {
			const configured = {
				start_day: 7830,
				start_week: 7800,
				start_month: 7700,
				start_quarter: 7500,
				start_year: 7000,
			};
			assert.deepEqual(initializePeriodStartValues(configured, 7837.612, true), configured);
			assert.deepEqual(initializePeriodStartValues({...configured, start_day: 0}, 7837.612, false), {
				...configured,
				start_day: 0,
			});
		});

		it('fills only missing starts when some historical readings are known', () => {
			assert.deepEqual(initializePeriodStartValues({
				start_day: 0,
				start_week: 7800,
				start_month: 7700,
				start_quarter: 0,
				start_year: 7000,
			}, 7837.612, true), {
				start_day: 7837.612,
				start_week: 7800,
				start_month: 7700,
				start_quarter: 7837.612,
				start_year: 7000,
			});
		});
	});

	describe('current-year period settings', () => {
		const weekdays = ['01_Monday', '02_Tuesday'];
		const months = ['01_January', '02_February'];

		it('maps every enabled switch to its own collection', () => {
			const definitions = getCurrentYearPeriodStateDefinitions({
				currentYearDays: true,
				currentYearPrevious: true,
				currentYearWeek: true,
				currentYearMonth: true,
				currentYearQuarter: true,
			}, weekdays, months);

			assert.equal(definitions.filter(definition => definition.collection === 'currentWeek' && definition.enabled).length, 2);
			assert.equal(definitions.filter(definition => definition.collection === 'previousWeek' && definition.enabled).length, 2);
			assert.equal(definitions.filter(definition => definition.collection === 'weeks' && definition.enabled).length, 53);
			assert.equal(definitions.filter(definition => definition.collection === 'months' && definition.enabled).length, 2);
			assert.equal(definitions.filter(definition => definition.collection === 'quarters' && definition.enabled).length, 4);
		});

		it('marks only disabled collections for cleanup', () => {
			const definitions = getCurrentYearPeriodStateDefinitions({
				currentYearDays: false,
				currentYearPrevious: true,
				currentYearWeek: true,
				currentYearMonth: false,
				currentYearQuarter: false,
			}, weekdays, months);

			assert.equal(definitions.filter(definition => definition.collection === 'weeks' && definition.enabled).length, 53);
			assert.equal(definitions.filter(definition => definition.collection !== 'weeks' && definition.enabled).length, 0);
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

		it('keeps the basic price separate from variable costs when restoring fixed prices', () => {
			const variable = calculateVariablePriceTotals(5584.936, {
				start_day: 5581.891,
				start_week: 5581.891,
				start_month: 5581.891,
				start_quarter: 5581.891,
				start_year: 5571,
			}, 0.35);
			const basic = calculateBasicPriceTotals(19.15, new Date(2026, 7, 1, 12));

			assert.ok(Math.abs(variable.priceYear - 4.8776) < 1e-9);
			assert.ok(Math.abs((variable.priceYear + basic.priceYear) - 158.0776) < 1e-9);
			assert.notEqual(Math.round((variable.priceYear + basic.priceYear) * 100) / 100, 306.48);
		});

		it('treats empty legacy period starts as missing instead of zero', () => {
			const variable = calculateVariablePriceTotals(5584.936, {
				start_day: null,
				start_week: '',
				start_month: '   ',
				start_quarter: undefined,
				start_year: '5571,0',
			}, '0,35');

			assert.equal(variable.priceDay, 0);
			assert.equal(variable.priceWeek, 0);
			assert.equal(variable.priceMonth, 0);
			assert.equal(variable.priceQuarter, 0);
			assert.ok(Math.abs(variable.priceYear - 4.8776) < 1e-9);
		});

		it('removes an included basic price from dynamic and selector memories', () => {
			const legacy = {priceDay: 1.5, priceWeek: 3, priceMonth: 12, priceQuarter: 31, priceYear: 124};
			const basic = {priceDay: 1, priceWeek: 2, priceMonth: 10, priceQuarter: 30, priceYear: 120};
			const expected = {priceDay: 0.5, priceWeek: 1, priceMonth: 2, priceQuarter: 1, priceYear: 4};

			assert.deepEqual(migrateLegacyVariableCostTotals(legacy, basic, expected, 'state', 10, true), expected);
			assert.deepEqual(migrateLegacyVariableCostTotals(legacy, basic, expected, 'selector', 10, true), expected);
		});

		it('does not subtract the basic price from an already variable legacy memory', () => {
			const variable = {priceDay: 0.5, priceWeek: 1, priceMonth: 2, priceQuarter: 1, priceYear: 4};
			const basic = {priceDay: 1, priceWeek: 2, priceMonth: 10, priceQuarter: 30, priceYear: 120};

			assert.deepEqual(migrateLegacyVariableCostTotals(variable, basic, variable, 'state', 10, true), variable);
			assert.deepEqual(migrateLegacyVariableCostTotals(variable, basic, {}, 'state', 10, true), variable);
		});

		it('preserves negative variable costs during legacy migration', () => {
			const migrated = migrateLegacyVariableCostTotals(
				{priceDay: 0.5, priceWeek: 1, priceMonth: 8, priceQuarter: 28, priceYear: 118},
				{priceDay: 1, priceWeek: 2, priceMonth: 10, priceQuarter: 30, priceYear: 120},
				{priceDay: -0.5, priceWeek: -1, priceMonth: -2, priceQuarter: -2, priceYear: -2},
				'state',
				10,
				true,
			);

			assert.deepEqual(migrated, {priceDay: -0.5, priceWeek: -1, priceMonth: -2, priceQuarter: -2, priceYear: -2});
		});

		it('rebuilds one-price fixed memories and preserves memories without a basic price', () => {
			const legacy = {priceDay: 1, priceWeek: 2, priceMonth: 3, priceQuarter: 4, priceYear: 5};
			const fallback = {priceDay: 6, priceWeek: 7, priceMonth: 8, priceQuarter: 9, priceYear: 10};

			assert.deepEqual(migrateLegacyVariableCostTotals(legacy, {}, fallback, 'static', 1, true), fallback);
			assert.deepEqual(migrateLegacyVariableCostTotals(legacy, {}, fallback, 'state', 5, false), legacy);
		});
	});

	describe('calculateHistoricalBasicPriceTotals', () => {
		const localTimestamp = (year, month, day, hour = 0) => new Date(year, month - 1, day, hour).getTime();

		it('charges only August when a tariff starts on August 1', () => {
			const totals = calculateHistoricalBasicPriceTotals(
				[{ts: localTimestamp(2026, 8, 1), price: 19.15}],
				new Date(2026, 7, 2, 12),
			);

			assert.deepEqual(totals, {
				priceDay: 0,
				priceWeek: 19.15,
				priceMonth: 19.15,
				priceQuarter: 19.15,
				priceYear: 19.15,
			});
		});

		it('does not charge before the tariff becomes valid', () => {
			const totals = calculateHistoricalBasicPriceTotals(
				[{ts: localTimestamp(2026, 8, 15), price: 19.15}],
				new Date(2026, 7, 14, 23),
			);

			assert.deepEqual(totals, {priceDay: 0, priceWeek: 0, priceMonth: 0, priceQuarter: 0, priceYear: 0});
		});

		it('books the full first month on a mid-month tariff start', () => {
			const totals = calculateHistoricalBasicPriceTotals(
				[{ts: localTimestamp(2026, 8, 15), price: 19.15}],
				new Date(2026, 7, 15, 12),
			);

			assert.deepEqual(totals, {
				priceDay: 19.15,
				priceWeek: 19.15,
				priceMonth: 19.15,
				priceQuarter: 19.15,
				priceYear: 19.15,
			});
		});

		it('applies a mid-month price change to the next monthly booking', () => {
			const history = [
				{ts: localTimestamp(2026, 8, 1), price: 19.15},
				{ts: localTimestamp(2026, 8, 15), price: 21},
			];
			assert.equal(calculateHistoricalBasicPriceTotals(history, new Date(2026, 7, 20, 12)).priceMonth, 19.15);

			const september = calculateHistoricalBasicPriceTotals(history, new Date(2026, 8, 1, 12));
			assert.equal(september.priceDay, 21);
			assert.equal(september.priceMonth, 21);
			assert.equal(september.priceQuarter, 40.15);
			assert.equal(september.priceYear, 40.15);
		});

		it('uses a new price immediately when it changes at the month boundary', () => {
			const totals = calculateHistoricalBasicPriceTotals([
				{ts: localTimestamp(2026, 8, 1), price: 19.15},
				{ts: localTimestamp(2026, 9, 1), price: 21},
			], new Date(2026, 8, 1, 12));

			assert.equal(totals.priceMonth, 21);
			assert.equal(totals.priceYear, 40.15);
		});

		it('counts only bookings in the current year across a year boundary', () => {
			const totals = calculateHistoricalBasicPriceTotals([
				{ts: localTimestamp(2025, 12, 15), price: 10},
				{ts: localTimestamp(2026, 1, 15), price: 20},
			], new Date(2026, 1, 1, 12));

			assert.equal(totals.priceDay, 20);
			assert.equal(totals.priceMonth, 20);
			assert.equal(totals.priceQuarter, 30);
			assert.equal(totals.priceYear, 30);
		});

		it('preserves negative monthly prices and rejects invalid input', () => {
			const negative = calculateHistoricalBasicPriceTotals(
				[{ts: localTimestamp(2026, 8, 1), price: -5}],
				new Date(2026, 7, 1, 12),
			);
			assert.equal(negative.priceYear, -5);
			assert.deepEqual(calculateHistoricalBasicPriceTotals([], new Date()), {
				priceDay: 0, priceWeek: 0, priceMonth: 0, priceQuarter: 0, priceYear: 0,
			});
			assert.deepEqual(calculateHistoricalBasicPriceTotals([{ts: 1, price: 2}], new Date('invalid')), {
				priceDay: 0, priceWeek: 0, priceMonth: 0, priceQuarter: 0, priceYear: 0,
			});
		});
	});
});
