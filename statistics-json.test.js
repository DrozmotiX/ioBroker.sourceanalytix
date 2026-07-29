'use strict';

const assert = require('node:assert/strict');
const {
	applyStatisticsState,
	createStatisticsSnapshot,
	serializeStatisticsSnapshot,
} = require('./lib/statistics-json');

function createSnapshot(overrides = {}) {
	return createStatisticsSnapshot({
		year: 2026,
		sourceId: 'example.0.meter',
		sourceName: {de: 'Stromzähler', en: 'Electricity meter'},
		unit: 'kWh',
		quantityType: 'consumed',
		financialType: 'costs',
		currency: 'EUR',
		consumption: true,
		costs: true,
		meterValues: true,
		days: true,
		weeks: true,
		months: true,
		quarters: true,
		previous: true,
		...overrides,
	});
}

describe('statistics JSON', () => {
	it('creates the versioned schema with stable optional sections', () => {
		const snapshot = createSnapshot();

		assert.equal(snapshot.schemaVersion, 1);
		assert.equal(snapshot.year, 2026);
		assert.deepEqual(snapshot.source, {
			id: 'example.0.meter',
			name: 'Electricity meter',
			unit: 'kWh',
		});
		assert.equal(snapshot.quantity.type, 'consumed');
		assert.equal(snapshot.financial.type, 'costs');
		assert.equal(snapshot.financial.currency, 'EUR');
		assert.equal(snapshot.meterReadings.current, null);
	});

	it('uses null for disabled calculations and collections', () => {
		const snapshot = createSnapshot({
			consumption: false,
			costs: false,
			meterValues: false,
			days: false,
			weeks: false,
			months: false,
			quarters: false,
			previous: false,
		});

		assert.equal(snapshot.quantity, null);
		assert.equal(snapshot.financial, null);
		assert.equal(snapshot.meterReadings, null);
	});

	it('maps current, previous and collection states to language-neutral keys', () => {
		const snapshot = createSnapshot();

		applyStatisticsState(snapshot, 'currentYear.consumed.01_currentDay', 4.2);
		applyStatisticsState(snapshot, 'currentYear.consumed.03_previousMonth', 109.7);
		applyStatisticsState(snapshot, 'currentYear.consumed.currentWeek.01_Monday', 1.1);
		applyStatisticsState(snapshot, 'currentYear.consumed.previousWeek.07_Sunday', 2.2);
		applyStatisticsState(snapshot, 'currentYear.consumed.weeks.7', 31.2);
		applyStatisticsState(snapshot, 'currentYear.consumed.months.07_July', 114.3);
		applyStatisticsState(snapshot, 'currentYear.consumed.quarters.Q3', 301.8);

		assert.equal(snapshot.quantity.current.day, 4.2);
		assert.equal(snapshot.quantity.previous.month, 109.7);
		assert.equal(snapshot.quantity.periods.weekdays['1'], 1.1);
		assert.equal(snapshot.quantity.periods.previousWeekdays['7'], 2.2);
		assert.equal(snapshot.quantity.periods.weeks['07'], 31.2);
		assert.equal(snapshot.quantity.periods.months['07'], 114.3);
		assert.equal(snapshot.quantity.periods.quarters['3'], 301.8);
	});

	it('supports delivery, earnings and meter readings', () => {
		const snapshot = createSnapshot({
			quantityType: 'delivered',
			financialType: 'earnings',
		});

		applyStatisticsState(snapshot, 'currentYear.delivered.05_currentYear', 894.1);
		applyStatisticsState(snapshot, 'currentYear.earnings.02_currentWeek', 8.5);
		applyStatisticsState(snapshot, 'cumulativeReading', 7837.6);
		applyStatisticsState(snapshot, 'currentYear.meterReadings.01_previousDay', 7833.4);
		applyStatisticsState(snapshot, 'currentYear.meterReadings.months.01_January', 7723.3);

		assert.equal(snapshot.quantity.current.year, 894.1);
		assert.equal(snapshot.financial.current.week, 8.5);
		assert.equal(snapshot.meterReadings.current, 7837.6);
		assert.equal(snapshot.meterReadings.previous.day, 7833.4);
		assert.equal(snapshot.meterReadings.periods.months['01'], 7723.3);
	});

	it('ignores paths from inactive categories and serializes valid JSON', () => {
		const snapshot = createSnapshot();

		assert.equal(applyStatisticsState(snapshot, 'currentYear.delivered.01_currentDay', 99), false);
		assert.equal(snapshot.quantity.current.day, null);
		assert.deepEqual(JSON.parse(serializeStatisticsSnapshot(snapshot)), snapshot);
	});
});
