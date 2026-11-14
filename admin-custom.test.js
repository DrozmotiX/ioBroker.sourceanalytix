'use strict';

const assert = require('node:assert/strict');
/** @type {{items: Record<string, Record<string, any>>}} */
const customConfig = require('./admin/jsonCustom.json');
const de = require('./admin/i18n/de.json');
const en = require('./admin/i18n/en.json');

describe('custom settings at the datapoint (#1269)', () => {
	const items = customConfig.items;

	it('only offers switching on and a link to the instance settings', () => {
		const visible = Object.entries(items).filter(([, item]) => item.hidden !== 'true');
		assert.deepEqual(visible.map(([key]) => key), ['_settingsHint', '_openSettings']);
		assert.equal(items._settingsHint.type, 'staticText');
		assert.equal(items._openSettings.type, 'staticText');
		assert.equal(items._openSettings.button, true);
		assert.equal(items._openSettings.href, '_overview');
	});

	it('enables a datapoint with the same defaults as the settings page', () => {
		const defaults = Object.fromEntries(Object.entries(items).filter(([, item]) => item.default !== undefined).map(([key, item]) => [key, item.default]));
		assert.deepEqual(defaults, {consumption: true, costs: true, meter_values: true, deviceResetLogicEnabled: true, threshold: 1});
	});

	it('has the texts in German and English', () => {
		for (const key of [items._settingsHint.text, items._openSettings.text]) {
			assert.ok(de[key], key);
			assert.ok(en[key], key);
		}
	});
});
