'use strict';

/**
 * Pure helpers for the source overview and the problem check of the settings page (#1269).
 */

const {resolveUnit, areUnitsCompatible} = require('./calculation');

/**
 * @returns {SaFinding[]} Empty list of findings
 */
function createFindingList() {
	return [];
}

/**
 * @returns {Record<string, SaStartValueError>} Empty error record
 */
function createErrorRecord() {
	return {};
}

/**
 * @returns {Record<string, number>} Empty number record
 */
function createNumberRecord() {
	return {};
}

/**
 * @returns {SaSourceSummary[]} Empty list of source summaries
 */
function createSummaryList() {
	return [];
}

const startFields = ['start_day', 'start_week', 'start_month', 'start_quarter', 'start_year'];

/**
 * Check the SourceAnalytix settings of a datapoint the way the adapter does at start.
 * @param {object} input - Settings and definitions
 * @param {Record<string, unknown>} input.custom - SourceAnalytix custom settings of the datapoint
 * @param {string | null | undefined} input.unit - Unit of the datapoint (common.unit)
 * @param {Record<string, {unitType: string}>} input.pricesConfig - Loaded price definitions
 * @param {Record<string, {exponent: number, category: string}>} input.unitConfig - Known units
 * @returns {SaFinding[]} Findings, empty if the settings are usable
 */
function diagnoseSourceConfig({custom, unit, pricesConfig, unitConfig}) {
	const findings = createFindingList();
	const selectedUnit = resolveUnit(custom.selectedUnit, unitConfig);
	const detectedUnit = resolveUnit(unit, unitConfig);
	const useUnit = selectedUnit || detectedUnit;
	if (!useUnit) findings.push({code: 'unitMissing', severity: 'error'});
	const priceName = typeof custom.selectedPrice === 'string' ? custom.selectedPrice : '';
	if (!priceName || priceName === 'Choose') {
		findings.push({code: 'noPrice', severity: 'error'});
	} else if (!pricesConfig[priceName]) {
		findings.push({code: 'priceMissing', severity: 'error'});
	} else if (useUnit && !areUnitsCompatible(unitConfig[useUnit], unitConfig[pricesConfig[priceName].unitType])) {
		findings.push({code: 'unitIncompatible', severity: 'error'});
	}
	return findings;
}

/**
 * Start timestamps of the running periods.
 * @param {Date} date - Current date
 * @returns {Record<string, number>} Start per start-value field
 */
function getPeriodStarts(date) {
	const isoWeekday = date.getDay() || 7;
	return {
		start_day: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
		start_week: new Date(date.getFullYear(), date.getMonth(), date.getDate() - isoWeekday + 1).getTime(),
		start_month: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
		start_quarter: new Date(date.getFullYear(), date.getMonth() - (date.getMonth() % 3), 1).getTime(),
		start_year: new Date(date.getFullYear(), 0, 1).getTime(),
	};
}

/**
 * Check start values (#1267, #1269): each is a total at the beginning of its period, so it is
 * at most the current total, and a period that began later has a start value at least as high
 * as one that began earlier. The week is placed by its first day.
 * @param {Record<string, unknown>} startValues - start_day … start_year (numbers or empty)
 * @param {number | null} cumulative - Current total, null if unknown
 * @param {Date} date - Current date
 * @returns {Record<string, SaStartValueError>} Errors per field
 */
function checkStartValues(startValues, cumulative, date) {
	const errors = createErrorRecord();
	const starts = getPeriodStarts(date);
	const values = createNumberRecord();
	for (const field of startFields) {
		const raw = startValues[field];
		if (raw === null || raw === undefined || raw === '') continue;
		const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
		if (!Number.isFinite(value)) {
			errors[field] = {code: 'notNumber'};
			continue;
		}
		if (value < 0) {
			errors[field] = {code: 'negative'};
			continue;
		}
		values[field] = value;
		if (typeof cumulative === 'number' && Number.isFinite(cumulative) && value > cumulative) {
			errors[field] = value / 1000 <= cumulative
				? {code: 'aboveTotalWh', suggestion: value / 1000}
				: {code: 'aboveTotal'};
		}
	}
	const ordered = Object.keys(values).sort((a, b) => starts[a] - starts[b] || startFields.indexOf(b) - startFields.indexOf(a));
	for (let index = 0; index < ordered.length; index++) {
		const field = ordered[index];
		if (errors[field]) continue;
		for (let later = index + 1; later < ordered.length; later++) {
			const laterField = ordered[later];
			if (starts[laterField] > starts[field] && values[field] > values[laterField]) {
				errors[field] = {code: 'order', other: laterField, otherValue: values[laterField]};
				break;
			}
		}
	}
	return errors;
}

