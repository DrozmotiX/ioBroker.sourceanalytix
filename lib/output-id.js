'use strict';

const RESERVED_OUTPUT_IDS = new Set([
	'info',
	'priceDefinitions',
	'priceHistory',
	'basicPriceHistory',
]);

/**
 * @param {string} sourceId - Full source state ID
 * @returns {string} Legacy SourceAnalytix device ID
 */
function getLegacyOutputId(sourceId) {
	return String(sourceId || '').split('.').join('__');
}

/**
 * @param {unknown} configuredOutputId - User-configured output ID
 * @param {string} sourceId - Full source state ID
 * @returns {string} Configured ID or the backward-compatible legacy ID
 */
function resolveOutputId(configuredOutputId, sourceId) {
	if (typeof configuredOutputId === 'string' && configuredOutputId.trim()) return configuredOutputId.trim();
	return getLegacyOutputId(sourceId);
}

/**
 * @param {unknown} outputId - Candidate output ID
 * @returns {{valid: boolean, reason: string|null}} Validation result
 */
function validateOutputId(outputId) {
	if (typeof outputId !== 'string' || outputId.length === 0) {
		return {valid: false, reason: 'must not be empty'};
	}
	if (outputId.length > 128) {
		return {valid: false, reason: 'must not exceed 128 characters'};
	}
	if (!/^[A-Za-z0-9_-]+$/.test(outputId)) {
		return {valid: false, reason: 'may contain only letters, numbers, underscores and hyphens'};
	}
	if (RESERVED_OUTPUT_IDS.has(outputId)) {
		return {valid: false, reason: 'is reserved by SourceAnalytix'};
	}
	return {valid: true, reason: null};
}

/**
 * Validate a configured ID while preserving source-derived IDs created by older versions.
 * @param {unknown} configuredOutputId - User-configured output ID
 * @param {string} sourceId - Full source state ID
 * @returns {{valid: boolean, reason: string|null}} Validation result
 */
function validateResolvedOutputId(configuredOutputId, sourceId) {
	const effectiveOutputId = resolveOutputId(configuredOutputId, sourceId);
	const validation = validateOutputId(effectiveOutputId);
	const explicitlyConfigured = typeof configuredOutputId === 'string' && !!configuredOutputId.trim();
	if (!validation.valid && !explicitlyConfigured
		&& effectiveOutputId === getLegacyOutputId(sourceId)
		&& validation.reason !== 'is reserved by SourceAnalytix') {
		return {valid: true, reason: null};
	}
	return validation;
}

/**
 * @param {string} objectId - Full object ID below the old root
 * @param {string} oldRoot - Full old root ID
 * @param {string} newRoot - Full new root ID
 * @returns {string|null} Mapped object ID, or null when it is outside the tree
 */
function mapOutputTreeId(objectId, oldRoot, newRoot) {
	if (objectId === oldRoot) return newRoot;
	if (!objectId.startsWith(`${oldRoot}.`)) return null;
	return `${newRoot}${objectId.slice(oldRoot.length)}`;
}

/**
 * @param {object} object - ioBroker object
 * @param {boolean} root - Whether the object is the output root
 * @returns {object} Stable object content used for migration verification
 */
function getComparableObject(object, root) {
	const native = JSON.parse(JSON.stringify(object.native || {}));
	if (root) {
		delete native.sourceState;
		delete native.outputIdSchema;
		delete native.outputMigration;
	}
	return {
		type: object.type,
		common: object.common || {},
		native,
		acl: object.acl || null,
	};
}

/**
 * @param {Array<{id: string, object: object}>} sourceObjects - Objects below the old root
 * @param {Array<{id: string, object: object}>} targetObjects - Objects below the new root
 * @param {string} oldRoot - Full old root ID
 * @param {string} newRoot - Full new root ID
 * @returns {boolean} Whether IDs and persisted object content match
 */
function verifyMappedObjects(sourceObjects, targetObjects, oldRoot, newRoot) {
	if (sourceObjects.length !== targetObjects.length) return false;
	const targets = new Map(targetObjects.map(entry => [entry.id, entry.object]));
	return sourceObjects.every(entry => {
		const targetId = mapOutputTreeId(entry.id, oldRoot, newRoot);
		const target = targetId ? targets.get(targetId) : null;
		if (!target) return false;
		const isRoot = entry.id === oldRoot;
		return JSON.stringify(getComparableObject(entry.object, isRoot))
			=== JSON.stringify(getComparableObject(target, isRoot));
	});
}

module.exports = {
	getLegacyOutputId,
	mapOutputTreeId,
	resolveOutputId,
	validateResolvedOutputId,
	validateOutputId,
	verifyMappedObjects,
};
