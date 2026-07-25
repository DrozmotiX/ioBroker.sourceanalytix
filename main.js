'use strict';

/*
 * Created with @ioBroker/create-adapter v1.11.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const adapterHelpers = require('iobroker-adapter-helpers'); // Lib used for Unit calculations
const schedule = require('cron').CronJob; // Cron Scheduler
const calculation = require('./lib/calculation');
const dynamicPricing = require('./lib/dynamic-pricing');

// Sentry error reporting, disable when testing alpha source code locally!
const disableSentry = false;

// Store all days and months
const basicStates = ['01_currentDay', '02_currentWeek', '03_currentMonth', '04_currentQuarter', '05_currentYear'];
const basicPreviousStates = ['01_previousDay', '02_previousWeek', '03_previousMonth', '04_previousQuarter', '05_previousYear'];
const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');
const stateDeletion = true, previousCalculationRounded = {};
const storeSettings = {};
let calcBlock = null; // Global variable to block all calculations
let delay = null; // Global array for all running timers
let useCurrency = null;

// Create variables for object arrays
const actualDate = {}; //, currentDay = null;

class Sourceanalytix extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter startup options
	 */
	constructor(options) {
		super({
			...options,
			name: 'sourceanalytix',
		});

		this.on('ready', this.onReady.bind(this));
		this.on('objectChange', this.onObjectChange.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		// Unit and price definitions, will be loaded at adapter start.
		this.unitPriceDef = {
			unitConfig: {},
			pricesConfig: {}
		};
		this.activeStates = {}; // Array of activated states for SourceAnalytix
		this.dynamicPriceStates = {}; // Price source state ID -> price definition categories
		this.priceControlStates = {}; // Writable local price state ID -> price definition category
		this.priceHistories = {}; // Price definition category -> ordered price history
		this.validStates = {}; // Array of all created states
		this.visWidgetJson ={}; // Array containing all calculation values to use in vis widget
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		try {

			this.log.info('Welcome to SourceAnalytix, making things ready ... ');

			// Block all calculation functions during startup
			calcBlock = true;

			// Get system currency, use € as fallback in case of errors
			const sys_conf = await this.getForeignObjectAsync('system.config');
			if (sys_conf && sys_conf.common.currency){
				useCurrency = sys_conf.common.currency;
			} else {
				useCurrency = '€';
			}

			// Load Unit definitions from helper library & prices from admin to workable memory array
			await this.definitionLoader();

			// Store current data/time information to memory
			await this.refreshDates();

			// Load setting for Year statistics from admin settings
			storeSettings.storeWeeks = this.config.store_weeks;
			storeSettings.storeMonths = this.config.store_months;
			storeSettings.storeQuarters = this.config.store_quarters;

			// Get all objects with custom configuration items
			const customStateArray = await this.getObjectViewAsync('system', 'custom', {});
			this.log.debug(`All states with custom items : ${JSON.stringify(customStateArray)}`);

			// List all states with custom configuration
			if (customStateArray && customStateArray.rows) {	// Verify first if result is not empty

				// Loop truth all states and check if state is activated for SourceAnalytix
				for (const index in customStateArray.rows) {

					if (customStateArray.rows[index].value) { // Avoid crash if object is null or empty

						// Check if custom object contains data for SourceAnalytix
						if (customStateArray.rows[index].value[this.namespace]){

							// Simplify stateID
							const stateID = customStateArray.rows[index].id;
							this.log.debug(`SourceAnalytix configuration found for ${stateID}`);

							// Check if custom object is enabled for SourceAnalytix
							if(customStateArray.rows[index].value[this.namespace].enabled){
								// Prepare array in constructor for further processing
								this.activeStates[stateID] = {};
								this.log.debug(`SourceAnalytix enabled state found ${stateID}`);
							} else {
								this.log.debug(`SourceAnalytix configuration found but not Enabled, skipping ${stateID}`);
							}

						} else {
							this.log.debug(`No SourceAnalytix configuration found, skipping state`);
						}
					}
				}
			}

			// Prepare memory values to count amount of activated states
			const totalEnabledStates = Object.keys(this.activeStates).length;
			let totalInitiatedStates = 0;
			let totalFailedStates = 0;

			this.log.info(`Found ${totalEnabledStates} SourceAnalytix enabled states`);

			// Initialize all discovered states
			let count = 1;
			for (const stateID in this.activeStates) {
				this.log.info(`Initialising "${stateID}" | (${count} of ${totalEnabledStates})`);

				// Store relevant information into memory to handle calculations
				const memoryReady = await this.buildStateDetailsArray(stateID);

				if (memoryReady) {
					await this.initialize(stateID);
					totalInitiatedStates = totalInitiatedStates + 1;
					this.log.info(`Initialization of ${stateID} successfully`);
				} else {
					this.log.error(`Initialization of ${stateID} failed, check warn messages !`);
					totalFailedStates = totalFailedStates + 1;
				}
				count = count + 1;
			}

			// Start Daily reset function by cron job
			await this.resetStartValues();

			// Subscribe on all foreign objects to detect (de)activation of sourceanalytix enabled states
			this.subscribeForeignObjects('*');

			// Enable all calculations with timeout of 500 ms
			if (delay) {
				this.clearTimeout(delay);
				delay = null;
			}
			delay = this.setTimeout(function () {
				calcBlock = false;
			}, 500);

			if (totalFailedStates > 0) {
				this.log.error(`Cannot handle calculations for ${totalFailedStates} of ${totalEnabledStates} enabled states, check error messages`);
				if (totalFailedStates < totalEnabledStates){
					this.log.warn(`Partially activated SourceAnalytix for ${totalInitiatedStates} of ${totalEnabledStates} states, check error messages!`);
				}
			} else {
				this.log.info(`Successfully activated SourceAnalytix for all ${totalInitiatedStates} of ${totalEnabledStates} states, will do my Job until you stop me!`);
			}

			//ToDo: add cleanup for unused states
			// this.cleanupUnused()

		} catch (error) {
			this.errorHandling('[onReady]', error);
		}

	}

	/**
	 * Convert configured or state-provided prices to numbers.
	 * @param {ioBroker.StateValue | undefined} value - Price value from settings or ioBroker state
	 * @returns {number | null} Parsed price, or null if the value is not numeric
	 */
	parsePriceValue(value) {
		return dynamicPricing.parsePriceValue(value);
	}

	/**
	 * @param {ioBroker.StateValue | undefined} value - Input value
	 * @param {number} defaultValue - Fallback for non-numeric values
	 * @returns {number} Parsed number or the provided fallback
	 */
	getNumberOrDefault(value, defaultValue) {
		const parsedValue = this.parsePriceValue(value);
		return parsedValue === null ? defaultValue : parsedValue;
	}

	/**
	 * Add the configured monthly basic price to current period totals.
	 * @param {string} stateID - Source state ID
	 * @param {object} totals - Variable cost totals
	 * @param {Date} date - Calculation date
	 * @returns {Promise<object>} Rounded totals including the basic price
	 */
	async addBasicPriceTotals(stateID, totals, date) {
		const activeState = this.activeStates[stateID];
		const includeBasicPrice = !!(activeState && activeState.stateDetails && activeState.stateDetails.basicRate);
		const monthlyPrice = includeBasicPrice ? this.getNumberOrDefault(activeState.prices.basicPrice, 0) : 0;
		const basicTotals = calculation.calculateBasicPriceTotals(monthlyPrice, date);

		return {
			priceDay: await this.roundCosts(this.getNumberOrDefault(totals.priceDay, 0) + basicTotals.priceDay),
			priceWeek: await this.roundCosts(this.getNumberOrDefault(totals.priceWeek, 0) + basicTotals.priceWeek),
			priceMonth: await this.roundCosts(this.getNumberOrDefault(totals.priceMonth, 0) + basicTotals.priceMonth),
			priceQuarter: await this.roundCosts(this.getNumberOrDefault(totals.priceQuarter, 0) + basicTotals.priceQuarter),
			priceYear: await this.roundCosts(this.getNumberOrDefault(totals.priceYear, 0) + basicTotals.priceYear),
		};
	}

	/**
	 * @param {string} stateID - Source state ID
	 * @returns {boolean} Whether the state uses a dynamic price source
	 */
	isDynamicPriceState(stateID) {
		const activeState = this.activeStates[stateID];
		return !!(activeState && activeState.prices && activeState.prices.priceSource === 'state');
	}

	/**
	 * @param {string} stateID - Source state ID
	 * @returns {boolean} Whether costs must be accumulated against historical prices
	 */
	usesHistoricalCostCalculation(stateID) {
		const activeState = this.activeStates[stateID];
		return !!(activeState && activeState.stateDetails && activeState.stateDetails.costs && activeState.prices);
	}

	/**
	 * @param {number | string | null | undefined} timestamp - ioBroker timestamp
	 * @returns {number} Valid timestamp or the current time
	 */
	getTimestampOrNow(timestamp) {
		const parsedTimestamp = Number(timestamp);
		return Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 ? parsedTimestamp : Date.now();
	}

	/**
	 * @param {ioBroker.State | null | undefined} state - ioBroker state
	 * @returns {number} State change timestamp or the current time
	 */
	getStateChangeTimestamp(state) {
		return this.getTimestampOrNow(state && (state.lc || state.ts));
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 * @returns {string} Local state ID for the price history
	 */
	getPriceHistoryStateName(priceDefinition) {
		return `priceHistory.${priceDefinition.toString().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 * @returns {string} Local writable state ID
	 */
	getPriceControlStateName(priceDefinition) {
		return `priceDefinitions.${priceDefinition.toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.currentPrice`;
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 * @returns {string} State which remembers the last processed admin price
	 */
	getConfiguredPriceStateName(priceDefinition) {
		return `priceDefinitions.${priceDefinition.toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.configuredPrice`;
	}

	/**
	 * Store a fixed price only when the admin setting actually changed.
	 * @param {string} priceDefinition - Price definition category
	 * @param {number} configuredPrice - Price from adapter settings
	 * @param {unknown} validFrom - Optional effective date
	 */
	async storeConfiguredPrice(priceDefinition, configuredPrice, validFrom) {
		const stateName = this.getConfiguredPriceStateName(priceDefinition);
		await this.extendObjectAsync(stateName, {
			type: 'state',
			common: {
				name: `Configured price ${priceDefinition}`,
				type: 'number',
				role: 'value.price',
				read: true,
				write: false,
			},
			native: {priceDefinition},
		});
		const storedConfigState = await this.getStateAsync(stateName);
		const storedConfigPrice = storedConfigState ? this.parsePriceValue(storedConfigState.val) : null;
		if (storedConfigPrice !== configuredPrice || (validFrom !== null && validFrom !== undefined && validFrom !== '')) {
			const priceTimestamp = dynamicPricing.parseValidityTimestamp(validFrom, Date.now());
			await this.storeDynamicPriceHistory(priceDefinition, configuredPrice, priceTimestamp);
		}
		await this.setStateChangedAsync(stateName, {val: configuredPrice, ack: true});
	}

	/**
	 * Create and publish the current unit price for scripts and VIS.
	 * @param {string} priceDefinition - Price definition category
	 * @param {number} unitPrice - Current unit price
	 * @param {string} unit - Consumption unit
	 */
	async ensurePriceControlState(priceDefinition, unitPrice, unit) {
		const stateName = this.getPriceControlStateName(priceDefinition);
		await this.extendObjectAsync(stateName, {
			type: 'state',
			common: {
				name: `Current price ${priceDefinition}`,
				type: 'number',
				role: 'value.price',
				read: true,
				write: true,
				unit: `${useCurrency}/${unit}`,
			},
			native: {priceDefinition},
		});
		this.priceControlStates[`${this.namespace}.${stateName}`] = priceDefinition;
		this.subscribeStates(stateName);
		await this.setStateChangedAsync(stateName, {val: unitPrice, ack: true});
	}

	/**
	 * Update the active price definition and all states which use it.
	 * @param {string} priceDefinition - Price definition category
	 * @param {number} unitPrice - New unit price
	 */
	async applyCurrentPrice(priceDefinition, unitPrice) {
		const priceConfig = this.unitPriceDef.pricesConfig[priceDefinition];
		if (!priceConfig) return;
		priceConfig.uPpU = unitPrice;
		for (const stateID in this.activeStates) {
			const activeState = this.activeStates[stateID];
			if (activeState && activeState.stateDetails && activeState.stateDetails.stateType === priceDefinition) {
				activeState.prices.unitPrice = unitPrice;
			}
		}
		await this.setStateChangedAsync(this.getPriceControlStateName(priceDefinition), {val: unitPrice, ack: true});
	}

	/**
	 * @param {Array<{ts: number | string, price: ioBroker.StateValue}>} historyEntries - Raw history entries
	 * @returns {Array<{ts: number, price: number}>} Sorted and validated price history
	 */
	normalizePriceHistory(historyEntries) {
		return dynamicPricing.normalizePriceHistory(historyEntries);
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 */
	async ensurePriceHistoryState(priceDefinition) {
		const stateName = this.getPriceHistoryStateName(priceDefinition);
		await this.extendObjectAsync(stateName, {
			type: 'state',
			common: {
				name: `Price history ${priceDefinition}`,
				type: 'string',
				role: 'json',
				read: true,
				write: false,
				def: '[]',
			},
			native: {
				priceDefinition: priceDefinition
			},
		});
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 * @returns {Promise<Array<{ts: number, price: number}>>} Stored price history
	 */
	async loadPriceHistory(priceDefinition) {
		if (this.priceHistories[priceDefinition]) return this.priceHistories[priceDefinition];

		await this.ensurePriceHistoryState(priceDefinition);
		const stateName = this.getPriceHistoryStateName(priceDefinition);
		const historyState = await this.getStateAsync(stateName);
		let historyEntries = [];
		if (historyState && historyState.val) {
			try {
				historyEntries = JSON.parse(historyState.val.toString());
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.log.warn(`[loadPriceHistory] Cannot parse dynamic price history for ${priceDefinition}: ${message}`);
			}
		}
		this.priceHistories[priceDefinition] = this.normalizePriceHistory(historyEntries);
		return this.priceHistories[priceDefinition];
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 */
	async persistPriceHistory(priceDefinition) {
		await this.ensurePriceHistoryState(priceDefinition);
		const stateName = this.getPriceHistoryStateName(priceDefinition);
		await this.setStateAsync(stateName, {
			val: JSON.stringify(this.priceHistories[priceDefinition] || []),
			ack: true
		});
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 * @param {ioBroker.StateValue | undefined} price - Dynamic unit price
	 * @param {number | string | null | undefined} timestamp - Timestamp from price state
	 * @returns {Promise<boolean>} Whether the stored history changed
	 */
	async storeDynamicPriceHistory(priceDefinition, price, timestamp) {
		const priceNumber = this.parsePriceValue(price);
		if (priceNumber === null) {
			this.log.warn(`[storeDynamicPriceHistory] Cannot store dynamic price ${JSON.stringify(price)} for ${priceDefinition}, value is not numeric`);
			return false;
		}

		const history = await this.loadPriceHistory(priceDefinition);
		const priceTimestamp = this.getTimestampOrNow(timestamp);
		const existingEntry = history.find(entry => entry.ts === priceTimestamp);
		if (existingEntry) {
			if (existingEntry.price === priceNumber) return false;
			existingEntry.price = priceNumber;
			this.priceHistories[priceDefinition] = this.normalizePriceHistory(history);
			await this.persistPriceHistory(priceDefinition);
			return true;
		}

		const previousEntry = history.filter(entry => entry.ts <= priceTimestamp).at(-1) || null;
		if (previousEntry && previousEntry.price === priceNumber) return false;

		history.push({ts: priceTimestamp, price: priceNumber});
		this.priceHistories[priceDefinition] = this.normalizePriceHistory(history);
		await this.persistPriceHistory(priceDefinition);
		this.log.info(`Stored unit price ${priceNumber} for ${priceDefinition} at ${new Date(priceTimestamp).toISOString()}`);
		return true;
	}

	/**
	 * @param {string} priceDefinition - Price definition category
	 * @param {number} timestamp - Consumption timestamp
	 * @param {ioBroker.StateValue | undefined} fallbackPrice - Fallback unit price
	 * @returns {Promise<number | null>} Price valid at the timestamp, or null if none is available
	 */
	async getDynamicPriceForTimestamp(priceDefinition, timestamp, fallbackPrice) {
		const priceTimestamp = this.getTimestampOrNow(timestamp);
		const history = await this.loadPriceHistory(priceDefinition);
		return dynamicPricing.getPriceForTimestamp(history, priceTimestamp, fallbackPrice);
	}

	/**
	 * Split a cumulative meter delta over all dynamic price intervals between two readings.
	 * @param {string} priceDefinition - Price definition category
	 * @param {number} delta - Consumption delta
	 * @param {number | string | null | undefined} startTimestamp - Previous reading timestamp
	 * @param {number | string | null | undefined} endTimestamp - Current reading timestamp
	 * @param {ioBroker.StateValue | undefined} fallbackPrice - Fallback unit price
	 * @returns {Promise<number | null>} Cost delta across all applicable price intervals
	 */
	async calculateDynamicPriceDelta(priceDefinition, delta, startTimestamp, endTimestamp, fallbackPrice) {
		const endTs = this.getTimestampOrNow(endTimestamp);
		const history = await this.loadPriceHistory(priceDefinition);
		return dynamicPricing.calculatePriceDelta(history, delta, startTimestamp, endTs, fallbackPrice);
	}

	/**
	 * @param {number} reading - Current cumulative reading
	 * @param {object} calcValues - Stored period start values
	 * @param {number} unitPrice - Unit price for fallback calculation
	 * @returns {object} Cost totals calculated with the fallback price
	 */
	getFallbackDynamicCostTotals(reading, calcValues, unitPrice) {
		return {
			priceDay: unitPrice * (reading - this.getNumberOrDefault(calcValues.start_day, reading)),
			priceWeek: unitPrice * (reading - this.getNumberOrDefault(calcValues.start_week, reading)),
			priceMonth: unitPrice * (reading - this.getNumberOrDefault(calcValues.start_month, reading)),
			priceQuarter: unitPrice * (reading - this.getNumberOrDefault(calcValues.start_quarter, reading)),
			priceYear: unitPrice * (reading - this.getNumberOrDefault(calcValues.start_year, reading)),
		};
	}

	/**
	 * @param {string} stateID - Local ioBroker state ID
	 * @param {number} fallback - Fallback value
	 * @returns {Promise<number>} Stored cost value or fallback
	 */
	async readCostStateOrFallback(stateID, fallback) {
		try {
			const state = await this.getStateAsync(stateID);
			const stateValue = state ? this.parsePriceValue(state.val) : null;
			return stateValue === null ? fallback : stateValue;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.debug(`[readCostStateOrFallback] Could not read ${stateID}, using fallback ${fallback}: ${message}`);
			return fallback;
		}
	}

	/**
	 * @param {object} dynamicCosts - Dynamic cost memory
	 * @returns {Promise<object>} Rounded dynamic cost totals
	 */
	async roundDynamicCostTotals(dynamicCosts) {
		return {
			priceDay: await this.roundCosts(this.getNumberOrDefault(dynamicCosts.totals.priceDay, 0)),
			priceWeek: await this.roundCosts(this.getNumberOrDefault(dynamicCosts.totals.priceWeek, 0)),
			priceMonth: await this.roundCosts(this.getNumberOrDefault(dynamicCosts.totals.priceMonth, 0)),
			priceQuarter: await this.roundCosts(this.getNumberOrDefault(dynamicCosts.totals.priceQuarter, 0)),
			priceYear: await this.roundCosts(this.getNumberOrDefault(dynamicCosts.totals.priceYear, 0)),
		};
	}

	/**
	 * @param {string} stateID - Source state ID
	 * @returns {string} Local state ID for persistent dynamic cost memory
	 */
	getDynamicCostMemoryStateName(stateID) {
		return `${this.activeStates[stateID].stateDetails.deviceName}.dynamicCostMemory`;
	}

	/**
	 * @param {string} stateID - Source state ID
	 */
	async ensureDynamicCostMemoryState(stateID) {
		if (this.activeStates[stateID].dynamicCostMemoryStateReady) return;
		const memoryStateName = this.getDynamicCostMemoryStateName(stateID);
		await this.extendObjectAsync(memoryStateName, {
			type: 'state',
			common: {
				name: 'Dynamic cost calculation memory',
				type: 'string',
				role: 'json',
				read: true,
				write: false,
				def: '',
			},
			native: {
				sourceState: stateID,
			},
		});
		this.activeStates[stateID].dynamicCostMemoryStateReady = true;
	}

	/**
	 * @param {string} stateID - Source state ID
	 * @returns {Promise<object | null>} Valid persisted memory, or null when unavailable
	 */
	async loadDynamicCostMemory(stateID) {
		await this.ensureDynamicCostMemoryState(stateID);
		const memoryStateName = this.getDynamicCostMemoryStateName(stateID);
		const memoryState = await this.getStateAsync(memoryStateName);
		if (!memoryState || !memoryState.val) return null;

		try {
			const parsedMemory = JSON.parse(memoryState.val.toString());
			const memory = dynamicPricing.normalizeDynamicCostMemory(parsedMemory);
			if (!memory) {
				this.log.warn(`[loadDynamicCostMemory] Ignoring invalid calculation memory for ${stateID}`);
				return null;
			}
			const priceDefinition = this.activeStates[stateID].stateDetails.stateType;
			if (memory.priceDefinition !== priceDefinition) {
				this.log.info(`[loadDynamicCostMemory] Ignoring calculation memory for ${stateID} because price definition changed from ${memory.priceDefinition} to ${priceDefinition}`);
				return null;
			}
			this.log.info(`Restored precise dynamic cost memory for ${stateID} from ${new Date(memory.lastTs).toISOString()}`);
			this.log.debug(`[loadDynamicCostMemory] Restored precise dynamic costs for ${stateID}: ${JSON.stringify(memory)}`);
			return memory;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.warn(`[loadDynamicCostMemory] Cannot parse calculation memory for ${stateID}: ${message}`);
			return null;
		}
	}

	/**
	 * @param {string} stateID - Source state ID
	 * @param {object} dynamicCosts - Unrounded dynamic cost memory
	 */
	async persistDynamicCostMemory(stateID, dynamicCosts) {
		await this.ensureDynamicCostMemoryState(stateID);
		const memoryStateName = this.getDynamicCostMemoryStateName(stateID);
		const payload = {
			version: 1,
			priceDefinition: this.activeStates[stateID].stateDetails.stateType,
			lastReading: dynamicCosts.lastReading,
			lastTs: dynamicCosts.lastTs,
			totals: dynamicCosts.totals,
		};
		const memory = dynamicPricing.normalizeDynamicCostMemory(payload);
		if (!memory) throw new Error(`Cannot persist invalid dynamic cost memory for ${stateID}`);
		await this.setStateAsync(memoryStateName, {
			val: JSON.stringify(memory),
			ack: true,
		});
	}

	/**
	 * Initialise dynamic cost memory from existing states, so restarts do not revalue past consumption.
	 * @param {string} stateID - Source state ID
	 * @param {number} reading - Current cumulative reading
	 * @param {number | string | null | undefined} timestamp - Timestamp of the current reading
	 * @returns {Promise<object | null>} Dynamic cost memory, or null for unsupported states
	 */
	async ensureDynamicCostMemory(stateID, reading, timestamp) {
		if (!this.usesHistoricalCostCalculation(stateID)) return null;
		if (!this.activeStates[stateID] || !this.activeStates[stateID].stateDetails || !this.activeStates[stateID].calcValues) return null;

		const readingNumber = this.parsePriceValue(reading);
		const readingTimestamp = this.getTimestampOrNow(timestamp);
		if (readingNumber === null) {
			this.log.warn(`[ensureDynamicCostMemory] Cannot initialize dynamic costs for ${stateID}, reading ${JSON.stringify(reading)} is not numeric`);
			return null;
		}

		const activeState = this.activeStates[stateID];
		if (activeState.dynamicCosts && activeState.dynamicCosts.totals) {
			if (activeState.dynamicCosts.lastReading === null || activeState.dynamicCosts.lastReading === undefined) {
				activeState.dynamicCosts.lastReading = readingNumber;
			}
			if (activeState.dynamicCosts.lastTs === null || activeState.dynamicCosts.lastTs === undefined) {
				activeState.dynamicCosts.lastTs = readingTimestamp;
			}
			return activeState.dynamicCosts;
		}

		const persistedMemory = await this.loadDynamicCostMemory(stateID);
		if (persistedMemory) {
			activeState.dynamicCosts = persistedMemory;
			return activeState.dynamicCosts;
		}

		const unitPrice = this.getNumberOrDefault(activeState.prices.unitPrice, 0);
		const fallbackTotals = this.getFallbackDynamicCostTotals(readingNumber, activeState.calcValues, unitPrice);
		const stateRoot = `${activeState.stateDetails.deviceName}.currentYear.${activeState.stateDetails.financialCategory}`;
		const totals = {
			priceDay: await this.readCostStateOrFallback(`${stateRoot}.01_currentDay`, fallbackTotals.priceDay),
			priceWeek: await this.readCostStateOrFallback(`${stateRoot}.02_currentWeek`, fallbackTotals.priceWeek),
			priceMonth: await this.readCostStateOrFallback(`${stateRoot}.03_currentMonth`, fallbackTotals.priceMonth),
			priceQuarter: await this.readCostStateOrFallback(`${stateRoot}.04_currentQuarter`, fallbackTotals.priceQuarter),
			priceYear: await this.readCostStateOrFallback(`${stateRoot}.05_currentYear`, fallbackTotals.priceYear),
		};

		activeState.dynamicCosts = {
			lastReading: readingNumber,
			lastTs: readingTimestamp,
			totals: totals
		};
		await this.persistDynamicCostMemory(stateID, activeState.dynamicCosts);
		this.log.info(`Initialized precise dynamic cost memory for ${stateID} from existing cost states`);
		this.log.debug(`[ensureDynamicCostMemory] Initialized dynamic costs for ${stateID}: ${JSON.stringify(activeState.dynamicCosts)}`);
		return activeState.dynamicCosts;
	}

	/**
	 * Add the newly consumed delta to dynamic cost totals with the active unit price.
	 * @param {string} stateID - Source state ID
	 * @param {number} reading - Current cumulative reading
	 * @param {number | string | null | undefined} timestamp - Timestamp of the current reading
	 * @returns {Promise<object | null>} Rounded dynamic costs, or null for unsupported states
	 */
	async calculateDynamicCostsForState(stateID, reading, timestamp) {
		const dynamicCosts = await this.ensureDynamicCostMemory(stateID, reading, timestamp);
		if (!dynamicCosts) return null;

		const readingNumber = this.parsePriceValue(reading);
		const activeState = this.activeStates[stateID];
		const readingTimestamp = this.getTimestampOrNow(timestamp);
		if (readingNumber === null) {
			this.log.warn(`[calculateDynamicCostsForState] Cannot calculate dynamic costs for ${stateID}, reading ${JSON.stringify(reading)} is not numeric`);
			return this.roundDynamicCostTotals(dynamicCosts);
		}

		const lastReading = this.parsePriceValue(dynamicCosts.lastReading);
		if (lastReading === null) {
			dynamicCosts.lastReading = readingNumber;
			dynamicCosts.lastTs = readingTimestamp;
			await this.persistDynamicCostMemory(stateID, dynamicCosts);
			return this.roundDynamicCostTotals(dynamicCosts);
		}

		const delta = readingNumber - lastReading;
		if (delta < 0) {
			this.log.warn(`[calculateDynamicCostsForState] Cumulative reading for ${stateID} decreased from ${lastReading} to ${readingNumber}, resetting dynamic cost tracker`);
			dynamicCosts.lastReading = readingNumber;
			dynamicCosts.lastTs = readingTimestamp;
			await this.persistDynamicCostMemory(stateID, dynamicCosts);
			return this.roundDynamicCostTotals(dynamicCosts);
		}

		if (delta > 0) {
			const priceDelta = await this.calculateDynamicPriceDelta(activeState.stateDetails.stateType, delta, dynamicCosts.lastTs, readingTimestamp, activeState.prices.unitPrice);
			if (priceDelta === null) {
				this.log.warn(`[calculateDynamicCostsForState] Cannot calculate dynamic costs for ${stateID}, no valid price found for ${new Date(readingTimestamp).toISOString()}`);
				return this.roundDynamicCostTotals(dynamicCosts);
			}
			dynamicCosts.totals.priceDay = this.getNumberOrDefault(dynamicCosts.totals.priceDay, 0) + priceDelta;
			dynamicCosts.totals.priceWeek = this.getNumberOrDefault(dynamicCosts.totals.priceWeek, 0) + priceDelta;
			dynamicCosts.totals.priceMonth = this.getNumberOrDefault(dynamicCosts.totals.priceMonth, 0) + priceDelta;
			dynamicCosts.totals.priceQuarter = this.getNumberOrDefault(dynamicCosts.totals.priceQuarter, 0) + priceDelta;
			dynamicCosts.totals.priceYear = this.getNumberOrDefault(dynamicCosts.totals.priceYear, 0) + priceDelta;
			dynamicCosts.lastReading = readingNumber;
			dynamicCosts.lastTs = readingTimestamp;
			await this.persistDynamicCostMemory(stateID, dynamicCosts);
			this.log.debug(`[calculateDynamicCostsForState] Added dynamic cost delta ${priceDelta} for ${delta} consumption from ${stateID} at ${new Date(readingTimestamp).toISOString()}`);
		} else if (readingTimestamp > this.getNumberOrDefault(dynamicCosts.lastTs, 0)) {
			dynamicCosts.lastTs = readingTimestamp;
			await this.persistDynamicCostMemory(stateID, dynamicCosts);
		}

		return this.roundDynamicCostTotals(dynamicCosts);
	}

	/**
	 * Reset dynamic cost totals when period start values are reset.
	 * @param {string} stateID - Source state ID
	 * @param {number} reading - Current cumulative reading
	 * @param {object} beforeReset - Date information before reset
	 */
	async resetDynamicCostMemory(stateID, reading, beforeReset) {
		if (!this.usesHistoricalCostCalculation(stateID)) return;

		const activeState = this.activeStates[stateID];
		const readingNumber = this.parsePriceValue(reading);
		if (!activeState || readingNumber === null) return;

		const existingTotals = activeState.dynamicCosts && activeState.dynamicCosts.totals ? activeState.dynamicCosts.totals : {};
		activeState.dynamicCosts = {
			lastReading: readingNumber,
			lastTs: Date.now(),
			totals: {
				priceDay: beforeReset.day === actualDate.day ? this.getNumberOrDefault(existingTotals.priceDay, 0) : 0,
				priceWeek: beforeReset.week === actualDate.week ? this.getNumberOrDefault(existingTotals.priceWeek, 0) : 0,
				priceMonth: beforeReset.month === actualDate.month ? this.getNumberOrDefault(existingTotals.priceMonth, 0) : 0,
				priceQuarter: beforeReset.quarter === actualDate.quarter ? this.getNumberOrDefault(existingTotals.priceQuarter, 0) : 0,
				priceYear: beforeReset.year === actualDate.year ? this.getNumberOrDefault(existingTotals.priceYear, 0) : 0,
			}
		};
		await this.persistDynamicCostMemory(stateID, activeState.dynamicCosts);
		this.log.debug(`[resetDynamicCostMemory] Reset dynamic costs for ${stateID}: ${JSON.stringify(activeState.dynamicCosts)}`);
	}

	/**
	 * Write financial calculation states.
	 * @param {string} stateID - Source state ID
	 * @param {object} calculationRounded - Rounded calculation values
	 * @param {Date} date - Current date
	 */
	async writeFinancialStates(stateID, calculationRounded, date) {
		if (!this.activeStates[stateID] || !this.activeStates[stateID].stateDetails) return;

		const stateDetails = this.activeStates[stateID].stateDetails;
		let stateName = `${this.namespace}.${stateDetails.deviceName}.currentYear.${stateDetails.financialCategory}`;
		await this.setStateChangedAsync(`${stateName}.01_currentDay`, {
			val: calculationRounded.priceDay,
			ack: true
		});
		await this.setStateChangedAsync(`${stateName}.02_currentWeek`, {
			val: calculationRounded.priceWeek,
			ack: true
		});
		await this.setStateChangedAsync(`${stateName}.03_currentMonth`, {
			val: calculationRounded.priceMonth,
			ack: true
		});
		await this.setStateChangedAsync(`${stateName}.04_currentQuarter`, {
			val: calculationRounded.priceQuarter,
			ack: true
		});
		await this.setStateChangedAsync(`${stateName}.05_currentYear`, {
			val: calculationRounded.priceYear,
			ack: true
		});

		if (this.config.store_weeks || this.config.store_months || this.config.store_quarters) {
			await this.setStateChangedAsync(`${this.namespace}.${stateDetails.deviceName}.${actualDate.year}.${stateDetails.financialCategory}Cumulative`, {
				val: calculationRounded.priceYear,
				ack: true
			});
		}

		if (this.config.currentYearDays) {
			await this.setStateChangedAsync(`${stateName}.currentWeek.${weekdays[date.getDay()]}`, {
				val: calculationRounded.priceDay,
				ack: true
			});
		}

		stateName = `${this.namespace}.${stateDetails.deviceName}.${actualDate.year}.${stateDetails.financialCategory}`;
		if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, {
			val: calculationRounded.priceWeek,
			ack: true
		});
		if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, {
			val: calculationRounded.priceMonth,
			ack: true
		});
		if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.Q${actualDate.quarter}`, {
			val: calculationRounded.priceQuarter,
			ack: true
		});
	}

	/**
	 * Write consumption calculation states.
	 * @param {string} stateID - Source state ID
	 * @param {object} calculationRounded - Rounded consumption values
	 * @param {Date} date - Current date
	 */
	async writeConsumptionStates(stateID, calculationRounded, date) {
		if (!this.activeStates[stateID] || !this.activeStates[stateID].stateDetails) return;
		const stateDetails = this.activeStates[stateID].stateDetails;
		let stateName = `${this.namespace}.${stateDetails.deviceName}.currentYear.${stateDetails.headCategory}`;
		const currentValues = [
			['01_currentDay', calculationRounded.consumedDay],
			['02_currentWeek', calculationRounded.consumedWeek],
			['03_currentMonth', calculationRounded.consumedMonth],
			['04_currentQuarter', calculationRounded.consumedQuarter],
			['05_currentYear', calculationRounded.consumedYear],
		];
		for (const [state, value] of currentValues) {
			await this.setStateChangedAsync(`${stateName}.${state}`, {val: value, ack: true});
		}

		if (this.config.store_weeks || this.config.store_months || this.config.store_quarters) {
			await this.setStateChangedAsync(`${this.namespace}.${stateDetails.deviceName}.${actualDate.year}.${stateDetails.headCategory}Cumulative`, {
				val: calculationRounded.consumedYear,
				ack: true
			});
		}
		if (this.config.currentYearDays) {
			await this.setStateChangedAsync(`${stateName}.currentWeek.${weekdays[date.getDay()]}`, {
				val: calculationRounded.consumedDay,
				ack: true
			});
		}

		stateName = `${this.namespace}.${stateDetails.deviceName}.${actualDate.year}.${stateDetails.headCategory}`;
		if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, {val: calculationRounded.consumedWeek, ack: true});
		if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, {val: calculationRounded.consumedMonth, ack: true});
		if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.Q${actualDate.quarter}`, {val: calculationRounded.consumedQuarter, ack: true});
	}

	//ToDo 0.5: Implement cleanup for unused states
	// async cleanupUnused() {
	//     const allStates = await this.getAdapterObjectsAsync()
	//     this.log.info((JSON.stringify(allStates)))
	// }

	/**
	 * Load calculation factors from helper library and store to memory
	 */
	async definitionLoader() {
		try {
			// Load energy array and store exponents related to unit
			let catArray = ['Watt', 'Watt_hour'];
			const unitStore = this.unitPriceDef.unitConfig;
			for (const item in catArray) {
				const unitItem = adapterHelpers.units.electricity[catArray[item]];
				for (const unitCat in unitItem) {
					unitStore[unitItem[unitCat].unit] = {
						exponent: unitItem[unitCat].exponent,
						category: catArray[item],
					};
				}
			}

			// Load  volumes array and store exponents related to unit
			catArray = ['Liter', 'Cubic_meter'];
			for (const item in catArray) {
				const unitItem = adapterHelpers.units.volume[catArray[item]];
				for (const unitCat in unitItem) {
					unitStore[unitItem[unitCat].unit] = {
						exponent: unitItem[unitCat].exponent,
						category: catArray[item],
					};
				}
			}

			// Load price definition from admin configuration
			const pricesConfig = this.config.pricesDefinition || [];
			const priceStore = this.unitPriceDef.pricesConfig;
			this.dynamicPriceStates = {};
			this.priceControlStates = {};

			for (const priceDef in pricesConfig) {
				const priceConfig = pricesConfig[priceDef];
				const priceSource = ['state', 'selector'].includes(priceConfig.priceSource) ? priceConfig.priceSource : 'static';
				const priceState = priceSource !== 'static' && typeof priceConfig.priceState === 'string' ? priceConfig.priceState.trim() : '';
				const configuredUnitPrice = this.parsePriceValue(priceConfig.uPpU);
				const alternatePrice = this.parsePriceValue(priceConfig.alternatePrice);
				const configuredBasicPrice = this.parsePriceValue(priceConfig.uPpM);
				let unitPrice = configuredUnitPrice;

				await this.ensurePriceHistoryState(priceConfig.cat);
				if (priceSource === 'static' && configuredUnitPrice !== null) {
					await this.storeConfiguredPrice(priceConfig.cat, configuredUnitPrice, priceConfig.validFrom);
					unitPrice = await this.getDynamicPriceForTimestamp(priceConfig.cat, Date.now(), configuredUnitPrice);
				} else if (priceSource !== 'static') {
					if (priceState) {
						if (!this.dynamicPriceStates[priceState]) {
							this.dynamicPriceStates[priceState] = [];
						}
						this.dynamicPriceStates[priceState].push(priceConfig.cat);
						this.subscribeForeignStates(priceState);

						const priceStateValue = await this.getForeignStateAsync(priceState);
						const dynamicUnitPrice = priceStateValue
							? (priceSource === 'selector'
								? dynamicPricing.getSelectorPrice(priceStateValue.val, configuredUnitPrice, alternatePrice, priceConfig.selectorValue)
								: this.parsePriceValue(priceStateValue.val))
							: null;
						if (dynamicUnitPrice !== null) {
							unitPrice = dynamicUnitPrice;
							const sourceTimestamp = priceSource === 'selector' ? Date.now() : this.getStateChangeTimestamp(priceStateValue);
							await this.storeDynamicPriceHistory(priceConfig.cat, dynamicUnitPrice, sourceTimestamp);
							this.log.info(`Loaded unit price ${unitPrice} for ${priceConfig.cat} from ${priceState}`);
						} else {
							this.log.warn(`Price source state ${priceState} for ${priceConfig.cat} has no valid value or tariff, using configured fallback price ${priceConfig.uPpU}`);
						}
					} else {
						this.log.warn(`Price definition ${priceConfig.cat} uses a state price source but no state ID is configured, using configured fallback price ${priceConfig.uPpU}`);
					}
				}

				if (unitPrice === null) {
					this.log.warn(`Price definition ${priceConfig.cat} has no valid unit price ${JSON.stringify(priceConfig.uPpU)}, using 0 to avoid invalid cost calculations`);
					unitPrice = 0;
				}

				priceStore[priceConfig.cat] = {
					cat: priceConfig.cat,
					uDes: priceConfig.cat,
					uPpU: unitPrice,
					basePrice: configuredUnitPrice,
					uPpM: configuredBasicPrice === null ? priceConfig.uPpM : configuredBasicPrice,
					costType: priceConfig.costType,
					unitType: priceConfig.unitType,
					priceSource: priceSource,
					priceState: priceState,
					alternatePrice: alternatePrice,
					selectorValue: priceConfig.selectorValue,
					validFrom: priceConfig.validFrom,
				};
				await this.ensurePriceControlState(priceConfig.cat, unitPrice, priceConfig.unitType);
			}

			console.debug(`All Unit category's ${JSON.stringify(this.unitPriceDef)}`);

		} catch (error) {
			this.errorHandling('[definitionLoader]', error);
		}

	}

	/**
	 * Load state definitions to memory this.activeStates[stateID]
	 * @param {string} stateID ID  of state to refresh memory values
	 */
	async buildStateDetailsArray(stateID) {
		let initError  = false;
		this.log.debug(`[buildStateDetailsArray] started for ${stateID}`);
		try {

			let stateInfo;
			try {
				// Load configuration as provided in object
				stateInfo = await this.getForeignObjectAsync(stateID);
				if (!stateInfo) {
					this.log.error(`Can't get information for ${stateID}, state will be ignored`);
					delete this.activeStates[stateID];
					this.unsubscribeForeignStates(stateID);
					initError = true;
					return false;
				}
			} catch (error) {
				this.log.error(`${stateID} is incorrectly correctly formatted, ${JSON.stringify(error)}`);
				delete this.activeStates[stateID];
				this.unsubscribeForeignStates(stateID);
				initError = true;
				return false;
			}

			// Replace not allowed characters for state name
			const newDeviceName = stateID.split('.').join('__');

			// Check if configuration for SourceAnalytix is present, trow error in case of issue in configuration
			if (stateInfo && stateInfo.common && stateInfo.common.custom && stateInfo.common.custom[this.namespace]) {
				const customData = stateInfo.common.custom[this.namespace];
				const commonData = stateInfo.common;
				this.log.debug(`[buildStateDetailsArray] commonData ${JSON.stringify(commonData)}`);

				// Load start value from config to memory (avoid wrong calculations at meter reset, set to 0 if empty)
				const valueAtDeviceReset = (customData.valueAtDeviceReset || customData.valueAtDeviceReset === 0) ? customData.valueAtDeviceReset : null;

				// Always set init value to null at first start, will take init value at first calculation from state
				const valueAtDeviceInit = null;

				// Read current known total value to memory (if present)
				let cumulativeValue = await this.getCumulatedValue(stateID, newDeviceName);
				cumulativeValue = cumulativeValue ? cumulativeValue : 0;
				this.log.debug(`[buildStateDetailsArray] cumulativeValue ${JSON.stringify(cumulativeValue)} | valueAtDeviceReset ${JSON.stringify(valueAtDeviceReset)} | valueAtDeviceInit ${JSON.stringify(valueAtDeviceInit)}`);

				// Check and load unit definition
				let useUnit = '';
				// Check if a unit is manually selected, if yes use that one
				if (this.unitPriceDef.unitConfig[customData.selectedUnit]) {
					useUnit = customData.selectedUnit;
					this.log.debug(`[buildStateDetailsArray] unit manually chosen ${JSON.stringify(useUnit)}`);

				// If not, try to automatically get unit from state object
				} else if (commonData.unit && commonData.unit !== '' && this.unitPriceDef.unitConfig[commonData.unit]) {

					useUnit = commonData.unit;
					this.log.debug(`[buildStateDetailsArray] unit automatically detected ${JSON.stringify(useUnit)}`);
				} else {
					this.log.error(`No unit defined for ${stateID}, cannot execute calculations !`);
					this.log.error(`Please choose unit manually in state configuration`);
					initError = true;
				}

				// Load state price definition
				if (!customData.selectedPrice || customData.selectedPrice === '' || customData.selectedPrice === 'Choose') {
					this.log.error(`No cost type defined for ${stateID}, please Select Type of calculation at state setting`);
					initError = true;
				} else if (!this.unitPriceDef.pricesConfig[customData.selectedPrice]) {
					this.log.error(`Selected Type ${customData.selectedPrice} does not exist in Price Definitions`);
					this.log.error(`Please choose proper type for state ${stateID}`);
					this.log.error(`Or add price definition ${customData.selectedPrice} in adapter settings`);
					initError = true;
				}

				if (valueAtDeviceReset > cumulativeValue){
					// Ignore issue if categories = Watt, init value not used
					if (useUnit !== 'W') {
						this.log.error(`Check settings for ${stateID} ! Known valueAtDeviceReset : (${valueAtDeviceReset}) > known cumulative value (${cumulativeValue}) cannot proceed`);
						this.log.error(`Troubleshoot Data ${stateID} custom Data : ${JSON.stringify(stateInfo)} `);
						initError = true;
					}
				}

				// In case of one of above checks fails, abort procedure
				if (initError){
					this.log.error(`Cannot handle calculations for ${stateID}, check log messages and adjust settings!`);
					delete this.activeStates[stateID];
					this.unsubscribeForeignStates(stateID);
					return false;
				}

				// Load price definition from settings & library
				const selectedPriceConfig = this.unitPriceDef.pricesConfig[customData.selectedPrice];
				const stateType = selectedPriceConfig.costType;

				// Load state settings to memory
				this.activeStates[stateID] = {
					stateDetails: {
						alias: customData.alias !== '' ? customData.alias : '',
						basicRate: customData.basicRate === true,
						consumption: customData.consumption,
						costs: customData.costs,
						deviceName: newDeviceName.toString(),
						financialCategory: stateType,
						headCategory: stateType === 'earnings' ? 'delivered' : 'consumed',
						meter_values: customData.meter_values,
						name: stateInfo.common.name !== '' ? customData.alias : 'No name known, please provide alias',
						stateType: customData.selectedPrice,
						stateUnit: useUnit,
						useUnit: selectedPriceConfig.unitType,
						deviceResetLogicEnabled: customData.deviceResetLogicEnabled ?? true,
						threshold: customData.threshold ?? 1,
					},
					calcValues: {
						cumulativeValue: cumulativeValue,
						start_day: customData.start_day,
						start_month: customData.start_month,
						start_quarter: customData.start_quarter,
						start_week: customData.start_week,
						start_year: customData.start_year,
						valueAtDeviceReset: valueAtDeviceReset,
						valueAtDeviceInit: valueAtDeviceInit,
					},
					prices: {
						basicPrice: selectedPriceConfig.uPpM,
						unitPrice: selectedPriceConfig.uPpU,
						priceSource: selectedPriceConfig.priceSource,
						priceState: selectedPriceConfig.priceState,
					},
				};

				// Extend memory with objects for watt to kWh calculation
				if (useUnit === 'W') {
					this.activeStates[stateID].calcValues.previousReadingWatt = null;
					this.activeStates[stateID].calcValues.previousReadingWattTs = null;
				}
				this.log.debug(`[buildStateDetailsArray] completed for ${stateID}: with content ${JSON.stringify(this.activeStates[stateID])}`);
				return true;
			}
		} catch (error) {
			this.errorHandling(`[buildStateDetailsArray] ${stateID}`, error);
			return false;
		}
	}

	/**
	 * Create the configured statistics objects for the active calendar year.
	 * @param {string} stateID - Source state ID
	 */
	async initializeYearStatisticsStates(stateID) {
		if (!this.activeStates[stateID] || !this.activeStates[stateID].stateDetails) return;
		const stateDetails = this.activeStates[stateID].stateDetails;

		for (let yearWeek = 1; yearWeek < 54; yearWeek++) {
			const weekNumber = yearWeek < 10 ? `0${yearWeek}` : yearWeek.toString();
			await this.doLocalStateCreate(stateID, `weeks.${weekNumber}`, weekNumber, false, !this.config.store_weeks);
		}
		for (const month of months) {
			await this.doLocalStateCreate(stateID, `months.${month}`, month, false, !this.config.store_months);
		}
		for (let quarter = 1; quarter < 5; quarter++) {
			await this.doLocalStateCreate(stateID, `quarters.Q${quarter}`, `Q${quarter}`, false, !this.config.store_quarters);
		}

		const storeYearStatistics = !!(this.config.store_weeks || this.config.store_months || this.config.store_quarters);
		await this.doLocalStateCreate(stateID, `${actualDate.year}.${stateDetails.headCategory}Cumulative`, `${stateDetails.headCategory}Cumulative`, true, !storeYearStatistics || !stateDetails.consumption);
		await this.doLocalStateCreate(stateID, `${actualDate.year}.${stateDetails.financialCategory}Cumulative`, `${stateDetails.financialCategory}Cumulative`, true, !storeYearStatistics || !stateDetails.costs, false, useCurrency);
		await this.doLocalStateCreate(stateID, `${actualDate.year}.readingCumulative`, 'Cumulative Reading of Year total', true, !storeYearStatistics);
	}

	// Create object tree and states for all devices to be handled
	async initialize(stateID) {
		try {

			this.log.debug(`Initialising ${stateID} with configuration ${JSON.stringify(this.activeStates[stateID])}`);

			// Shorten configuration details for easier access
			if (!this.activeStates[stateID] || !this.activeStates[stateID].stateDetails) {
				this.log.error(`Cannot handle initialisation for ${stateID}`);
				return;
			}

			const stateDetails = this.activeStates[stateID].stateDetails;

			this.log.debug(`Defined calculation attributes for ${stateID} : ${JSON.stringify(this.activeStates[stateID])}`);
			// Check if alias is used and update object with new naming (if changed)
			let alias = stateDetails.name;
			if (stateDetails.alias && stateDetails.alias !== '') {
				alias = stateDetails.alias;
			}

			this.log.debug('Name after alias renaming' + alias);

			// Create Device Object
			await this.extendObjectAsync(stateDetails.deviceName, {
				type: 'device',
				common: {
					name: alias
				},
				native: {},
			});

			// create states for day value storage
			for (const x in weekdays) {

				if (this.config.currentYearDays === true) {
					await this.doLocalStateCreate(stateID, `currentWeek.${weekdays[x]}`, weekdays[x], false, false, true);
				} else if (stateDeletion) {
					this.log.debug(`Deleting states for week ${weekdays[x]} (if present)`);
					await this.doLocalStateCreate(stateID, `currentWeek.${weekdays[x]}`, weekdays[x], false, true, true);
				}

				if (this.config.currentYearDays === true && this.config.currentYearPrevious === true) {
					await this.doLocalStateCreate(stateID, `previousWeek.${weekdays[x]}`, weekdays[x], false, false, true);
				} else if (stateDeletion) {
					this.log.debug(`Deleting states for week ${weekdays[x]} (if present)`);
					await this.doLocalStateCreate(stateID, `previousWeek.${weekdays[x]}`, weekdays[x], false, true, true);

				}
			}

			await this.initializeYearStatisticsStates(stateID);

			// Create basic current states
			for (const state of basicStates) {
				await this.doLocalStateCreate(stateID, state, state, false, false, true);
			}

			// Create basic current states for previous periods
			if (this.config.currentYearPrevious) {
				for (const state of basicPreviousStates) {
					await this.doLocalStateCreate(stateID, state, state, false, false, true);
				}
			} else if (stateDeletion) {
				for (const state of basicPreviousStates) {
					await this.doLocalStateCreate(stateID, state, state, false, true, true);
				}
			}

			// Create state for cumulative reading
			const stateName = 'cumulativeReading';
			await this.doLocalStateCreate(stateID, stateName, 'Cumulative Reading', true);

			// Handle calculation
			const value = await this.getForeignStateAsync(stateID);
			this.log.debug(`First time calc result after initialising ${stateID}  with value ${JSON.stringify(value)}`);
			if (value) {
				// await this.buildVisWidgetJson(stateID);
				await this.calculationHandler(stateID, value);
			}

			// Subscribe state, every state change will trigger calculation now automatically
			this.subscribeForeignStates(stateID);

		} catch (error) {
			this.errorHandling(`[initialize] ${stateID}`, error);
		}
	}

	/**
	 * Is called if an object changes to ensure (de-) activation of calculation or update configuration settings
	 * @param {string} id - ID of the changed object
	 * @param {ioBroker.Object | null | undefined} obj - Changed object, or null when deleted
	 */
	async onObjectChange(id, obj) {
	    //ToDo : Verify with test-results if debounce on object change must be implemented
		if (calcBlock) return; // cancel operation if calculation block is activate
		try {
			const stateID = id;

			// Check if object is activated for SourceAnalytix
			if (obj && obj.common) {

				// if (obj.from === `system.adapter.${this.namespace}`) return; // Ignore object change if cause by SourceAnalytix to prevent overwrite
				// Verify if custom information is available regarding SourceAnalytix
				if (obj.common.custom && obj.common.custom[this.namespace] && obj.common.custom[this.namespace].enabled) {

					// ignore object changes when caused by SA (memory is handled internally)
					// if (obj.from !== `system.adapter.${this.namespace}`) {
					this.log.debug(`Object array of SourceAnalytix activated state changed : ${JSON.stringify(obj)} stored config : ${JSON.stringify(this.activeStates)}`);
					// const newDeviceName = stateID.split('.').join('__');

					// Verify if the object was already activated, if not initialize new device
					if (!this.activeStates[stateID]) {
						this.log.info(`Enable SourceAnalytix for : ${stateID}`);
						await this.buildStateDetailsArray(id);
						this.log.debug(`Active state array after enabling ${stateID} : ${JSON.stringify(this.activeStates)}`);
						if (this.activeStates[stateID]){
							await this.initialize(stateID);
						} else {
							this.log.warn(`[Cannot enable SourceAnalytix for ${stateID}, check settings and error messages`);
						}
					} else {
						this.log.info(`Updating SourceAnalytix configuration for : ${stateID}`);
						await this.buildStateDetailsArray(id);
						this.log.debug(`Active state array after updating configuration of ${stateID} : ${JSON.stringify(this.activeStates)}`);
						// Only run initialisation if state is successfully created during buildStateDetailsArray
						if (this.activeStates[stateID]){
							await this.initialize(stateID);
						} else {
							this.log.warn(`[Cannot update SourceAnalytix configuration for ${stateID}, check settings and error messages`);
						}
					}

				} else if (this.activeStates[stateID]) {
					delete this.activeStates[stateID];
					this.log.info(`Disabled SourceAnalytix for : ${stateID}`);
					this.log.debug(`Active state array after deactivation of ${stateID} : ${JSON.stringify(this.activeStates)}`);
					this.unsubscribeForeignStates(stateID);
				}

			} else if (this.activeStates[stateID]) {
				delete this.activeStates[stateID];
				delete previousCalculationRounded[stateID];
				this.unsubscribeForeignStates(stateID);
				this.log.info(`Source state ${stateID} was deleted; SourceAnalytix disabled it while retaining calculated history`);
			}
		} catch (error) {
			// Send code failure to sentry
			this.errorHandling(`[onObjectChange] ${id}`, error);
		}
	}

	/**
	 * Handle updates from numeric price states and tariff selectors.
	 * @param {string} priceStateID - ioBroker state ID of the dynamic price source
	 * @param {ioBroker.State} state - New price state value
	 */
	async handleDynamicPriceChange(priceStateID, state) {
		try {
			for (const priceDefinition of this.dynamicPriceStates[priceStateID]) {
				const priceConfig = this.unitPriceDef.pricesConfig[priceDefinition];
				if (!priceConfig) {
					this.log.warn(`Dynamic price update for ${priceDefinition} ignored because the price definition is not loaded`);
					continue;
				}

				const unitPrice = priceConfig.priceSource === 'selector'
					? dynamicPricing.getSelectorPrice(state.val, priceConfig.basePrice, priceConfig.alternatePrice, priceConfig.selectorValue)
					: this.parsePriceValue(state.val);
				if (unitPrice === null) {
					this.log.warn(`Price source state ${priceStateID} changed but value ${JSON.stringify(state.val)} cannot select a valid price, keeping previous price`);
					continue;
				}

				const previousPrice = priceConfig.uPpU;
				await this.storeDynamicPriceHistory(priceDefinition, unitPrice, this.getStateChangeTimestamp(state));
				await this.applyCurrentPrice(priceDefinition, unitPrice);
				this.log.info(`Unit price for ${priceDefinition} changed from ${previousPrice} to ${unitPrice}`);
			}
		} catch (error) {
			this.errorHandling(`[handleDynamicPriceChange] ${priceStateID}`, error);
		}
	}

	/**
	 * Apply an immediate price entered through the writable adapter state.
	 * @param {string} id - Full local price state ID
	 * @param {ioBroker.State} state - User-written state
	 */
	async handleWritablePriceChange(id, state) {
		const priceDefinition = this.priceControlStates[id];
		const unitPrice = this.parsePriceValue(state.val);
		if (!priceDefinition || unitPrice === null) {
			this.log.warn(`Writable price state ${id} received invalid value ${JSON.stringify(state.val)}`);
			return;
		}
		await this.storeDynamicPriceHistory(priceDefinition, unitPrice, this.getStateChangeTimestamp(state));
		await this.applyCurrentPrice(priceDefinition, unitPrice);
		this.log.info(`Unit price for ${priceDefinition} was set to ${unitPrice} through ${id}`);
	}

	/**
	 * Recalculate only financial states from the stored cumulative reading.
	 * @param {string} stateID - Source state ID
	 * @param {string} reason - Log context
	 */
	async recalculateCostsForState(stateID, reason) {
		try {
			if (!this.activeStates[stateID] || !this.activeStates[stateID].stateDetails || !this.activeStates[stateID].calcValues) return;

			const calcValues = this.activeStates[stateID].calcValues;
			const stateDetails = this.activeStates[stateID].stateDetails;
			const statePrices = this.activeStates[stateID].prices;
			const reading = calcValues.cumulativeValue;

			if (!stateDetails.costs) return;
			if (this.usesHistoricalCostCalculation(stateID)) {
				this.log.debug(`[recalculateCostsForState] Skipped cost recalculation for ${stateID} because unit prices are historical`);
				return;
			}
			if (reading === null || reading === undefined) {
				this.log.warn(`[recalculateCostsForState] Cannot recalculate costs for ${stateID}, cumulative reading is not available`);
				return;
			}

			const unitPrice = this.parsePriceValue(statePrices.unitPrice);
			if (unitPrice === null) {
				this.log.warn(`[recalculateCostsForState] Cannot recalculate costs for ${stateID}, unit price ${JSON.stringify(statePrices.unitPrice)} is not numeric`);
				return;
			}

			const date = new Date();
			const calculationRounded = await this.addBasicPriceTotals(stateID, {
				priceDay: unitPrice * (reading - calcValues.start_day),
				priceWeek: unitPrice * (reading - calcValues.start_week),
				priceMonth: unitPrice * (reading - calcValues.start_month),
				priceQuarter: unitPrice * (reading - calcValues.start_quarter),
				priceYear: unitPrice * (reading - calcValues.start_year),
			}, date);

			await this.writeFinancialStates(stateID, calculationRounded, date);

			previousCalculationRounded[stateID] = {
				...previousCalculationRounded[stateID],
				...calculationRounded
			};

			this.log.debug(`[recalculateCostsForState] Costs recalculated for ${stateID} because of ${reason}: ${JSON.stringify(calculationRounded)}`);
		} catch (error) {
			this.errorHandling(`[recalculateCostsForState] ${stateID}`, error);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id of state
	 * @param {ioBroker.State | null | undefined} state - Changed state, or null when deleted
	 */
	async onStateChange(id, state) {
		if (calcBlock) return; // cancel operation if global calculation block is activate
		try {
			// Check if a valid state change has been received
			if (state) {
				if (this.priceControlStates[id]) {
					if (!state.ack) await this.handleWritablePriceChange(id, state);
					return;
				}
				// The state was changed
				this.log.debug(`state ${id} changed : ${JSON.stringify(state)} SourceAnalytix calculation executed`);

				//ToDo: Implement x ignore time (configurable) to avoid overload of unneeded calculations
				// Avoid unneeded calculation if value is equal to known value in memory
				// 10-01-2021 : disable IF check for new value to analyse if this solves 0 watt calc bug
				// 11-01-2021 : removing if successfully result, but need to check debounce !

				const isDynamicPriceState = !!this.dynamicPriceStates[id];
				if (isDynamicPriceState) {
					await this.handleDynamicPriceChange(id, state);
				}

				// Handle calculation for state
				// Check if for some reason calculation handler ist called for an object not initialised
				if (this.activeStates[id]){
					await this.calculationHandler(id, state);
				} else if (!isDynamicPriceState) {
					this.log.debug(`[onStateChange] state not initialised, calculation cancelled]`);
				}

				// } else {
				//     this.log.debug(`Update of state ${id} received with equal value ${state.val} ignoring`);
				// }

			}
		} catch (error) {
			this.errorHandling(`[onStateChange] for ${id}`, error);
		}
	}

	/**
	 * Copy completed generic periods to their configured previous-period states.
	 * @param {object} stateDetails - Active state details
	 * @param {object} changes - Changed calendar periods
	 */
	async copyPreviousPeriodStates(stateDetails, changes) {
		if (!this.config.currentYearPrevious) return;
		const periods = [
			['day', '01_currentDay', '01_previousDay'],
			['week', '02_currentWeek', '02_previousWeek'],
			['month', '03_currentMonth', '03_previousMonth'],
			['quarter', '04_currentQuarter', '04_previousQuarter'],
			['year', '05_currentYear', '05_previousYear'],
		];
		for (const [period, currentState, previousState] of periods) {
			if (!changes[period]) continue;
			if (stateDetails.consumption) {
				const root = `${stateDetails.deviceName}.currentYear.${stateDetails.headCategory}`;
				await this.setPreviousValues(`${root}.${currentState}`, `${root}.${previousState}`);
			}
			if (stateDetails.costs) {
				const root = `${stateDetails.deviceName}.currentYear.${stateDetails.financialCategory}`;
				await this.setPreviousValues(`${root}.${currentState}`, `${root}.${previousState}`);
			}
			if (stateDetails.meter_values) {
				await this.setPreviousValues(`${stateDetails.deviceName}.cumulativeReading`, `${stateDetails.deviceName}.currentYear.meterReadings.${previousState}`);
			}
		}
	}

	/**
	 * Move weekday values to previousWeek and clear the new week.
	 * @param {object} stateDetails - Active state details
	 * @param {boolean} weekChanged - Whether a new week started
	 */
	async resetCurrentWeekdayStates(stateDetails, weekChanged) {
		if (!weekChanged || !this.config.currentYearDays) return;
		for (const weekday of weekdays) {
			const stateRoots = [];
			if (stateDetails.consumption) stateRoots.push(stateDetails.headCategory);
			if (stateDetails.costs) stateRoots.push(stateDetails.financialCategory);
			if (stateDetails.meter_values) stateRoots.push('meterReadings');
			for (const root of stateRoots) {
				const currentState = `${stateDetails.deviceName}.currentYear.${root}.currentWeek.${weekday}`;
				if (this.config.currentYearPrevious) {
					await this.setPreviousValues(currentState, `${stateDetails.deviceName}.currentYear.${root}.previousWeek.${weekday}`);
				}
				await this.setStateAsync(currentState, {val: 0, ack: true});
			}
		}
	}

	/**
	 * Recalculate visible current-period values immediately after a calendar reset.
	 * @param {string} stateID - Source state ID
	 * @param {number} reading - Current cumulative reading
	 * @param {Date} date - Reset date
	 */
	async writeCurrentPeriodValuesAfterReset(stateID, reading, date) {
		const activeState = this.activeStates[stateID];
		const stateDetails = activeState.stateDetails;
		const calcValues = activeState.calcValues;
		const consumed = {
			consumedDay: reading - this.getNumberOrDefault(calcValues.start_day, reading),
			consumedWeek: reading - this.getNumberOrDefault(calcValues.start_week, reading),
			consumedMonth: reading - this.getNumberOrDefault(calcValues.start_month, reading),
			consumedQuarter: reading - this.getNumberOrDefault(calcValues.start_quarter, reading),
			consumedYear: reading - this.getNumberOrDefault(calcValues.start_year, reading),
		};
		const calculationRounded = {
			consumedDay: await this.roundDigits(consumed.consumedDay),
			consumedWeek: await this.roundDigits(consumed.consumedWeek),
			consumedMonth: await this.roundDigits(consumed.consumedMonth),
			consumedQuarter: await this.roundDigits(consumed.consumedQuarter),
			consumedYear: await this.roundDigits(consumed.consumedYear),
		};
		if (stateDetails.consumption) await this.writeConsumptionStates(stateID, calculationRounded, date);

		if (stateDetails.costs) {
			let variableCosts;
			if (this.usesHistoricalCostCalculation(stateID)) {
				variableCosts = activeState.dynamicCosts ? activeState.dynamicCosts.totals : {};
			} else {
				const unitPrice = this.getNumberOrDefault(activeState.prices.unitPrice, 0);
				variableCosts = {
					priceDay: unitPrice * consumed.consumedDay,
					priceWeek: unitPrice * consumed.consumedWeek,
					priceMonth: unitPrice * consumed.consumedMonth,
					priceQuarter: unitPrice * consumed.consumedQuarter,
					priceYear: unitPrice * consumed.consumedYear,
				};
			}
			Object.assign(calculationRounded, await this.addBasicPriceTotals(stateID, variableCosts, date));
			await this.writeFinancialStates(stateID, calculationRounded, date);
		}
		previousCalculationRounded[stateID] = calculationRounded;
	}

	/**
	 * Daily logic to store start values in memory and previous values at states
	 */
	async resetStartValues() {
		try {
			const resetDay = new schedule('0 0 * * *', async () => {
				// const resetDay = new schedule('* * * * *', async () => { //  testing schedule
				calcBlock = true; // Pause all calculations
				const beforeReset = await this.refreshDates(); // Reset date values in memory
				this.log.debug(`[resetStartValues] Dates current : ${JSON.stringify(actualDate)} | beforeReset ${JSON.stringify(this.activeStates[beforeReset])}`);
				// Read state array and write Data for every active state
				for (const stateID in this.activeStates) {
					this.log.info(`Reset start values for : ${stateID}`);
					this.log.info(`Memory values before reset : ${JSON.stringify(this.activeStates[stateID])}`);
					try {

						if (this.activeStates[stateID] == null || this.activeStates[stateID].calcValues == null || this.activeStates[stateID].stateDetails == null)  {
							this.log.error(`Cannot handle Day reset for ${stateID}, check your configuration (error  messages  at adapter start)`);
							continue;
						}

						const stateValues = this.activeStates[stateID].calcValues;
						const stateDetails = this.activeStates[stateID].stateDetails;
						// get current meter value
						const reading = this.activeStates[stateID].calcValues.cumulativeValue;
						if (reading === null || reading === undefined) continue;

						this.log.debug(`Memory values for ${stateID} before reset : ${JSON.stringify(this.activeStates[stateID])}`);
						this.log.debug(`Current known state values : ${JSON.stringify(stateValues)}`);

						const changes = calculation.getPeriodChanges(beforeReset, actualDate);
						if (changes.year) await this.initializeYearStatisticsStates(stateID);
						await this.copyPreviousPeriodStates(stateDetails, changes);
						await this.resetCurrentWeekdayStates(stateDetails, changes.week);

						const newCalcValues = {
							start_day: changes.day ? reading : stateValues.start_day,
							start_month: changes.month ? reading : stateValues.start_month,
							start_quarter: changes.quarter ? reading : stateValues.start_quarter,
							start_week: changes.week ? reading : stateValues.start_week,
							start_year: changes.year ? reading : stateValues.start_year,
							valueAtDeviceInit: stateValues.valueAtDeviceInit,
							valueAtDeviceReset: stateValues.valueAtDeviceReset,
							cumulativeValue: reading,
						};
						if (stateDetails.stateUnit === 'W') {
							newCalcValues.previousReadingWatt = null;
							newCalcValues.previousReadingWattTs = null;
						}

						this.activeStates[stateID].calcValues = newCalcValues;
						await this.resetDynamicCostMemory(stateID, reading, beforeReset);
						await this.extendForeignObject(stateID, {
							common: {
								custom: {
									[this.namespace]: newCalcValues,
								},
							},
						});
						await this.writeCurrentPeriodValuesAfterReset(stateID, reading, new Date());
						this.log.info(`Memory values after reset : ${JSON.stringify(this.activeStates[stateID])}`);

					} catch (error) {
						this.errorHandling(`[resetStartValues] ${stateID}`, error);
					}


				}

				// Enable all calculations with timeout of 500 ms
				if (delay) {
					this.clearTimeout(delay);
					delay = null;
				}
				delay = this.setTimeout(function () {
					calcBlock = false;
				}, 500);

			});

			resetDay.start();

		} catch (error) {
			this.errorHandling(`[resetStartValues]`, error);
			calcBlock = false; // Continue all calculations
		}

	}

	/**
	 * Function to handle previousState values
	 * @param {string} currentState - RAW state ID currentValue
	 * @param {string} [previousState] - RAW state ID previousValue
	 */
	async setPreviousValues(currentState, previousState) {
		// Only set previous state if option is chosen
		try {
			if (this.config.currentYearPrevious) {
				// Check if function input is correctly
				if (currentState && previousState) {
					// Get value of currentState
					const currentVal = await this.getStateAsync(currentState);
					if (currentVal) {
						// Set current value to previous state
						await this.setStateAsync(previousState, {
							val: currentVal.val,
							ack: true
						});
					}
				} else {
					this.log.debug(`[setPreviousValues] invalid data for currentState  ${currentState} and/or previousState ${previousState} received`);
				}
			}
		} catch (e) {
			this.errorHandling(`[setPreviousValues]`, e);
		}

	}

	/**
	 * Function to handle state creation
	 * @param {string} stateID - RAW state ID of monitored state
	 * @param {string} stateRoot - Root folder location
	 * @param {string} name - Name of state (also used for state ID !
	 * @param {boolean} [atDeviceRoot] - store value at root instead of Year-Folder
	 * @param {boolean} [deleteState] - Set to true will delete the state
	 * @param {boolean} [isCurrent] - Store value in current Year
	 * @param {string} [forceUnit] - Force unit to be set on state
	 */
	async doLocalStateCreate(stateID, stateRoot, name, atDeviceRoot, deleteState, isCurrent, forceUnit) {
		this.log.debug(`[doLocalStateCreate] ${stateID} | root : ${stateRoot} | name : ${name}) | atDeviceRoot ${atDeviceRoot} | isCurrent : ${isCurrent}`);

		// Check if stateDetails are preset in memory, other wise abort
		if (this.activeStates[stateID] == null || this.activeStates[stateID].stateDetails == null) return;
		this.log.debug(`[doLocalStateCreate] stateDetails ${stateID} : ${JSON.stringify(this.activeStates[stateID].stateDetails)}`);

		try {
			const stateDetails = this.activeStates[stateID].stateDetails;
			const dateRoot = isCurrent ? `currentYear` : actualDate.year;
			let stateName = null;

			// Common object content
			const commonData = {
				name: name,
				type: 'number',
				role: 'value',
				read: true,
				write: false,
				unit: forceUnit ? forceUnit : stateDetails.useUnit,
				def: 0,
			};

			// Define if state should be created at root level
			if (atDeviceRoot) {
				stateName = `${stateDetails.deviceName}.${stateRoot}`;
				if (!deleteState){
					await this.localSetObject(stateName, commonData);
				} else {
					await this.localDeleteState(stateName);
				}

			} else {

				// Create consumption states
				if (!deleteState && stateDetails.consumption) {
					switch (stateDetails.headCategory) {

						case 'consumed':
							await this.localSetObject(`${stateDetails.deviceName}.${dateRoot}.consumed.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.delivered.${stateRoot}`);
							break;

						case 'delivered':
							await this.localSetObject(`${stateDetails.deviceName}.${dateRoot}.delivered.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.consumed.${stateRoot}`);
							break;

						default:

					}

				} else if (deleteState || !stateDetails.consumption) {

					// If state deletion chosen, clean everything up else define state name
					await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.consumed.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${dateRoot}.consumed.${stateRoot}`);
					await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.delivered.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${dateRoot}.delivered.${stateRoot}`);

				}

				// Create MeterReading states
				if (!deleteState && stateDetails.meter_values) {

					// Do not create StateRoot values
					if (!basicStates.includes(stateRoot)) {
						await this.localSetObject(`${stateDetails.deviceName}.${dateRoot}.meterReadings.${stateRoot}`, commonData);
					}

				} else if (deleteState || !stateDetails.meter_values) {

					// If state deletion chosen, clean everything up else define state name
					await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.meterReadings.${stateRoot}`);

				}

				// Create cost states
				if (!deleteState && stateDetails.costs) {

				    //Use cost unit as defined in admin settings (currency)
					commonData.unit = useCurrency; // Switch Unit to money

					switch (stateDetails.financialCategory) {

						case 'costs':
							// await this.ChannelCreate(device, head_category, head_category);
							await this.localSetObject(`${stateDetails.deviceName}.${dateRoot}.costs.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.earnings.${stateRoot}`);
							break;

						case 'earnings':
							// await this.ChannelCreate(device, head_category, head_category);
							await this.localSetObject(`${stateDetails.deviceName}.${dateRoot}.earnings.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.costs.${stateRoot}`);
							break;

						default:

					}

				} else if (!stateDetails.costs) {

					// If state deletion chosen, clean everything up else define state name
					await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.costs.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${dateRoot}.costs.${stateRoot}`);
					await this.localDeleteState(`${stateDetails.deviceName}.${dateRoot}.earnings.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${dateRoot}.earnings.${stateRoot}`);
				}
			}

		} catch (error) {
			// Send code failure to sentry
			this.errorHandling(`[localStateCreate] ${stateID}`, error);
		}
	}

	/**
	 * create/extend function for objects
	 * @param {string} stateName - RAW state ID of monitored state
	 * @param {object} commonData - common data content
	 */
	async localSetObject(stateName, commonData) {
		this.validStates[stateName] = commonData;
		// Ensure name and unit changes are propagated
		await this.extendObjectAsync(stateName, {
			type: 'state',
			common: {
				name: commonData.name,
				unit: commonData.unit,
				type: 'number',
				def : 0
			},
			native: {},
		});
	}

	/**
	 * proper deletion of state and object
	 * @param {string} stateName - RAW state ID of monitored state
	 */
	async localDeleteState(stateName) {
		try {
			if (stateDeletion) {
				const obj = await this.getObjectAsync(stateName);
				if (obj) {
					await this.delObjectAsync(stateName);
				}
			}
		} catch {
			// do nothing
		}
	}

	/**
	 *Logic to handle all calculations
	 *  @param {string} [stateID] - state id of source value
	 *  @param {object} [stateVal] - object with current value (val) and timestamp (ts)
	 */
	async calculationHandler(stateID, stateVal) {
		try {
			this.log.debug(`[calculationHandler] Calculation for ${stateID} with values : ${JSON.stringify(stateVal)}`);
			this.log.debug(`[calculationHandler] Configuration : ${JSON.stringify(this.activeStates[stateID])}`);

			// Verify if received value is null or undefined
			if (!stateVal){
				this.log.error(`Input value for ${stateID} with ${JSON.stringify((stateVal))} is null or undefined, cannot continue calculation`);
				return;
			}

			// Verify if received value is null or undefined
			if (!stateID){
				// Cancel operation when function iis called with empty stateID
				return;
			}

			// Check if for some reason calculation handler ist called for an object not initialised
			if (!this.activeStates[stateID]){

				this.errorHandling(`calculationHandler`, `Called for non-initialised state ${stateID}`);
				return;
			}

			const calcValues = this.activeStates[stateID].calcValues;
			const stateDetails = this.activeStates[stateID].stateDetails;
			const statePrices = this.activeStates[stateID].prices;
			const currentCath = this.unitPriceDef.unitConfig[stateDetails.stateUnit].category;
			const targetCath = this.unitPriceDef.unitConfig[stateDetails.useUnit].category;
			const date = new Date();
			const readingTimestamp = this.getStateChangeTimestamp(stateVal);

			this.log.debug(`[calculationHandler] calcValues : ${JSON.stringify(calcValues)}`);
			this.log.debug(`[calculationHandler] stateDetails : ${JSON.stringify(stateDetails)}`);
			this.log.debug(`[calculationHandler] statePrices : ${JSON.stringify(statePrices)}`);
			this.log.debug(`[calculationHandler] currentCath : ${JSON.stringify(currentCath)}`);
			this.log.debug(`[calculationHandler] targetCath : ${JSON.stringify(targetCath)}`);

			let stateName = `${this.namespace}.${stateDetails.deviceName}`;

			// Define proper calculation value
			let reading;

			// Convert volume liter to cubic
			//TODO 0.5: Should  be handle  by library
			if (currentCath === 'Watt') {
				// Convert watt to watt-hours
				reading = await this.wattToWattHour(stateID, stateVal);
				if (reading === null || reading === undefined) return;
			} else if (currentCath === 'Liter' && targetCath === 'Cubic_meter') {
				reading = stateVal.val / 1000;
			} else if (currentCath === 'Cubic_meter' && targetCath === 'Liter'
			) {
				reading = stateVal.val * 1000;
			} else {
				reading = stateVal.val;
			}

			this.log.debug(`[calculationHandler] value : ${JSON.stringify(reading)}`);
			if (reading === null || reading === undefined) {
				this.log.error(`[calculationHandler] reading incorrect after conversion contact DEV and provide these info | Reading : ${JSON.stringify(reading)} | start reading ${JSON.stringify(stateVal)} | stateDetails ${JSON.stringify(stateDetails)}`);
				return;
			}

			const currentExponent = this.unitPriceDef.unitConfig[stateDetails.stateUnit].exponent;
			const targetExponent = this.unitPriceDef.unitConfig[stateDetails.useUnit].exponent;
			this.log.debug(`[calculationHandler] Reading value ${reading} before exponent multiplier | currentExponent : ${JSON.stringify(currentExponent)} | targetExponent : ${JSON.stringify(targetExponent)}`);
			// Logic to handle exponents and handle watt reading
			if (Number.isFinite(reading)) {
				if (currentCath === 'Watt') {
					// Add calculated watt reading to stored totals
					reading = (reading * Math.pow(10, (currentExponent - targetExponent))) + calcValues.cumulativeValue;
				} else {
					reading = reading * Math.pow(10, (currentExponent - targetExponent));
				}
			} else {
				this.log.error(`Input value for ${stateID}, type = ${typeof reading} but should be a number, cannot handle calculation`);
				return;
			}

			if (!Number.isFinite(reading)) {
				this.log.error(`[calculationHandler] reading incorrect after Exponent conversion contact DEV and provide these info | Reading : ${JSON.stringify(reading)} | start reading ${JSON.stringify(stateVal)} | currentExponent ${currentExponent} | targetExponent ${targetExponent} | stateDetails ${stateDetails}`);
				return;
			}

			this.log.debug(`[calculationHandler] reading value ${reading} after exponent multiplier : ${JSON.stringify(targetExponent)}`);

			if (currentCath !== 'Watt') {
				if (calcValues.valueAtDeviceReset == null) {
					this.log.info(`Initiating ${stateID} for the first time in SourceAnalytix`);
					calcValues.valueAtDeviceReset = 0;
					calcValues.valueAtDeviceInit = reading;
					await this.extendForeignObject(stateID, {common: {custom: {[this.namespace]: {
						valueAtDeviceReset: 0,
						valueAtDeviceInit: reading,
					}}}});
				} else {
					const resolvedReading = calculation.resolveCumulativeReading(
						reading,
						this.getNumberOrDefault(calcValues.valueAtDeviceReset, 0),
						this.getNumberOrDefault(calcValues.cumulativeValue, reading),
						stateDetails.deviceResetLogicEnabled,
						this.getNumberOrDefault(stateDetails.threshold, 0),
					);
					if (resolvedReading.type === 'invalid') {
						this.log.warn(`[calculationHandler] Ignoring non-finite cumulative reading for ${stateID}`);
						return;
					}
					if (resolvedReading.type === 'jitter') {
						this.log.debug(`[calculationHandler] Ignoring cumulative reading jitter of ${resolvedReading.decrease} for ${stateID}`);
						return;
					}
					if (resolvedReading.type === 'reset') {
						this.log.warn(`Device reset detected for ${stateID}; preserving cumulative value ${resolvedReading.reading} with new offset ${resolvedReading.resetOffset}`);
						calcValues.valueAtDeviceReset = resolvedReading.resetOffset;
						calcValues.valueAtDeviceInit = reading;
						await this.extendForeignObject(stateID, {common: {custom: {[this.namespace]: {
							valueAtDeviceReset: resolvedReading.resetOffset,
							valueAtDeviceInit: reading,
						}}}});
					} else if (resolvedReading.type === 'decrease') {
						this.log.info(`Cumulative reading for ${stateID} decreased while reset detection is disabled`);
					}
					reading = resolvedReading.reading;
				}
			}

			this.log.debug(`[calculationHandler] ${stateID} set cumulated value ${reading}`);
			// Update current value to memory
			this.activeStates[stateID]['calcValues'].cumulativeValue = reading;
			// this.visWidgetJson[stateID].cumulativeValue = reading;
			this.log.debug(`[calculationHandler] ActiveStatesArray ${JSON.stringify(this.activeStates[stateID])})`);

			// Write current reading at device root
			await this.setStateChangedAsync(`${stateDetails.deviceName}.cumulativeReading`, {
				val: reading,
				ack: true
			});

			// Write current reading at year statistics
			if (this.config.store_weeks || this.config.store_months || 	this.config.store_quarters){
				await this.setStateChangedAsync(`${stateDetails.deviceName}.${actualDate.year}.readingCumulative`, {
					val: reading,
					ack: true
				});
			}

			//TODO 0.5; implement counters
			// 	// Handle impulse counters
			// 	if (obj_custom.state_type == 'impulse'){

			// 		// cancel calculation in case of impulse counter
			// 		return;

			// 	}

			//TODO 0.5: Implement periods
			// temporary set to Zero, this value will be used later to handle period calculations
			const reading_start = 0; //obj_cust.start_meassure;
			const parsedUnitPrice = this.parsePriceValue(statePrices.unitPrice);
			const unitPrice = parsedUnitPrice === null ? 0 : parsedUnitPrice;
			if (stateDetails.costs && parsedUnitPrice === null) {
				this.log.warn(`[calculationHandler] Unit price ${JSON.stringify(statePrices.unitPrice)} for ${stateID} is not numeric, using 0 to avoid invalid cost calculations`);
			}

			this.log.debug(`[calculationHandler] PreviousCalculationRounded for ${stateID} : ${JSON.stringify(previousCalculationRounded[stateID])}`);

			// Store meter values
			if (stateDetails.meter_values === true) {
				// Always write generic meterReadings for current year
				stateName = `${this.namespace}.${stateDetails.deviceName}.currentYear.meterReadings`;
				const readingRounded = await this.roundDigits(reading);

				// Store meter reading to related period
				if (readingRounded) {
					if (this.config.currentYearDays) {
						await this.setStateChangedAsync(`${stateName}.currentWeek.${weekdays[date.getDay()]}`, {
							val: readingRounded,
							ack: true
						});
					}
					stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${actualDate.year}.meterReadings`;
					if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, {
						val: readingRounded,
						ack: true
					});
					// Month
					if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, {
						val: readingRounded,
						ack: true
					});
					// Quarter
					if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.Q${actualDate.quarter}`, {
						val: readingRounded,
						ack: true
					});
				}
			}

			// Handle calculations
			const calculations = {
				consumedDay: ((reading - calcValues.start_day) - reading_start),
				consumedWeek: ((reading - calcValues.start_week) - reading_start),
				consumedMonth: ((reading - calcValues.start_month) - reading_start),
				consumedQuarter: ((reading - calcValues.start_quarter) - reading_start),
				consumedYear: ((reading - calcValues.start_year) - reading_start),
				priceDay: unitPrice * ((reading - calcValues.start_day) - reading_start),
				priceWeek: unitPrice * ((reading - calcValues.start_week) - reading_start),
				priceMonth: unitPrice * ((reading - calcValues.start_month) - reading_start),
				priceQuarter: unitPrice * ((reading - calcValues.start_quarter) - reading_start),
				priceYear: unitPrice * ((reading - calcValues.start_year) - reading_start),
			};

			this.log.debug(`[calculationHandler] Result of calculation: ${JSON.stringify(calculations)}`);

			// Handle rounding of values
			const calculationRounded = {
				consumedDay: await this.roundDigits(calculations.consumedDay),
				consumedWeek: await this.roundDigits(calculations.consumedWeek),
				consumedMonth: await this.roundDigits(calculations.consumedMonth),
				consumedQuarter: await this.roundDigits(calculations.consumedQuarter),
				consumedYear: await this.roundDigits(calculations.consumedYear),
			};

			let variableCosts = {
				priceDay: calculations.priceDay,
				priceWeek: calculations.priceWeek,
				priceMonth: calculations.priceMonth,
				priceQuarter: calculations.priceQuarter,
				priceYear: calculations.priceYear,
			};
			if (this.usesHistoricalCostCalculation(stateID)) {
				const dynamicCalculationRounded = await this.calculateDynamicCostsForState(stateID, reading, readingTimestamp);
				if (dynamicCalculationRounded && this.activeStates[stateID].dynamicCosts) {
					variableCosts = this.activeStates[stateID].dynamicCosts.totals;
				}
			}
			if (stateDetails.costs) Object.assign(calculationRounded, await this.addBasicPriceTotals(stateID, variableCosts, date));

			// this.visWidgetJson[stateID].date = calculationRounded;
			this.log.debug(`[calculationHandler] Result of rounding: ${JSON.stringify(calculations)}`);

			if (stateDetails.consumption) await this.writeConsumptionStates(stateID, calculationRounded, date);

			// Store prices
			if (stateDetails.costs) {
				await this.writeFinancialStates(stateID, calculationRounded, date);

			}

			// Store results of current calculation to memory
			//ToDo 0.4.9 : Build JSON array for current values to have widget & information easy accessible in vis
			previousCalculationRounded[stateID] = calculationRounded;

			this.log.debug(`[calculationHandler] Meter Calculation executed consumed data for ${stateID} : ${JSON.stringify(calculationRounded)}`);


		} catch (error) {
			this.errorHandling(`[calculationHandler] ${stateID} with config ${JSON.stringify(this.activeStates[stateID])}`, error);
		}

	}

	/**
	 *	Initiate json array for vis widget
	 *  @param {string} [stateID] - state id of source value
	 */
	// async buildVisWidgetJson(stateID){
	// 	this.log.debug(`[buildVisWidgetJson] Start building VisWidgetJson for ${stateID}`);
	// 	this.visWidgetJson[stateID] = {
	// 		unit: this.activeStates[stateID].stateDetails.useUnit,
	// 		currency: useCurrency
	// 	};
	// 	this.log.debug(`[buildVisWidgetJson] ${stateID} : ${JSON.stringify(this.visWidgetJson[stateID])}`);
	// }

	/**
	 * @param {number} [value] - Number to round with , separator
	 */
	async roundDigits(value) {
		let rounded;
		try {
			rounded = Number(value);
			rounded = Math.round(rounded * 1000) / 1000;
			this.log.debug(`roundDigits with ${value} rounded ${rounded}`);
			if (!rounded) return value;
			return rounded;
		} catch (error) {
			this.errorHandling(`[roundDigits] ${value}`, error);
			rounded = value;
			return rounded;
		}
	}

	/**
	 * @param {number} [value] - Number to round with . separator
	 */
	async roundCosts(value) {
		try {
			const numericValue = Number(value);
			if (!Number.isFinite(numericValue)) {
				this.log.warn(`roundCosts received non-numeric value ${JSON.stringify(value)}, returning 0`);
				return 0;
			}
			let rounded = numericValue;
			rounded = Math.round(rounded * 100) / 100;
			this.log.debug(`roundCosts with ${value} rounded ${rounded}`);
			return rounded;
		} catch (error) {
			this.errorHandling(`[roundCosts] ${value}`, error);
			return 0;
		}
	}

	/**
	 * @param {string} stateID - ID of the source state
	 * @param {ioBroker.State} value - Current power value and timestamp
	 */
	async wattToWattHour(stateID, value) {
		try {

			const calcValues = this.activeStates[stateID].calcValues;

			this.log.debug(`[wattToWattHour] Watt to kWh, current reading : ${value.val} previousReading : ${JSON.stringify(calcValues)}`);

			// Prepare needed data to handle calculations
			const readingData = {
				previousReadingWatt: Number(calcValues.previousReadingWatt),
				previousReadingWattTs: Number(calcValues.previousReadingWattTs),
				currentReadingWatt: Number(value.val),
				currentReadingWattTs: Number(value.ts),
			};

			// Prepare function return
			let calckWh;

			if (readingData.previousReadingWatt && readingData.previousReadingWattTs) {

				// Calculation logic W to kWh
				calckWh = (((readingData.currentReadingWattTs - readingData.previousReadingWattTs)) * readingData.previousReadingWatt / 3600000);
				this.log.debug(`[wattToWattHour] ${stateID} result of watt to kWh calculation : ${calckWh}`);

				// Update timestamp current reading to memory
				this.activeStates[stateID]['calcValues'].previousReadingWatt = readingData.currentReadingWatt;
				this.activeStates[stateID]['calcValues'].previousReadingWattTs = readingData.currentReadingWattTs;

			} else {

				this.log.debug(`[wattToWattHour] No previous reading available, store current to memory`);

				// Update timestamp current reading to memory
				this.activeStates[stateID]['calcValues'].previousReadingWatt = readingData.currentReadingWatt;
				this.activeStates[stateID]['calcValues'].previousReadingWattTs = readingData.currentReadingWattTs;
				calckWh = 0; // return 0 kWh consumption as measurement

			}

			this.log.debug(`[wattToWattHour] ${stateID} Watt to kWh outcome : ${JSON.stringify(this.activeStates[stateID].calcValues)}`);
			return calckWh;
		} catch (error) {
			this.errorHandling(`[wattToWattHour] ${stateID}`, error);
		}
	}

	/**
	 * @param {string} stateID - ID of the source state
	 * @param {string} deviceName - Name of the device
	 */
	async getCumulatedValue(stateID, deviceName) {
		this.log.debug(`[getCumulatedValue] ${stateID }`);
		let valueSource; // For debugging purpose
		let currentCumulated; // Cumulated value

		// Check if previous reading exist in state
		currentCumulated = await this.getStateAsync(`${deviceName}.cumulativeReading`);
		// Check if value exist in cumulativeReading state (Version >= 0.4.8-alpha5)
		if (!currentCumulated || currentCumulated.val === 0) {

			// If values does not exist or is 0, check Current_Reading (pre 0.4.8-alpha 5!)
			currentCumulated = await this.getStateAsync(`${deviceName}.Current_Reading`);
			if (!currentCumulated || currentCumulated.val === 0) {
				currentCumulated = await this.getStateAsync(`${deviceName}.Meter_Readings.Current_Reading`);
				// If values does not exist or is 0, check Current_Reading (pre 0.4.0)
				if (!currentCumulated || currentCumulated.val === 0) {
					valueSource = 'Fresh installation';
					currentCumulated = 0;

				} else {
					valueSource = 'Version < 4';
					currentCumulated = currentCumulated.val;
				}
			} else {
				valueSource = 'Version <= 0.4.8-alpha7';
				currentCumulated = currentCumulated.val;
			}

		} else {
			// Cumulative present and not 0, process normally
			currentCumulated = currentCumulated.val;
			valueSource = 'Version >= 0.4.8-alpha7';
		}
		this.log.debug(`[getCumulatedValue] By using ${valueSource} :${currentCumulated}`);
		return currentCumulated;
	}

	/**
	 * Load current dates (year, week, month, quarter, day)
	 */
	async refreshDates() {
	    // Get current date
		const today = new Date(); // Get current date in Unix time format
		// Store current used dates to memory
		const previousDates = {
			day: actualDate.day,
			week: actualDate.week,
			month: actualDate.month,
			quarter: actualDate.quarter,
			year: actualDate.year
		};

		// Write current dates to memory
		actualDate.day = weekdays[today.getDay()];
		actualDate.week = this.getWeekNumber(today);
		actualDate.month = months[today.getMonth()];
		actualDate.quarter = Math.floor((today.getMonth() + 3) / 3);
		actualDate.year = (new Date().getFullYear());

		return previousDates;
	}

	/**
	 * define proper week-number, add 0 in case of < 10
	 * @param {object} d - Current date (like initiated with new Date())
	 */
	getWeekNumber(d) {
		// Copy date so don't modify original
		d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
		// Set to nearest Thursday: current date + 4 - current day number
		// Make Sunday's day number 7
		d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
		// Get first day of year
		const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
		// Calculate full weeks to nearest Thursday
		let weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7).toString();

		if (weekNo.length === 1) {
			weekNo = '0' + weekNo;
		}
		// Return week number
		return weekNo;
	}

	/**
	 * @param {string} codePart - Message prefix
	 * @param {unknown} error - Error to report
	 */
	errorHandling(codePart, error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const errorStack = error instanceof Error ? error.stack : undefined;
		const msg = `[${codePart}] error: ${errorMessage}, stack: ${errorStack || 'not available'}`;
		if (!disableSentry) {
			if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
				const sentryInstance = this.getPluginInstance('sentry');
				if (sentryInstance) {
					this.log.info(`[Error caught and sent to Sentry, thank you for collaborating!] error: ${msg}`);
					sentryInstance.getSentryObject().captureException(msg);
				}
			}
		} else {
			this.log.error(`Sentry disabled, error caught : ${msg}`);
			console.error(`Sentry disabled, error caught : ${msg}`);
		}
	}

	//Function to handle messages from State settings and provide Unit and Price definitions
	async onMessage(obj) {

		if (obj) {
			switch (obj.command) {
				case 'getPriceDefinitions':
					if (obj.callback) {

						const priceDefinitionArray = [];
						for (const priceDefinition in this.unitPriceDef.pricesConfig){
							priceDefinitionArray.push({label: priceDefinition, value: priceDefinition});
						}
						this.sendTo(obj.from, obj.command, priceDefinitionArray, obj.callback);
					}
					break;

				case 'getUnits':
					if (obj.callback) {

						const unitArray = [];

						unitArray.push({label: 'Detect automatically', value: 'Detect automatically'});
						for (const priceDefinition in this.unitPriceDef.unitConfig){
							unitArray.push({label: priceDefinition, value: priceDefinition});
						}
						this.sendTo(obj.from, obj.command, unitArray, obj.callback);
					}
					break;
			}
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback - Signals that adapter shutdown is complete
	 */
	onUnload(callback) {
		try {
			this.log.info(`SourceAnalytix stopped, now you have to calculate by yourself :'( ...`);
			callback();
		} catch {
			callback();
		}
	}

}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter startup options
	 */
	module.exports = (options) => new Sourceanalytix(options);
} else {
	// otherwise start the instance directly
	new Sourceanalytix();

}