/**
 * Build the problem list of the settings page from the source summaries.
 * @param {SaSourceSummary[]} sources - Summaries as returned by getSources
 * @param {number} now - Current timestamp
 * @param {{maxSilenceMs?: number}} [options] - Options
 * @returns {{problems: SaProblem[], passed: string[]}} Problems and checks without findings
 */
function buildProblems(sources, now, options = {}) {
	const maxSilenceMs = options.maxSilenceMs || 3 * 3_600_000;
	const problems = [];
	const add = (source, code, severity, extra = {}) => problems.push({
		id: `${code}:${source.id}`,
		source: source.id,
		name: source.name,
		code,
		severity,
		...extra,
	});
	const today = new Date(now);
	const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

	for (const source of sources) {
		if (source.orphan) {
			if (!source.sourceExists) add(source, 'sourceDeleted', 'error', {fix: {command: 'deleteSourceData'}});
			continue;
		}
		if (!source.enabled) continue;
		if (!source.sourceExists) {
			add(source, 'sourceDeleted', 'error', {fix: {command: 'setSourceEnabled'}});
			continue;
		}
		for (const finding of source.diagnostics || []) add(source, finding.code, finding.severity, {fix: finding.code.startsWith('unit') ? {command: 'fixUnit'} : {command: 'choosePrice'}});
		if (!source.active) continue;
		if (source.valueType === 'string') add(source, 'stringValue', 'warning');
		if (source.pendingRealign) add(source, 'offsetAboveTotal', 'error', {fix: {command: 'setCumulative'}});
		if (!source.resetDetection && (source.decreasesWhileResetOff || 0) > 0) {
			add(source, 'resetDetectionOff', 'warning', {count: source.decreasesWhileResetOff, fix: {command: 'saveSource', message: {settings: {deviceResetLogicEnabled: true}}}});
		}
		const startErrors = checkStartValues(source.settings || {}, typeof source.cumulative === 'number' ? source.cumulative : null, today);
		const firstStartError = Object.entries(startErrors)[0];
		if (firstStartError) add(source, 'startValue', 'error', {field: firstStartError[0], detail: firstStartError[1]});
		if (source.kind === 'power' && typeof source.lastValueTs === 'number' && now - source.lastValueTs > maxSilenceMs) {
			add(source, 'powerSilent', 'warning', {since: source.lastValueTs, guide: 'power-source-maximum-gap'});
		}
		if (typeof source.periodDate === 'string' && source.periodDate < todayKey) {
			add(source, 'rolloverMissed', 'error', {since: source.periodDate, fix: {command: 'recoverPeriods'}});
		}
	}

	// Basic fee booked by several sources of the same price definition (#1268)
	const basicFeeSources = {};
	for (const source of sources) {
		if (!source.enabled || source.orphan || !source.basicRate || !source.priceDefinition) continue;
		(basicFeeSources[source.priceDefinition] = basicFeeSources[source.priceDefinition] || []).push(source);
	}
	for (const [priceDefinition, list] of Object.entries(basicFeeSources)) {
		if (list.length < 2) continue;
		for (const source of list.slice(1)) {
			add(source, 'basicFeeTwice', 'warning', {
				priceDefinition,
				others: list.filter(other => other !== source).map(other => other.name),
				fix: {command: 'saveSource', message: {settings: {basicRate: false}}},
			});
		}
	}

	const checks = ['noPrice', 'unitMissing', 'stringValue', 'offsetAboveTotal', 'resetDetectionOff', 'startValue', 'powerSilent', 'basicFeeTwice', 'sourceDeleted', 'rolloverMissed'];
	const found = new Set(problems.map(problem => problem.code === 'priceMissing' ? 'noPrice' : problem.code === 'unitIncompatible' ? 'unitMissing' : problem.code));
	return {problems, passed: checks.filter(check => !found.has(check))};
}

/**
 * Status of a source for the overview card.
 * @param {SaSourceSummary} source - Source summary
 * @param {SaProblem[]} problems - Problems of all sources
 * @returns {'ok' | 'warning' | 'error' | 'disabled'} Status
 */
function getSourceStatus(source, problems) {
	if (!source.enabled) return 'disabled';
	const own = problems.filter(problem => problem.source === source.id);
	if (own.some(problem => problem.severity === 'error')) return 'error';
	if (own.length) return 'warning';
	return 'ok';
}

module.exports = {
	buildProblems,
	checkStartValues,
	createSummaryList,
	diagnoseSourceConfig,
	getPeriodStarts,
	getSourceStatus,
	startFields,
};
