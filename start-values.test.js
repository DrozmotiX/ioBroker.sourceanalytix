'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const {buildUnitConfig, isIntegratedUnit} = require('./lib/calculation');
const {checkStartValues, parseStartValueInput, START_FIELDS} = require('./lib/source-checks');
const customConfig = require('./admin/jsonCustom.json');
const schema = customConfig.items;

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
Reflect.set(Module, '_load', originalModuleLoad);

function executeCustom(expression, data, customObj) {
	return new Function('data', 'originalData', '_system', 'instanceObj', 'customObj', '_socket', 'arrayIndex', 'globalData', '_changed', `return ${expression}`,
	)(data, {}, {}, {}, customObj, {}, 0, {}, false);
}

const source = {_id: '0_userdata.0.energy', common: {unit: 'kWh'}};

/**
 * @param {Record<string, unknown>} values - Start values and settings
 * @returns {Record<string, boolean>} Validator result per start value field
 */
function validateDialog(values) {
	const data = {enabled: true, selectedPrice: 'Electricity', ...values};
	return Object.fromEntries(START_FIELDS.map(field => [field, executeCustom(schema[field].validator, data, source)]));
}

describe('start values (#1267)', () => {
	describe('parsing', () => {
		it('accepts comma and dot as decimal mark', () => {
			assert.equal(parseStartValueInput('12,5'), 12.5);
			assert.equal(parseStartValueInput('12.5'), 12.5);
			assert.equal(parseStartValueInput(' 100 '), 100);
			assert.equal(parseStartValueInput(7), 7);
		});

		it('treats empty fields as not set', () => {
			assert.equal(parseStartValueInput(''), null);
			assert.equal(parseStartValueInput(undefined), null);
			assert.equal(parseStartValueInput(null), null);
		});

		it('rejects thousands separators and text', () => {
			assert.ok(Number.isNaN(parseStartValueInput('1.234,5')));
			assert.ok(Number.isNaN(parseStartValueInput('12 kWh')));
			assert.ok(Number.isNaN(parseStartValueInput('abc')));
		});
	});

	describe('checks', () => {
		// Friday 2 October 2026: the week began on Monday 28 September, before the month
		const date = new Date(2026, 9, 2, 12);

		it('accepts consistent start values', () => {
			assert.deepEqual(checkStartValues({start_day: 500, start_week: 450, start_month: 480, start_quarter: 480, start_year: 100}, 510, date), []);
		});

		it('reports start values above the current total', () => {
			assert.deepEqual(checkStartValues({start_day: 600}, 510, date), [{field: 'start_day', problem: 'aboveReading'}]);
		});

		it('places the week by its start date', () => {
			// The week began before the month, so its start value cannot be larger than the month's
			assert.deepEqual(checkStartValues({start_week: 490, start_month: 480}, 510, date), [{field: 'start_week', problem: 'order', other: 'start_month'}]);
			// Mid-month the week began after the month
			const midMonth = new Date(2026, 9, 15, 12);
			assert.deepEqual(checkStartValues({start_week: 490, start_month: 480}, 510, midMonth), []);
			assert.deepEqual(checkStartValues({start_week: 470, start_month: 480}, 510, midMonth), [{field: 'start_month', problem: 'order', other: 'start_week'}]);
		});

		it('requires the same value for periods that began at the same moment', () => {
			// 1 October begins the month and the quarter
			assert.deepEqual(checkStartValues({start_month: 480, start_quarter: 470}, 510, date), [{field: 'start_month', problem: 'order', other: 'start_quarter'}]);
			assert.deepEqual(checkStartValues({start_month: 470, start_quarter: 480}, 510, date), [{field: 'start_quarter', problem: 'order', other: 'start_month'}]);
		});

		it('reports invalid numbers', () => {
			assert.deepEqual(checkStartValues({start_year: '1.234,5'}, 510, date), [{field: 'start_year', problem: 'format'}]);
		});

		it('skips the total check when no total is known', () => {
			assert.deepEqual(checkStartValues({start_day: 600}, null, date), []);
		});
	});

	describe('custom dialog', () => {
		it('uses text fields without a default, so comma and empty values are possible', () => {
			for (const field of START_FIELDS) {
				assert.equal(schema[field].type, 'text', field);
				assert.equal(schema[field].default, undefined, field);
				assert.equal(schema[field].validatorNoSaveOnError, true, field);
			}
		});

		it('asks the adapter for the current total of the source', () => {
			assert.equal(schema._startValueContext.defaultSendTo, 'getStartValueContext');
			assert.equal(schema._startValueContext.allowSaveWithError, true);
		});

		it('validates like the adapter for many combinations', () => {
			const candidates = ['', 100, 450, '480,5', 490, 500, 600, 'x', '1.000,5'];
			const context = {readings: {Electricity: 510}, units: {Electricity: 'kWh'}};
			let seed = 7;
			const random = () => {
				seed = (seed * 16807) % 2147483647;
				return candidates[seed % candidates.length];
			};
			for (let run = 0; run < 400; run++) {
				const values = Object.fromEntries(START_FIELDS.map(field => [field, random()]));
				// The dialog marks both fields of an order problem
				const expected = new Set(checkStartValues(values, 510, new Date()).flatMap(problem => [problem.field, problem.other].filter(Boolean)));
				const actual = validateDialog({...values, _startValueContext: context});
				for (const field of START_FIELDS) {
					assert.equal(actual[field], !expected.has(field), `${field} in ${JSON.stringify(values)}`);
				}
			}
		});

		it('checks the total of the selected price definition only when it is known', () => {
			assert.equal(validateDialog({start_day: 600}).start_day, true);
			assert.equal(validateDialog({start_day: 600, _startValueContext: {readings: {Gas: 900}, units: {}}}).start_day, true);
			assert.equal(validateDialog({start_day: 600, _startValueContext: {readings: {Electricity: 510}, units: {}}}).start_day, false);
		});

		it('does not block disabled sources or several sources edited at once', () => {
			assert.equal(validateDialog({enabled: false, start_day: 'x'}).start_day, true);
			assert.equal(validateDialog({start_day: ['1', '2']}).start_day, true);
		});
	});
});

