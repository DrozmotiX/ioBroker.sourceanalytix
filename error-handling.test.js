'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');

/** @type {(...args: any[]) => any} */
const originalModuleLoad = Reflect.get(Module, '_load');
Reflect.set(Module, '_load', function loadTestDependency(request, parent, isMain) {
	if (request === '@iobroker/adapter-core') return {Adapter: class {}};
	return originalModuleLoad.call(Module, request, parent, isMain);
});
const {Sourceanalytix} = require('./main');
Reflect.set(Module, '_load', originalModuleLoad);

function createAdapter(sentryInstance) {
	const adapter = Object.create(Sourceanalytix.prototype);
	/** @type {Record<string, string[]>} */
	const logs = {debug: [], info: [], warn: [], error: []};
	adapter.log = Object.fromEntries(Object.keys(logs).map(level => [level, message => logs[level].push(message)]));
	adapter.supportsFeature = () => true;
	adapter.getPluginInstance = () => sentryInstance;
	return {adapter, logs};
}

describe('errorHandling', () => {
	it('logs the error on error level when no Sentry plugin instance exists', () => {
		const {adapter, logs} = createAdapter(null);
		adapter.errorHandling('test', new Error('boom'));
		assert.equal(logs.error.length, 1);
		assert.match(logs.error[0], /\[test\] error: boom/);
	});

	it('logs the error and sends it to Sentry when Sentry is enabled', () => {
		const captured = [];
		const {adapter, logs} = createAdapter({getSentryObject: () => ({captureException: msg => captured.push(msg)})});
		adapter.errorHandling('test', 'plain failure');
		assert.equal(logs.error.length, 1);
		assert.match(logs.error[0], /plain failure/);
		assert.equal(captured.length, 1);
	});

	it('still logs the error when sending to Sentry fails', () => {
		const {adapter, logs} = createAdapter({getSentryObject: () => { throw new Error('no sentry'); }});
		adapter.errorHandling('test', new Error('boom'));
		assert.equal(logs.error.length, 1);
		assert.equal(logs.debug.length, 1);
	});
});
