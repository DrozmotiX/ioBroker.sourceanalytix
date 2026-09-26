'use strict';

const assert = require('node:assert/strict');
const {
	getLegacyOutputId,
	mapOutputTreeId,
	resolveOutputId,
	runQueued,
	validateResolvedOutputId,
	validateOutputId,
	verifyMappedObjects,
} = require('./lib/output-id');

describe('custom output IDs', () => {
	it('keeps the legacy source-derived ID as the default', () => {
		assert.equal(getLegacyOutputId('alias.0.Kitchen.Energy'), 'alias__0__Kitchen__Energy');
		assert.equal(resolveOutputId('', 'alias.0.Kitchen.Energy'), 'alias__0__Kitchen__Energy');
		assert.equal(resolveOutputId(undefined, 'alias.0.Kitchen.Energy'), 'alias__0__Kitchen__Energy');
	});

	it('trims and accepts an explicitly configured ID', () => {
		assert.equal(resolveOutputId('  Kitchen_Energy  ', 'alias.0.Kitchen.Energy'), 'Kitchen_Energy');
	});

	it('accepts safe single-segment IDs', () => {
		for (const value of ['Kitchen_Energy', 'meter-2', 'A', '123']) {
			assert.deepEqual(validateOutputId(value), {valid: true, reason: null});
		}
	});

	it('rejects paths, unsafe characters, excessive length and reserved roots', () => {
		for (const value of ['', 'Kitchen.Energy', 'Kitchen Energy', 'Küche', 'info', 'priceHistory', 'a'.repeat(129)]) {
			assert.equal(validateOutputId(value).valid, false, value);
		}
	});

	it('keeps unusual legacy IDs compatible until the user chooses a custom ID', () => {
		const longSourceId = `adapter.0.${'long-segment-'.repeat(12)}legacy value`;
		assert.deepEqual(validateResolvedOutputId(undefined, longSourceId), {valid: true, reason: null});
		assert.equal(validateResolvedOutputId('legacy value', longSourceId).valid, false);
		assert.equal(validateResolvedOutputId(undefined, 'info').valid, false);
	});

	it('maps every child while rejecting objects outside the source tree', () => {
		const oldRoot = 'sourceanalytix.0.alias__0__Kitchen__Energy';
		const newRoot = 'sourceanalytix.0.Kitchen_Energy';
		assert.equal(mapOutputTreeId(oldRoot, oldRoot, newRoot), newRoot);
		assert.equal(
			mapOutputTreeId(`${oldRoot}.currentYear.consumed.01_currentDay`, oldRoot, newRoot),
			`${newRoot}.currentYear.consumed.01_currentDay`,
		);
		assert.equal(mapOutputTreeId('sourceanalytix.0.other.currentYear', oldRoot, newRoot), null);
	});

	it('verifies copied object definitions while allowing root migration metadata', () => {
		const oldRoot = 'sourceanalytix.0.old';
		const newRoot = 'sourceanalytix.0.new';
		const source = [
			{id: oldRoot, object: {type: 'device', common: {name: 'Meter'}, native: {existing: true}}},
			{id: `${oldRoot}.value`, object: {type: 'state', common: {name: 'Value', unit: 'kWh'}, native: {}}},
		];
		const target = [
			{id: newRoot, object: {type: 'device', common: {name: 'Meter'}, native: {
				existing: true, sourceState: 'alias.0.meter', outputIdSchema: 1, outputMigration: {status: 'copying'},
			}}},
			{id: `${newRoot}.value`, object: {type: 'state', common: {name: 'Value', unit: 'kWh'}, native: {}}},
		];

		assert.equal(verifyMappedObjects(source, target, oldRoot, newRoot), true);
		target[1].object.common.unit = 'Wh';
		assert.equal(verifyMappedObjects(source, target, oldRoot, newRoot), false);
	});
});

describe('serialized source builds', () => {
	const tick = () => new Promise(resolve => setImmediate(resolve));

	it('runs a second build for the same source only after the first has finished', async () => {
		const queues = new Map();
		const events = [];
		/** @type {(value?: unknown) => void} */
		let releaseFirst = () => {};
		const first = runQueued(queues, 'meter', async () => {
			events.push('first:start');
			await new Promise(resolve => { releaseFirst = resolve; });
			events.push('first:end');
			return 'Meter2';
		});
		const second = runQueued(queues, 'meter', async () => {
			events.push('second:start');
			return 'Meter3';
		});
		await tick();
		assert.deepEqual(events, ['first:start']);
		releaseFirst();
		assert.equal(await first, 'Meter2');
		assert.equal(await second, 'Meter3');
		assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
	});

	it('does not block other sources', async () => {
		const queues = new Map();
		const events = [];
		/** @type {(value?: unknown) => void} */
		let releaseFirst = () => {};
		const first = runQueued(queues, 'meter-a', () => new Promise(resolve => { releaseFirst = resolve; }));
		await runQueued(queues, 'meter-b', async () => events.push('b'));
		assert.deepEqual(events, ['b']);
		releaseFirst();
		await first;
	});

	it('continues the queue after a failed build and cleans up when idle', async () => {
		const queues = new Map();
		const failed = runQueued(queues, 'meter', async () => { throw new Error('boom'); });
		const next = runQueued(queues, 'meter', async () => 'ok');
		await assert.rejects(failed, /boom/);
		assert.equal(await next, 'ok');
		await tick();
		assert.equal(queues.size, 0);
	});
});