describe('power units are handled alike (#1267)', () => {
	const units = buildUnitConfig();

	it('treats every power unit as integrated, not only W', () => {
		for (const unit of ['W', 'kW', 'MW', 'GW', 'mW']) assert.equal(isIntegratedUnit(unit, units), true, unit);
		for (const unit of ['Wh', 'kWh', 'm³', 'l', '']) assert.equal(isIntegratedUnit(unit, units), false, unit);
	});

	it('closes running kW intervals at midnight like W intervals', () => {
		const adapter = Object.create(Sourceanalytix.prototype);
		assert.equal(adapter.isIntegratedSource({stateUnit: 'kW'}), true);
		assert.equal(adapter.isIntegratedSource({stateUnit: 'kWh'}), false);
		assert.equal(adapter.isIntegratedSource(undefined), false);
	});
});

describe('current total for the dialog (#1267)', () => {
	/**
	 * @param {{activeStates?: Record<string, any>, object?: any, state?: any}} [options] - Adapter memory and source
	 */
	function createAdapter({activeStates = {}, object = null, state = null} = {}) {
		const adapter = Object.create(Sourceanalytix.prototype);
		/** @type {Record<string, string[]>} */
		const logs = {debug: [], info: [], warn: [], error: []};
		adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
		adapter.namespace = 'sourceanalytix.0';
		adapter.unitPriceDef = {
			unitConfig: buildUnitConfig(),
			pricesConfig: {Electricity: {unitType: 'kWh'}, Gas: {unitType: 'm³'}, ElectricityWh: {unitType: 'Wh'}},
		};
		adapter.activeStates = activeStates;
		adapter.getForeignObjectAsync = async () => object;
		adapter.getForeignStateAsync = async () => state;
		return {adapter, logs};
	}

	it('uses the known total of a running source', async () => {
		const {adapter} = createAdapter({activeStates: {
			'meter.0.energy': {stateDetails: {useUnit: 'kWh'}, calcValues: {cumulativeValue: 1234.5}},
		}});
		const context = await adapter.getStartValueContext('meter.0.energy');
		assert.deepEqual(context.readings, {Electricity: 1234.5, ElectricityWh: 1234500});
		assert.equal(context.units.Gas, 'm³');
	});

	it('uses the device value of a source that is not running yet', async () => {
		const {adapter} = createAdapter({object: {common: {unit: 'Wh'}}, state: {val: '5000,5'}});
		const context = await adapter.getStartValueContext('meter.0.energy');
		assert.deepEqual(context.readings, {Electricity: 5.0005, ElectricityWh: 5000.5});
	});

	it('starts power sources at 0', async () => {
		const {adapter} = createAdapter({object: {common: {unit: 'kW'}}, state: {val: 3}});
		const context = await adapter.getStartValueContext('meter.0.power');
		assert.deepEqual(context.readings, {Electricity: 0, ElectricityWh: 0});
	});

	it('returns no total without a source ID', async () => {
		const {adapter} = createAdapter();
		assert.deepEqual((await adapter.getStartValueContext(undefined)).readings, {});
	});

	it('warns at start about start values that produce negative values', () => {
		const {adapter, logs} = createAdapter();
		adapter.warnAboutStartValues('meter.0.energy', {start_day: 600, start_year: 100}, 510);
		assert.equal(logs.warn.length, 1);
		assert.match(logs.warn[0], /Start value day \(600\) of meter\.0\.energy is larger than the current total 510/);
	});
});
