'use strict';

/*
 * Created with @ioBroker/create-adapter v1.11.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const adapterHelpers = require('iobroker-adapter-helpers'); // Lib used for Unit calculations
const adapterName = require('./package.json').name.split('.').pop();
const schedule = require('cron').CronJob; // Cron Scheduler

// Sentry error reporting, disable when testing alpha source code locally!
const sendSentry = true
// Sentry error reporting, disable when testing alpha source code locally!

// Store all days and months
const basicStates = ['01_currentDay', '02_currentWeek', '03_currentMonth', '04_currentQuarter', '05_currentYear'];
const basicPreviousStates = ['01_previousDay', '02_previousWeek', '03_previousMonth', '04_previousQuarter', '05_previousYear'];
const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');
const stateDeletion = true, deviceResetHandled = [], previousCalculationRounded = {};
const storeSettings = {}, previousStateVal = {};
let calcBlock = null; // Global variable to block all calculations
let delay = null; // Global array for all running timers

// Create variables for object arrays
const history = {}, actualDate = {}; //, currentDay = null;

class Sourceanalytix extends utils.Adapter {
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		// @ts-ignore
		super({
			...options,
			// @ts-ignore
			name: adapterName,
		});

		this.on('ready', this.onReady.bind(this));
		this.on('objectChange', this.onObjectChange.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		// Unit and price definitions, will be loaded at adapter start.
		this.unitPriceDef = {
			unitConfig: {},
			pricesConfig: {}
		};
		this.activeStates = {}; // Array of activated states for SourceAnalytix
		this.validStates = {}; // Array of all created states
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		try {

			this.log.info('Welcome to SourceAnalytix, making things ready ... ');

			// Block all calculation functions during startup
			calcBlock = true;

			// Load Unit definitions from helper library to workable memory array
			await this.definitionLoader();

			// Store current data/time information to memory
			await this.refreshDates();

			// Load global store store settings
			//TODO: Rename variable
			storeSettings.storeWeeks = this.config.store_weeks;
			storeSettings.storeMonths = this.config.store_months;
			storeSettings.storeQuarters = this.config.store_quarters;

			console.log('Initializing enabled states for SourceAnalytix');

			// get all objects with custom configuration items
			const customStateArray = await this.getObjectViewAsync('custom', 'state', {});
			console.log(`All states with custom items : ${JSON.stringify(customStateArray)}`);

			// Get all active state for Sourceanalytix
			if (customStateArray && customStateArray.rows) {

				for (let i = 0, l = customStateArray.rows.length; i < l; i++) {
					if (customStateArray.rows[i].value) {
						const id = customStateArray.rows[i].id;

						history[id] = customStateArray.rows[i].value;

						if (history[id].enabled !== undefined) {
							history[id] = history[id].enabled ? { 'history.0': history[id] } : null;
							if (!history[id]) {
								this.log.warn('undefined id');
								continue;
							}
						}

						// If enabled for SourceAnalytix, handle routine to store relevant data to memory
						if (!history[id][this.namespace] || history[id][this.namespace].enabled === false) {
							// Not SourceAnalytix relevant ignore
						} else {
							await this.buildStateDetailsArray(id);
						}
					}
				}
			}

			// Initialize all discovered states
			let count = 1;
			for (const stateID in this.activeStates) {
				this.log.info(`Initialising (${count} of ${Object.keys(this.activeStates).length}) state ${stateID}`);
				await this.initialize(stateID);
				this.log.info(`Initialization (${count} of ${Object.keys(this.activeStates).length}) finished for : ${stateID}`);
				count = count + 1;
			}

			// Start Daily reset function by cron job
			await this.resetStartValues();

			// Subscribe on all foreign objects to detect (de)activation of sourceanalytix enabled states
			this.subscribeForeignObjects('*');

			// Enable all calculations with timeout of 500 ms
			if (delay) { clearTimeout(delay); delay = null; }
			delay = setTimeout(function () {
				calcBlock = false;
			}, 500);

			this.log.info(`SourceAnalytix initialisation finalized, will handle calculations ... for : ${JSON.stringify(this.activeStates)}`)
			this.cleanupUnused()

		} catch (error) {
			this.errorHandling('onReady', error);
		}

	}

	//ToDo: Implement cleanup for unused states
	async cleanupUnused () {
		const allStates = await this.getAdapterObjectsAsync()
		this.log.info((JSON.stringify(allStates)))
	}

	// Load calculation factors from helper library and store to memory
	//ToDO: Implement error handling
	async definitionLoader() {

		// Load energy definitions
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

		// Load volumes definitions
		catArray = ['Liter', "Cubic_meter"];
		for (const item in catArray) {
			const unitItem = adapterHelpers.units.volume[catArray[item]];
			for (const unitCat in unitItem) {
				unitStore[unitItem[unitCat].unit] = {
					exponent: unitItem[unitCat].exponent,
					category: catArray[item],
				};
			}
		}

		// Load price definition to memory
		const pricesConfig = this.config.pricesDefinition;
		const priceStore = this.unitPriceDef.pricesConfig;

		for (const priceDef in pricesConfig) {
			priceStore[pricesConfig[priceDef].cat] = {
				cat: pricesConfig[priceDef].cat,
				uDes: pricesConfig[priceDef].cat,
				uPpU: pricesConfig[priceDef].uPpU,
				uPpM: pricesConfig[priceDef].uPpM,
				costType: pricesConfig[priceDef].costType,
				unitType: pricesConfig[priceDef].unitType,
			};
		}

		console.debug(`All Unit category's ${JSON.stringify(this.unitPriceDef)}`);
	}

	async buildStateDetailsArray(stateID) {
		try {

			// Load configuration as provided in state settings
			const stateInfo = await this.getForeignObjectAsync(stateID);
			if (!stateInfo) {
				this.log.error(`Can't get information for ${stateID}, statechange will be ignored`);
				return;
			}

			// Replace not allowed characters for state name
			const newDeviceName = stateID.split('.').join('__');

			// Check if configuration for SourceAnalytix is present, trow error in case of issue in configuration
			if (stateInfo && stateInfo.common && stateInfo.common.custom && stateInfo.common.custom[this.namespace]) {
				const customData = stateInfo.common.custom[this.namespace];
				const commonData = stateInfo.common;

				// Load start value from config to memory (avoid wrong calculations at meter reset, set to 0 if empty)
				const valueAtDeviceReset = (customData.valueAtDeviceReset && customData.valueAtDeviceReset !== 0) ? customData.valueAtDeviceReset : 0;

				// Read current known total value to memory (if present)
				let currentValue = await this.getCurrentTotal(stateID, newDeviceName);
				currentValue = currentValue ? currentValue : 0;

				// Check and load unit definition
				let useUnit = '';
				if (
					customData.selectedUnit !== 'automatically'
					&& customData.selectedUnit !== 'automatisch'
					&& customData.selectedUnit !== 'автоматически'
					&& customData.selectedUnit !== 'automaticamente'
					&& customData.selectedUnit !== 'automatisch'
					&& customData.selectedUnit !== 'automatiquement'
					&& customData.selectedUnit !== 'automaticamente'
					&& customData.selectedUnit !== 'automáticamente'
					&& customData.selectedUnit !== 'automatycznie'
					&& customData.selectedUnit !== '自动'
				) {

					useUnit = customData.selectedUnit;

				} else if (commonData.unit && commonData.unit !== '' && !this.unitPriceDef.unitConfig[commonData.unit] ) {
					this.log.error(`Automated united detection for ${stateID} failed, cannot execute calculations !`);
					this.log.error(`Please choose unit manually in state configuration`);
					return;

				} else if (commonData.unit && commonData.unit !== '' && this.unitPriceDef.unitConfig[commonData.unit] ) {

					useUnit = commonData.unit;

				} else if (!commonData.unit || commonData.unit === '') {
					this.log.error(`No unit defined for ${stateID}, cannot execute calculations !`);
					this.log.error(`Please choose unit manually in state configuration`);
					return;
				}

				// Load state price definition
				if (!customData.selectedPrice || customData.selectedPrice === '' || customData.selectedPrice === 'Choose') {
					this.log.error(`Cannot execute calculations for ${stateID} adjust settings !`);
					this.log.error(`No cost type defined for ${stateID}, please Select Type of calculation at state setting`);
					return;
				}

				if ( !this.unitPriceDef.pricesConfig[customData.selectedPrice]	 ) {
					this.log.error(`Cannot execute calculations for ${stateID} adjust settings !`);
					this.log.error(`Selected Type ${customData.selectedPrice} does not exist in Price Definitions`);
					this.log.error(`Please choose proper type for state ${stateID}`);
					this.log.error(`Or add price definition ${customData.selectedPrice} in adapter settings`);
					return;
				}

				const stateType = this.unitPriceDef.pricesConfig[customData.selectedPrice].costType;

				// Load state settings to memory
				this.activeStates[stateID] = {
					stateDetails: {
						alias: customData.alias.toString(),
						consumption: customData.consumption,
						costs: customData.costs,
						deviceName: newDeviceName.toString(),
						financialCategory: stateType,
						headCategory: stateType === 'earnings' ? 'delivered' : 'consumed',
						meter_values: customData.meter_values,
						name: stateInfo.common.name,
						stateType: customData.selectedPrice,
						stateUnit: useUnit,
						useUnit: this.unitPriceDef.pricesConfig[customData.selectedPrice].unitType,
					},
					calcValues: {
						currentValue: currentValue,
						start_day: customData.start_day,
						start_month: customData.start_month,
						start_quarter: customData.start_quarter,
						start_week: customData.start_week,
						start_year: customData.start_year,
						valueAtDeviceReset: valueAtDeviceReset,
					},
					prices: {
						basicPrice: this.unitPriceDef.pricesConfig[customData.selectedPrice].uPpM,
						unitPrice: this.unitPriceDef.pricesConfig[customData.selectedPrice].uPpU,
					},
				};

				if (stateInfo.common.unit === 'w') {
					this.activeStates[stateID].calcValues.previousReadingWatt = null;
					this.activeStates[stateID].calcValues.previousReadingWattTs = null;
				}
				this.log.debug(`[buildStateDetailsArray] of ${stateID}: with content ${JSON.stringify(this.activeStates[stateID])}`);
			}
		} catch (error) {
			// Send code failure to sentry
			this.errorHandling(`[buildStateDetailsArray] for ${stateID}`, error);
		}
	}

	// Create object tree and states for all devices to be handled
	async initialize(stateID) {
		try {

			this.log.debug(`Initialising ${stateID} with configuration ${JSON.stringify(this.activeStates[stateID])}`);

			// Shorten configuration details for easier access
			if (!this.activeStates[stateID]) {
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
					await this.doLocalStateCreate(stateID, `currentWeek.${weekdays[x]}`, weekdays[x], false, false, true)
				} else if (stateDeletion) {
					this.log.debug(`Deleting states for week ${weekdays[x]} (if present)`);
					await this.doLocalStateCreate(stateID, `currentWeek.${weekdays[x]}`, weekdays[x], false, true,true);
				}

				if (this.config.currentYearPrevious === true) {
					await this.doLocalStateCreate(stateID, `previousWeek.${weekdays[x]}`, weekdays[x], false, false, true)
				} else if (stateDeletion) {
					this.log.debug(`Deleting states for week ${weekdays[x]} (if present)`);
					await this.doLocalStateCreate(stateID, `previousWeek.${weekdays[x]}`, weekdays[x], false, true,true);

				}
			}

			// create states for weeks
			for (let y = 1; y < 54; y++) {
				let weekNr;
				if (y < 10) {
					weekNr = '0' + y;
				} else {
					weekNr = y.toString();
				}
				const weekRoot = `weeks.${weekNr}`;

				if (this.config.store_weeks) {
					this.log.debug(`Creating states for week ${weekNr}`);
					await this.doLocalStateCreate(stateID, weekRoot, weekNr);
				} else if (stateDeletion) {
					this.log.debug(`Deleting states for week ${weekNr} (if present)`);
					await this.doLocalStateCreate(stateID, weekRoot, weekNr, false, true);
				}
			}

			// create states for months
			for (const month in months) {
				const monthRoot = `months.${months[month]}`;

				if (this.config.store_months) {
					this.log.debug(`Creating states for month ${month}`);
					await this.doLocalStateCreate(stateID, monthRoot, months[month]);
				} else if (stateDeletion) {
					this.log.debug(`Deleting states for month ${month} (if present)`);
					await this.doLocalStateCreate(stateID, monthRoot, months[month], false, true);
				}
			}
			// create states for quarters
			for (let y = 1; y < 5; y++) {
				const quarterRoot = `quarters.Q${y}`;
				if (this.config.store_quarters) {
					this.log.debug(`Creating states for quarter ${quarterRoot}`);
					await this.doLocalStateCreate(stateID, quarterRoot, `Q${y}`);
				} else if (stateDeletion) {
					this.log.debug(`Deleting states for quarter ${quarterRoot} (if present)`);
					await this.doLocalStateCreate(stateID, quarterRoot, quarterRoot, false, true);
				}
			}

			// Create basic current states
			for (const state of basicStates) {
				await this.doLocalStateCreate(stateID, state, state, false,false,true);
			}

			// Create basic current states for previous periods
			if (this.config.currentYearPrevious){
				for (const state of basicPreviousStates) {
					await this.doLocalStateCreate(stateID, state, state, false,false,true);
				}
			}

			// Create state for current reading
			const stateName = 'Current_Reading';
			await this.doLocalStateCreate(stateID, stateName, 'Current Reading', true);

			// Handle calculation
			const value = await this.getForeignStateAsync(stateID);
			this.log.debug(`First time calc result after initialising`);
			if (value) {
				await this.calculationHandler(stateID, value);
			}

			// Subscribe state, every state change will trigger calculation now automatically
			this.subscribeForeignStates(stateID)

		} catch (error) {
			this.log.error(`[initialize failed for ${stateID}] error: ${error.message}, stack: ${error.stack}`);
			// Send code failure to sentry
			this.errorHandling(`[buildStateDetailsArray] for ${stateID}`, error);
		}
	}

	/**
	 * Is called if an object changes to ensure (de-) activation of calculation or update configuration settings
	 * @param {string} id
	 * @param {ioBroker.Object | null | undefined} obj
	 */
	async onObjectChange(id, obj) {
		if (calcBlock) return; // cancel operation if calculation block is activate
		try {
			const stateID = id;

			// Check if object is activated for SourceAnalytix
			if (obj && obj.common) {

				// @ts-ignore : from does exist on states
				// if (obj.from === `system.adapter.${this.namespace}`) return; // Ignore object change if cause by SourceAnalytix to prevent overwrite
				// Verify if custom information is available regarding SourceAnalytix
				if (obj.common.custom && obj.common.custom[this.namespace] && obj.common.custom[this.namespace].enabled) {

					// ignore object changes when caused by SA (memory is handled internally)
					// if (obj.from !== `system.adapter.${this.namespace}`) {
					this.log.debug(`Object array of SourceAnalytix activated state changed : ${JSON.stringify(obj)} stored config : ${JSON.stringify(this.activeStates)}`);
					const newDeviceName = stateID.split('.').join('__');

					// Verify if the object was already activated, if not initialize new device
					if (!this.activeStates[stateID]) {
						this.log.debug(`Enable SourceAnalytix for : ${stateID}`);
						await this.buildStateDetailsArray(id);
						this.log.debug(`Active state array after enabling ${stateID} : ${JSON.stringify(this.activeStates)}`);
						await this.initialize(stateID);
					} else {
						this.log.debug(`Updated SourceAnalytix configuration for : ${stateID}`);
						await this.buildStateDetailsArray(id);
						this.log.debug(`Active state array after updating configuration of ${stateID} : ${JSON.stringify(this.activeStates)}`);
						await this.initialize(stateID);
					}

				} else if (this.activeStates[stateID]) {
					this.activeStates[stateID] = null;
					this.log.info(`Disabled SourceAnalytix for : ${stateID}`);
					this.log.debug(`Active state array after deactivation of ${stateID} : ${JSON.stringify(this.activeStates)}`);
					this.unsubscribeForeignStates(stateID);
				}

			} else {
				// Object change not related to this adapter, ignoring
			}
		} catch (error) {
			this.log.error(`[onObjectChange ${JSON.stringify(obj)}] error: ${error.message}, stack: ${error.stack}`);
			// Send code failure to sentry
			this.errorHandling(`[onObjectChange] for ${id}`, error);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (calcBlock) return; // cancel operation if global calculation block is activate
		try {
			if (state) {
				// The state was changed
				this.log.debug(`state ${id} changed : ${JSON.stringify(state)} SourceAnalytix calculation executed`);

				//ToDo: Implement x ignore time (configurable) to avoid overload of unneeded calculations
				// Avoid unneeded calculation if value is equal to known value in memory
				if (previousStateVal[id] !== state.val) {

					this.calculationHandler(id, state);
					previousStateVal[id] = state.val;

				} else {
					this.log.debug(`Update osf state ${id} received with equal value ${state.val} ignoring`);
				}

			}
		} catch (error) {
			this.log.error(`[onStateChane ${id}] error: ${error.message}, stack: ${error.stack}`);
			this.errorHandling(`[onObjectChange] for ${id}`, error);
		}
	}

	// Function to calculate current week number
	getWeekNumber(d) {
		// Copy date so don't modify original
		d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
		// Set to nearest Thursday: current date + 4 - current day number
		// Make Sunday's day number 7
		d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
		// Get first day of year
		const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
		// Calculate full weeks to nearest Thursday
		// @ts-ignore subtracting dates is fine
		let weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7).toString();

		if (weekNo.length === 1) {
			weekNo = '0' + weekNo;
		}
		// Return week number
		return weekNo;
	}

	async resetStartValues() {
		try {
			const resetDay = new schedule('0 0 * * *', async () => {
			// const resetDay = new schedule('* * * * *', async () => { //  testing schedule
				calcBlock = true; // Pause all calculations
				const beforeReset = await this.refreshDates(); // Reset date values in memory

				// Read state array and write Data for every active state
				for (const stateID in this.activeStates) {
					this.log.info(`Reset start values for : ${stateID}`)
					console.log(stateID);
					try {
						const stateValues = this.activeStates[stateID].calcValues;
						const stateDetails = this.activeStates[stateID].stateDetails;
						// get current meter value
						const reading = this.activeStates[stateID].calcValues.currentValue;
						if (reading === null || reading === undefined) continue;

						this.log.debug(`Memory values for ${stateID} before reset : ${JSON.stringify(this.activeStates[stateID])}`);
						this.log.debug(`Current known state values : ${JSON.stringify(stateValues)}`)

						// Prepare custom object and store correct values
						const obj = {};
						obj.common = {};
						obj.common.custom = {};
						obj.common.custom[this.namespace] = {
							currentValue: reading,
							start_day: reading,
							start_week: beforeReset.week === actualDate.week ? stateValues.start_week : reading,
							start_month: beforeReset.month === actualDate.month ? stateValues.start_month : reading,
							start_quarter: beforeReset.quarter === actualDate.quarter ? stateValues.start_quarter : reading,
							start_year: beforeReset.year === actualDate.year ? stateValues.start_year : reading,
							valueAtDeviceReset: stateValues.valueAtDeviceReset !== undefined ? stateValues.valueAtDeviceReset : 0
						};

						// Extend object with start value [type] & update memory
						obj.common.custom[this.namespace].start_day = reading;
						this.activeStates[stateID].calcValues = obj.common.custom[this.namespace];

						//At week reset ensure current week value are moved to previous week and current set to 0
						if (beforeReset.week !== actualDate.week){
							for (const x in weekdays) {

								if (this.config.currentYearDays ) {

									// Handle consumption states consumption states
									if (stateDetails.consumption) {
										switch (stateDetails.headCategory) {

											case 'consumed':
												await this.setPreviousValues(`${stateID}.currentYear.consumed.currentWeek${weekdays[x]}`, `${stateID}.currentYear.consumed.previousWeek.${weekdays[x]}`);
												await this.setStateAsync(`${stateID}.currentYear.consumed.currentWeek${weekdays[x]}`, {val : 0, ack: true})
												break;

											case 'delivered':
												await this.setPreviousValues(`${stateID}.currentYear.delivered.currentWeek.${weekdays[x]}`, `${stateID}.currentYear.delivered.previousWeek.${weekdays[x]}`);
												await this.setStateAsync(`${stateID}.currentYear.delivered.currentWeek${weekdays[x]}`, {val : 0, ack: true})
												break;

											default:

										}

									}

									// Handle financial states consumption states
									switch (stateDetails.financialCategory) {

										case 'costs':
											await this.setPreviousValues(`${stateID}.currentYear.costs.currentWeek.${weekdays[x]}`, `${stateID}.currentYear.costs.previousWeek.${weekdays[x]}`);
											await this.setStateAsync(`${stateID}.currentYear.costs.currentWeek${weekdays[x]}`, {val : 0, ack: true})
											break;

										case 'earnings':
											await this.setPreviousValues(`${stateID}.currentYear.earnings.currentWeek.${weekdays[x]}`, `${stateID}.currentYear.earnings.previousWeek.${weekdays[x]}`);
											await this.setStateAsync(`${stateID}.currentYear.earnings.currentWeek${weekdays[x]}`, {val : 0, ack: true})
											break;

										default:

									}

									// Handle meter reading states
									await this.setPreviousValues(`${stateID}.currentYear.meterReadings.currentWeek.${weekdays[x]}`, `${stateID}.currentYear.meterReadings.previousWeek.${weekdays[x]}`);
									await this.setStateAsync(`${stateID}.currentYear.meterReadings.currentWeek${weekdays[x]}`, {val : 0, ack: true})

								}

							}
						}

						// Handle all "previous states"
						if (this.config.currentYearPrevious) {
							// Handle consumption states consumption states
							if (stateDetails.consumption) {
								switch (stateDetails.headCategory) {

									case 'consumed':
										if (beforeReset.day !== actualDate.day) {
											await this.setPreviousValues(`${stateID}.currentYear.consumed.01_currentDay`, `${stateID}.currentYear.consumed.01_previousDay`);
										}

										if (beforeReset.week !== actualDate.week) {
											await this.setPreviousValues(`${stateID}.currentYear.consumed.02_currentWeek`,`${stateID}.currentYear.consumed.02_previousWeek`);
										}

										if (beforeReset.month !== actualDate.month) {
											await this.setPreviousValues(`${stateID}.currentYear.consumed.03_currentMonth`, `${stateID}.currentYear.consumed.03_previousMonth`);
										}

										if (beforeReset.quarter !== actualDate.quarter) {
											await this.setPreviousValues(`${stateID}.currentYear.consumed.04_currentQuarter`, `${stateID}.currentYear.consumed.04_previousQuarter`);
										}

										if (beforeReset.year !== actualDate.year) {
											await this.setPreviousValues(`${stateID}.currentYear.consumed.05_currentYear`, `${stateID}.currentYear.consumed.05_previousYear`);
										}

										break;

									case 'delivered':
										if (beforeReset.day !== actualDate.day) {
											await this.setPreviousValues(`${stateID}.currentYear.delivered.01_currentDay`, `${stateID}.currentYear.delivered.01_previousDay`);
										}

										if (beforeReset.week !== actualDate.week) {
											await this.setPreviousValues(`${stateID}.currentYear.delivered.02_currentWeek`, `${stateID}.currentYear.delivered.02_previousWeek`);
										}

										if (beforeReset.month !== actualDate.month) {
											await this.setPreviousValues(`${stateID}.currentYear.delivered.03_currentMonth`, `${stateID}.currentYear.delivered.03_previousMonth`);
										}

										if (beforeReset.quarter !== actualDate.quarter) {
											await this.setPreviousValues(`${stateID}.currentYear.delivered.04_currentQuarter`, `${stateID}.currentYear.delivered.04_previousQuarter`);
										}

										if (beforeReset.year !== actualDate.year) {
											await this.setPreviousValues(`${stateID}.currentYear.delivered.05_currentYear`, `${stateID}.currentYear.delivered.05_previousYear`);
										}
										break;

									default:

								}

							}

							// Handle financial states consumption states
							switch (stateDetails.financialCategory) {

								case 'costs':
									if (beforeReset.day !== actualDate.day) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.01_currentDay`, `${stateID}.currentYear.costs.01_previousDay`);
									}

									if (beforeReset.week !== actualDate.week) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.02_currentWeek`, `${stateID}.currentYear.costs.02_previousWeek`);
									}

									if (beforeReset.month !== actualDate.month) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.03_currentMonth`, `${stateID}.currentYear.costs.03_previousMonth`);
									}

									if (beforeReset.quarter !== actualDate.quarter) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.04_currentQuarter`, `${stateID}.currentYear.costs.04_previousQuarter`);
									}

									if (beforeReset.year !== actualDate.year) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.05_currentYear`, `${stateID}.currentYear.costs.05_previousYear`);
									}
									break;

								case 'earnings':
									if (beforeReset.day !== actualDate.day) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.01_currentDay`, `${stateID}.currentYear.costs.01_previousDay`);
									}

									if (beforeReset.week !== actualDate.week) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.02_currentWeek`, `${stateID}.currentYear.earnings.02_previousWeek`);
									}

									if (beforeReset.month !== actualDate.month) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.03_currentMonth`, `${stateID}.currentYear.earnings.03_previousMonth`);
									}

									if (beforeReset.quarter !== actualDate.quarter) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.04_currentQuarter`, `${stateID}.currentYear.earnings.04_previousQuarter`);
									}

									if (beforeReset.year !== actualDate.year) {
										await this.setPreviousValues(`${stateID}.currentYear.costs.05_currentYear`, `${stateID}.currentYear.earnings.05_previousYear`);
									}
									break;

								default:

							}

							//ToDo: Think / discuss what to do with meter readings
							// Handle meter reading states
							// if (this.config.currentYearPrevious) await this.setStateAsync(`${stateID}.currentYear.meterReadings.previousWeek.${weekdays[x]}`, {
							// 	val: await this.getStateAsync(`${stateID}.currentYear.meterReadings.previousWeek.${weekdays[x]}`),
							// 	ack: true
							// })

						}

						await this.extendForeignObject(stateID, obj);
						this.log.info(`Memory values for ${stateID} after reset : ${JSON.stringify(this.activeStates[stateID])}`);
						const value = await this.getForeignStateAsync(stateID)
						this.calculationHandler(stateID, value);

					} catch (error) {
						this.log.error(`[reset values error for ${stateID}: ${error.message}, stack: ${error.stack}`);
						// Send code failure to sentry
						this.errorHandling(`[resetStartValues] for ${stateID}`, error);
					}


				}

				// Enable all calculations with timeout of 500 ms
				if (delay) { clearTimeout(delay); delay = null; }
				delay = setTimeout(function () {
					calcBlock = false;
				}, 500);

			});

			resetDay.start();

		} catch (error) {
			this.log.error(`[reset values error: ${error.message}, stack: ${error.stack}`);
			// Send code failure to sentry
			this.errorHandling(`[resetStartValues]`, error);
			calcBlock = false; // Continue all calculations
		}

	}

	/**
	 * Function to handle previousState values
	 * @param {string} [currentState]- RAW state ID currentValue
	 * @param {string} previousState - RAW state ID currentValue
	 */
	async setPreviousValues(currentState, previousState) {
		// Only set previous state if option is chosen
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
					})
				}
			} else {
				this.log.debug(``)
			}
		}
	}

	/**
	 * Function to handle state creation
     * @param {string} [stateID]- RAW state ID of monitored state
     * @param {string} stateRoot - Root folder location
     * @param {string} name - Name of state (also used for state ID !
     * @param {boolean} [atDeviceRoot=FALSE] - store value at root instead of Year-Folder
     * @param {boolean} [deleteState=FALSE] - Set to true will delete the state
	 * @param {boolean} [isCurrent=FALSE] - Store value in current Year
     */
	async doLocalStateCreate(stateID, stateRoot, name, atDeviceRoot, deleteState, isCurrent) {
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
				unit: stateDetails.useUnit,
				def: 0,
			};

			// Define if state should be created at root level
			if (atDeviceRoot) {

				stateName = `${stateDetails.deviceName}.${stateRoot}`;
				this.log.debug(`Try creating states ${stateName} Data : ${JSON.stringify(commonData)}`);
				await this.localSetObject(stateName, commonData);

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

					commonData.unit = '€'; // Switch Unit to money

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
			this.log.error(`[localStateCreate ${stateID}] error: ${error.message}, stack: ${error.stack}`);
			// Send code failure to sentry
			this.errorHandling(`[localStateCreate] for ${stateID}`, error);
		}
	}

	// Set object routine to simplify code
	//TODO: Check with JS-Controller 3.x if check is still required
	async localSetObject(stateName, commonData) {
		this.validStates[stateName] = commonData;
		await this.setObjectNotExistsAsync(stateName, {
			type: 'state',
			common: commonData,
			native: {},
		});
		// Ensure name and unit changes are propagated
		await this.extendObjectAsync(stateName, {
			type: 'state',
			common: {
				name: commonData.name,
				unit: commonData.unit,
			},
			native: {},
		});
	}

	async localDeleteState(state) {
		try {
			if (stateDeletion) {
				const obj = await this.getObjectAsync(state);
				if (obj) {
					await this.delObjectAsync(state);
				}
			}
		} catch (error) {
			// do nothing
		}
	}

	// Calculation handler
	async calculationHandler(stateID, value) {
		try {
			const calcValues = this.activeStates[stateID].calcValues;
			const stateDetails = this.activeStates[stateID].stateDetails;
			const statePrices = this.activeStates[stateID].prices;
			const currentCath =  this.unitPriceDef.unitConfig[stateDetails.stateUnit].category;
			const targetCath = this.unitPriceDef.unitConfig[stateDetails.useUnit].category;
			const date = new Date();

			this.log.debug(`Calculation for ${stateID} with values : ${JSON.stringify(value)} and configuration : ${JSON.stringify(this.activeStates[stateID])}`);
			console.log(`Calculation for ${stateID} with value : ${JSON.stringify(value)}`);
			let stateName = `${this.namespace}.${stateDetails.deviceName}`;

			// Define proper calculation value
			let reading;

			// Convert volume liter to cubic
			//TODO: Should  be handle  by library
			if (currentCath === 'Watt'){
				// Convert watt to watt hours
				reading = await this.wattToWattHour(stateID, value);
			} else if (currentCath === 'Liter' && targetCath === 'Cubic_meter'
			) {
				reading = value.val / 1000;
			} else if (currentCath === 'Cubic_meter' && targetCath === 'Liter'
			) {
				reading = value.val * 1000;
			} else {
				reading = value.val
			}

			const currentExponent = this.unitPriceDef.unitConfig[stateDetails.stateUnit].exponent;
			const targetExponent = this.unitPriceDef.unitConfig[stateDetails.useUnit].exponent;

			if (reading && typeof(reading) === 'number') {
				reading = reading * Math.pow(10, (currentExponent - targetExponent));
				if (currentCath === 'Watt'){
					// Add calculated watt reading to stored totals
					reading = reading + calcValues.currentValue;
				}
			} else {

				reading = value.val * Math.pow(10, (currentExponent - targetExponent));
			}


			this.log.debug(`Recalculated value ${reading}`);
			if (reading === null || reading === undefined) return;

			// Detect meter reset & ensure Cumulative calculation
			if (reading < calcValues.currentValue && currentCath !== 'Watt') {
				this.log.debug(`New reading ${reading} lower than stored value ${calcValues.currentValue}`);

				// Threshold of 1 to detect reset of meter
				if (reading < 1 && !deviceResetHandled[stateID]) {
					this.log.warn(`Device reset detected for ${stateID} store current value ${calcValues.currentValue} to value of reset`);
					deviceResetHandled[stateID] = true;

					// Prepare object array for extension
					const obj = {};
					obj.common = {};
					obj.common.custom = {};
					obj.common.custom[this.namespace] = {};

					// Extend valueAtDeviceReset with currentValue at object and memory
					obj.common.custom[this.namespace].valueAtDeviceReset = calcValues.currentValue;
					this.activeStates[stateID].calcValues.valueAtDeviceReset = calcValues.currentValue;
					//TODO: Add all attributes to extend object ensuring propper obj values
					await this.extendForeignObject(stateID, obj);

					// Calculate proper reading
					reading = reading + this.activeStates[stateID].calcValues.valueAtDeviceReset;
				} else {
					this.log.debug(`Adding ${reading} to stored value ${this.activeStates[stateID].calcValues.valueAtDeviceReset}`);

					// Add current reading to value in memory
					reading = reading + this.activeStates[stateID].calcValues.valueAtDeviceReset;
					this.log.debug(`Calculation outcome ${reading} valueAtDeviceReset ${this.activeStates[stateID].calcValues.valueAtDeviceReset}`);
					// Reset device reset variable
					if (reading > 1) deviceResetHandled[stateID] = false;

				}
			} else {
				this.log.debug(`New reading ${reading} bigger than stored value ${calcValues.currentValue} processing normally`);
			}

			this.log.debug(`Set calculated value ${reading} on state : ${stateDetails.deviceName}.Current_Reading}`);
			// Update current value to memory
			this.activeStates[stateID]['calcValues'].currentValue = reading;
			this.log.debug(`ActiveStatesArray ${JSON.stringify(this.activeStates[stateID]['calcValues'])})`)
			await this.setStateChangedAsync(`${stateDetails.deviceName}.Current_Reading`, { val: await this.roundDigits(reading), ack: true });

			//TODO; implement counters
			// 	// Handle impuls counters
			// 	if (obj_cust.state_type == 'impulse'){

			// 		// cancel calculation in case of impuls counter
			// 		return;

			// 	}

			//TODO: Implement periods
			// temporary set to Zero, this value will be used later to handle period calculations
			const reading_start = 0; //obj_cust.start_meassure;

			this.log.debug(`previousCalculationRounded for ${stateID} : ${JSON.stringify(previousCalculationRounded)}`);

			// Store meter values
			if (stateDetails.meter_values === true) {
				// Always write generic meterReadings for current year
				stateName = `${this.namespace}.${stateDetails.deviceName}.currentYear.meterReadings`;
				const readingRounded = await this.roundDigits(reading);

				// Weekdays
				if (readingRounded){
				await this.setStateChangedAsync(`${stateName}.currentWeek.${weekdays[date.getDay()]}`, { val: readingRounded, ack: true });
				stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${actualDate.year}.meterReadings`;
				if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, { val: readingRounded, ack: true });
				// Month
				if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, { val: readingRounded, ack: true });
				// Quarter
				if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.Q${actualDate.quarter}`, { val: readingRounded, ack: true });
				}
			}

				const calculations = {
					consumedDay: ((reading - calcValues.start_day) - reading_start),
					consumedWeek: ((reading - calcValues.start_week) - reading_start),
					consumedMonth: ((reading - calcValues.start_month) - reading_start),
					consumedQuarter: ((reading - calcValues.start_quarter) - reading_start),
					consumedYear: ((reading - calcValues.start_year) - reading_start),
					priceDay: statePrices.unitPrice * ((reading - calcValues.start_day) - reading_start),
					priceWeek: statePrices.unitPrice * ((reading - calcValues.start_week) - reading_start),
					priceMonth: statePrices.unitPrice * ((reading - calcValues.start_month) - reading_start),
					priceQuarter: statePrices.unitPrice * ((reading - calcValues.start_quarter) - reading_start),
					priceYear: statePrices.unitPrice * ((reading - calcValues.start_year) - reading_start),
				};


			const calculationRounded = {
				consumedDay: await this.roundDigits(calculations.consumedDay),
				consumedWeek: await this.roundDigits(calculations.consumedWeek),
				consumedMonth: await this.roundDigits(calculations.consumedMonth),
				consumedQuarter: await this.roundDigits(calculations.consumedQuarter),
				consumedYear: await this.roundDigits(calculations.consumedYear),
				priceDay: await this.roundCosts(statePrices.unitPrice * calculations.consumedDay),
				priceWeek: await this.roundCosts(statePrices.unitPrice * calculations.consumedWeek),
				priceMonth: await this.roundCosts(statePrices.unitPrice * calculations.consumedMonth),
				priceQuarter: await this.roundCosts(statePrices.unitPrice * calculations.consumedQuarter),
				priceYear: await this.roundCosts(statePrices.unitPrice * calculations.consumedYear),
			};

			// Store consumption
			if (stateDetails.consumption) {
				// Always write generic meterReadings for current year
				stateName = `${this.namespace}.${stateDetails.deviceName}.currentYear.${stateDetails.headCategory}`;
				// Generic
				await this.setStateChangedAsync(`${stateName}.01_currentDay`, { val: calculationRounded.consumedDay, ack: true });
				await this.setStateChangedAsync(`${stateName}.02_currentWeek`, { val: calculationRounded.consumedWeek, ack: true });
				await this.setStateChangedAsync(`${stateName}.03_currentMonth`, { val: calculationRounded.consumedMonth, ack: true });
				await this.setStateChangedAsync(`${stateName}.04_currentQuarter`, { val: calculationRounded.consumedQuarter, ack: true });
				await this.setStateChangedAsync(`${stateName}.05_currentYear`, { val: calculationRounded.consumedYear, ack: true });

				// Weekdays
				await this.setStateChangedAsync(`${stateName}.currentWeek.${weekdays[date.getDay()]}`, { val: calculationRounded.consumedDay, ack: true });


				stateName = `${this.namespace}.${stateDetails.deviceName}.${actualDate.year}.${stateDetails.headCategory}`;
				// Week
				if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, { val: calculationRounded.consumedWeek, ack: true });
				// Month
				if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, { val: calculationRounded.consumedMonth, ack: true });
				// Quarter
				if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.${actualDate.quarter}`, { val: calculationRounded.consumedQuarter, ack: true });

			}

			// Store prices
			if (stateDetails.costs) {

				stateName = `${this.namespace}.${stateDetails.deviceName}.currentYear.${stateDetails.financialCategory}`;
				// Generic
				await this.setStateChangedAsync(`${stateName}.01_currentDay`, { val: calculationRounded.priceDay, ack: true });
				await this.setStateChangedAsync(`${stateName}.02_currentWeek`, { val: calculationRounded.priceWeek, ack: true });
				await this.setStateChangedAsync(`${stateName}.03_currentMonth`, { val: calculationRounded.priceMonth, ack: true });
				await this.setStateChangedAsync(`${stateName}.04_currentQuarter`, { val: calculationRounded.priceQuarter, ack: true });
				await this.setStateChangedAsync(`${stateName}.05_currentYear`, { val: calculationRounded.priceYear, ack: true });

				// Weekdays
				await this.setStateChangedAsync(`${stateName}.currentWeek.${weekdays[date.getDay()]}`, { val: calculationRounded.priceDay, ack: true });

				stateName = `${this.namespace}.${stateDetails.deviceName}.${actualDate.year}.${stateDetails.financialCategory}`;
				// Week
				if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, { val: calculationRounded.priceWeek, ack: true });
				// Month
				if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, { val: calculationRounded.priceMonth, ack: true });
				// Quarter
				if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.${actualDate.quarter}`, { val: calculationRounded.priceQuarter, ack: true });

			}

			// Store results of current calculation to memory
			//ToDo : Build JSON array for current values to have widget & information easy accessible in vis
			previousCalculationRounded[stateID] = calculationRounded;
			this.log.debug(`Calculation for ${stateID} : ${JSON.stringify(calculations)}`);
			this.log.debug(`CalculationRounded for ${stateID} : ${JSON.stringify(calculationRounded)}`);

			this.log.debug(`Meter Calculation executed consumed data for ${stateID} : ${JSON.stringify(calculationRounded)}`);


		} catch (error) {
			this.log.error(`[calculationHandler ${stateID}] error: ${error.message}, stack: ${error.stack}`);
			this.errorHandling('calculationHandler', error)
		}

	}

	/**
	 * @param {number} [value] - Number to round with , separator
	 */
	async roundDigits(value) {
		let rounded
		try {
			rounded = Number(value);
			rounded = Math.round(rounded * 1000) / 1000;
			this.log.debug(`roundDigits with ${value} rounded ${rounded}`);
			if (!rounded) return value;
			return rounded;
		} catch (error) {
			this.log.error(`[roundDigits ${value}`);
			this.errorHandling('roundDigits', error)
			rounded = value
			return rounded;
		}
	}

	/**
	 * @param {number} [value] - Number to round with . separator
	 */
	async roundCosts(value) {
		try {
			let rounded = Number(value);
			rounded = Math.round(rounded * 100) / 100;
			this.log.debug(`roundCosts with ${value} rounded ${rounded}`);
			if(!rounded) return value;
			return rounded;
		} catch (error) {
			this.log.error(`[roundCosts ${value}`);
			this.errorHandling('roundCosts', error)
		}
	}

	/**
	 * @param {string} [stateID]- ID of state
	 * @param {object} [value] - Current value in wH
	 */
	async wattToWattHour(stateID, value) {
		try {

			const calcValues = this.activeStates[stateID].calcValues;

			this.log.debug(`Watt to kWh for ${stateID} current reading : ${value.val} previousReading : ${JSON.stringify(this.activeStates[stateID])}`);

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
				this.log.debug(`Calc kWh current timing : ${calckWh} adding current value ${readingData.currentValuekWh}`);

				// Update timestamp current reading to memory
				this.activeStates[stateID]['calcValues'].previousReadingWatt = readingData.currentReadingWatt;
				this.activeStates[stateID]['calcValues'].previousReadingWattTs = readingData.currentReadingWattTs;

			} else {

				// Update timestamp current reading to memory
				this.activeStates[stateID]['calcValues'].previousReadingWatt = readingData.currentReadingWatt;
				this.activeStates[stateID]['calcValues'].previousReadingWattTs = readingData.currentReadingWattTs;

				calckWh = calcValues.currentValue;

			}

			this.log.debug(`Watt to kWh outcome for ${stateID} : ${JSON.stringify(this.activeStates[stateID].calcValues)}`);
			return calckWh;
		} catch (error) {
			this.log.error(`[wattToKwh ${stateID}] vale ${value} error: ${error.message}, stack: ${error.stack}`);
			this.errorHandling('wattToWattHour', error)
		}
	}

	/**
	 * @param {string} [stateID]- ID of state
	 * @param {object} [deviceName] - Name of device
	 */
	async getCurrentTotal(stateID, deviceName) {
		let calckWh;

		// Check if previous reading exist in state
		const previousReadingV4 = await this.getStateAsync(`${deviceName}.Current_Reading`);

		// temporary indicate source of kWh value
		let valueSource;

		// Check if previous reading exist in state (routine for <4 version )
		if (!previousReadingV4 || previousReadingV4.val === 0) {
			const previousReadingVold = await this.getStateAsync(`${deviceName}.Meter_Readings.Current_Reading`);
			if (!previousReadingVold || previousReadingVold.val === 0) {
				calckWh = 0;
			} else {
				calckWh = previousReadingVold.val;
				// temporary indicate source of kWh value
				valueSource = 'Version < 4';
				this.log.debug(`for state ${stateID} Previous watt calculated reading used ${valueSource} from ${JSON.stringify(previousReadingVold)}`);
			}
		} else {
			calckWh = previousReadingV4.val; // use previous stored value
			valueSource = 'Version > 4';
			this.log.debug(`for state ${stateID} Previous watt calculated reading used ${valueSource} from ${JSON.stringify(previousReadingV4)}`);
		}
		return calckWh;
	}

	// Daily reset of start values for states
	async refreshDates() {
		const today = new Date(); // Get current date in Unix time format
		// Store current used data memory
		const previousDates = {
			// day: actualDate.day,
			week: actualDate.week,
			month: actualDate.month,
			quarter: actualDate.quarter,
			year: actualDate.year
		};

		// actualDate.Day = weekdays[today.getDay()];
		actualDate.week = await this.getWeekNumber(new Date());
		actualDate.month = months[today.getMonth()];
		actualDate.quarter = Math.floor((today.getMonth() + 3) / 3);
		actualDate.year = (new Date().getFullYear());

		return previousDates;
	}

	/**
	 * @param {string} [codePart]- Message Prefix
	 * @param {object} [error] - Sentry message
	 */
	errorHandling(codePart, error) {
		this.log.error(`[${codePart}] error: ${error.message}, stack: ${error.stack}`);
		if (this.supportsFeature && this.supportsFeature('PLUGINS') && sendSentry) {
			const sentryInstance = this.getPluginInstance('sentry');
			if (sentryInstance) {
				sentryInstance.getSentryObject().captureException(error);
			}
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.log.info(`SourceAnalytix stopped, now you have to calculate by yourself :'( ...`);
			callback();
		} catch (e) {
			callback();
		}
	}

}

//@ts-ignore .parent exists
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Sourceanalytix(options);
} else {
	// otherwise start the instance directly
	new Sourceanalytix();

}
