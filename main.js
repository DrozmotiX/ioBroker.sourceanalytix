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

// Store all days and months
const basicStates = ['01_current_day', '02_current_week', '03_current_month', '04_current_quarter', '05_current_year'];
// const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');

const stateDeletion = true, deviceResetHandled = [], previousCalculationRounded = {};
const sendSentry = true, storeSettings = {}, previousStateVal = {};
let calcBlock = null, delay = null;

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

		// Unit price definitions
		this.unitPriceDef = {
			unitConfig: {},
			pricesConfig: {}
		};
		this.activeStates = {}; // Array of activated states for SourceAnalytix
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		try {

			this.log.info('Welcome to SourceAnalytix, making things ready ... ');

			// Block all calculation functions during startup
			calcBlock = true;

			// Load Unit definitions from helper library to workable memory addresses
			await this.definitionLoader();

			// Store current dates
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
								// delete history[id];
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

			this.log.info(`SourceAnalytix initialisation finalized, will handle calculations ... for : ${JSON.stringify(this.activeStates)}`);

		} catch (error) {
			this.errorHandling('onReady', error);
		}

	}
	//ToDO: Remove adapter is not using messaging
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.message" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === 'object' && obj.message) {
	// 		if (obj.command === 'send') {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info('send command');

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
	// 		}
	// 	}
	// }
	
	async definitionLoader() {

		let catArray = ['Watt', 'Watt_hour'];
		const unitStore = this.unitPriceDef.unitConfig;
		for (const item in catArray) {
			// Load watt definitions
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
			// Load watt definitions
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

		console.log(`All Unit category's ${JSON.stringify(this.unitPriceDef)}`);
	}

	async buildStateDetailsArray(stateID) {
		try {

			const stateInfo = await this.getForeignObjectAsync(stateID);
			if (!stateInfo) {
				this.log.error(`Can't get information for ${stateID}, statechange will be ignored`);
				return;
			}

			// Replace invalid characters for state name
			const newDeviceName = stateID.split('.').join('__');

			// Check if configuration for SourceAnalytix is present
			if (stateInfo && stateInfo.common && stateInfo.common.custom && stateInfo.common.custom[this.namespace]) {
				const customData = stateInfo.common.custom[this.namespace];
				const commonData = stateInfo.common;

				// Load start value from config to memory (avoid wrong calculations at meter reset, set to 0 if empty)
				const valueAtDeviceReset = (customData.valueAtDeviceReset && customData.valueAtDeviceReset !== 0) ? customData.valueAtDeviceReset : 0;

				// Read current total value to memory 
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
				if (!customData.selectedPrice || customData.selectedPrice === '') {
					this.log.error(`No cost type defined for ${stateID}, cannot execute calculations !`);
					return;
				}

				const stateType = this.unitPriceDef.pricesConfig[customData.selectedPrice].costType;

				// Implement check on head category later
				// if (this.unitPriceDef.unitConfig[useUnit].cathegcategoryorie !==
				// 	this.unitPriceDef.unitConfig[this.unitPriceDef.pricesConfig[customData.selectedPrice].unitType].category) {
				// 	this.log.error(`State ${this.unitPriceDef.unitConfig[useUnit].category} unit and chosen price association
				// 	${this.unitPriceDef.unitConfig[this.unitPriceDef.pricesConfig[customData.selectedPrice].unitType].category} not in same range, cannot calculate`);
				// 	return;
				// }

				// Load state settings to memory
				this.activeStates[stateID] = {
					stateDetails: {
						alias: customData.alias.toString(),
						consumption: customData.consumption,
						costs: customData.costs,
						deviceName: newDeviceName.toString(),
						financielCategory: stateType,
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
			this.errorHandling(`[buildStateDetailsArray] for ${stateID}`, error);
		}
	}

	// Create object tree and states for all devices to be handled
	async initialize(stateID) {
		try {

			this.log.debug(`Initialising ${stateID} with configuration ${JSON.stringify(this.activeStates[stateID])}`);

			// Shorten configuration details for easier access
			const stateDetails = this.activeStates[stateID].stateDetails;

			this.log.debug(`Defined calculation attributes for ${stateID} : ${JSON.stringify(this.activeStates[stateID])}`);

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
					await this.doLocalStateCreate(stateID, weekRoot, weekNr, null, true);
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
					await this.doLocalStateCreate(stateID, monthRoot, months[month], null, true);
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
					await this.doLocalStateCreate(stateID, quarterRoot, quarterRoot, null, true);
				}
			}

			// Always create states for meter readings 
			for (const state of basicStates) {

				await this.doLocalStateCreate(stateID, state, state);

			}

			const stateRoot = 'Current_Reading';
			await this.doLocalStateCreate(stateID, stateRoot, 'Current Reading', true);

			// Handle first time calculation
			const value = await this.getForeignStateAsync(stateID);
			this.log.debug(`First time calc result after initialising`);
			if (value) {
				await this.calculationHandler(stateID, value);
			}

			// Subscribe state, every state change will trigger calculation now automatically
			this.subscribeForeignStates(stateID);
			this.log.debug(`Initialization finished for : ${stateID}`);

		} catch (error) {
			this.log.error(`[initialize ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}
	}

	/**
	 * Is called if a subscribed object changes
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
				// if (obj.from === `system.adapter.${this.namespace}`) return; // Ignore object change if cause by Source analytx to prevent overwrite 
				// Verify if custom information is available regaring SourceAnalytix
				if (obj.common.custom && obj.common.custom[this.namespace] && obj.common.custom[this.namespace].enabled) {

					// ignore object changes when caused by SA (memory is handled automatically)
					// if (obj.from !== `system.adapter.${this.namespace}`) {
					this.log.debug(`Object array of SourceAnalytix activated state changed : ${JSON.stringify(obj)} stored config : ${JSON.stringify(this.activeStates)}`);

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

					// } else {
					// 	this.log.debug(`Object change by adapter detected, ignoring`);
					// 	return;
					// }

					//TODO: Check duplicate code on object changes ?
					// Verify if the object was already activated, if not initialize new device
					// if (!this.activeStates[stateID]) {
					// 	this.log.info(`Enable SourceAnalytix for : ${stateID}`);
					// 	await this.buildStateDetailsArray(id);
					// 	this.log.debug(`Active state array after enabling ${stateID} : ${JSON.stringify(this.activeStates)}`);
					// 	await this.initialize(stateID);
					// } else {
					// 	this.log.info(`Updated SourceAnalytix configuration for : ${stateID}`);
					// 	await this.buildStateDetailsArray(id);
					// 	this.log.debug(`Active state array after updating configuraiton of ${stateID} : ${JSON.stringify(this.activeStates)}`);
					// 	await this.initialize(stateID);
					// }

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
			this.log.error(`[obObjectChange ${JSON.stringify(obj)}] error: ${error.message}, stack: ${error.stack}`);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (calcBlock) return; // cancel operation if calculation block is activate
		try {
			if (state) {
				// The state was changed
				this.log.debug(`state ${id} changed : ${JSON.stringify(state)} SourceAnalytix calculation executed`);

				// Implement x ignore time (configurable) to avoid overload of unneeded calculations
				// Avoid uneeded calculation run
				if (previousStateVal[id] !== state.val) {
					this.calculationHandler(id, state);
					previousStateVal[id] = state.val;

				} else {
					this.log.debug(`Update osf state ${id} received with equal value ${state.val} ignoring`);
				}

			}
		} catch (error) {
			this.log.error(`[onStateChane ${id}] error: ${error.message}, stack: ${error.stack}`);
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
			// TODO: Temporary disabled daily reset for debugging purpose, for now run every minute
			const resetDay = new schedule('0 0 * * *', async () => {
			// const resetDay = new schedule('* * * * *', async () => { //  testing schedule
				calcBlock = true; // Pause all calculations
				const beforeReset = await this.refreshDates(); // Reset date values in memory

				// Read state array and write Data for every active state

				for (const stateID in this.activeStates) {
					// console.log(this.activeStates.length());
					this.log.info(`Executing reset for : ${stateID}`)
					console.log(stateID);

					const stateValues = this.activeStates[stateID].calcValues;

					// get current meter value
					const reading = this.activeStates[stateID].calcValues.currentValue;
					//TODO: Possible cause of NULL value, if NULL in calcvalues functioin continues instead of value write
					if (reading === null || reading === undefined) continue;

					this.log.info(`Memory values for ${stateID} before reset : ${JSON.stringify(this.activeStates[stateID])}`);
					this.log.info(`Current known state values : ${JSON.stringify(stateValues)}`)

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

					await this.extendForeignObject(stateID, obj);
					this.log.info(`Memory values for ${stateID} after reset : ${JSON.stringify(this.activeStates[stateID])}`);
					const value = await this.getForeignStateAsync(stateID)
					this.calculationHandler(stateID, value);
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
			calcBlock = false; // Pause all calculations
		}
	}

	//TODO: Old code to be removed ?
	// Function to handle channel creation
	// async ChannelCreate(id, channel, name) {
	// 	this.log.debug('Parent device : ' + id);
	// 	this.log.debug('Create channel id : ' + channel);
	// 	this.log.debug('Create channel name : ' + name);
	//
	// 	await this.createChannelAsync(id, channel, {
	// 		name: name
	// 	});
	// }

	// Function to handle state creation
	async doLocalStateCreate(stateID, stateRoot, name, atDeviceRoot, deleteState) {
		try {
			const stateDetails = this.activeStates[stateID].stateDetails;
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
							await this.localSetObject(`${stateDetails.deviceName}.${actualDate.year}.consumed.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.delivered.${stateRoot}`);
							break;

						case 'delivered':
							await this.localSetObject(`${stateDetails.deviceName}.${actualDate.year}.delivered.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.consumed.${stateRoot}`);
							break;

						default:

					}

				} else if (deleteState || !stateDetails.consumption) {

					// If state deletion choosen, clean everyting up else define statename
					await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.consumed.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${actualDate.year}.consumed.${stateRoot}`);
					await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.delivered.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${actualDate.year}.delivered.${stateRoot}`);

				}

				// Create MeterReading states
				if (!deleteState && stateDetails.meter_values) {

					// Do not create StateRoot values
					if (!basicStates.includes(stateRoot)) {
						await this.localSetObject(`${stateDetails.deviceName}.${actualDate.year}.meterReadings.${stateRoot}`, commonData);
					}

				} else if (deleteState || !stateDetails.meter_values) {

					// If state deletion choosen, clean everyting up else define statename
					await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.meterReadings.${stateRoot}`);

				}

				// Create cost states
				if (!deleteState && stateDetails.costs) {

					commonData.unit = '€'; // Switch Unit to money

					switch (stateDetails.financielCategory) {

						case 'costs':
							// await this.ChannelCreate(device, head_category, head_category);
							await this.localSetObject(`${stateDetails.deviceName}.${actualDate.year}.costs.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.earnings.${stateRoot}`);
							break;

						case 'earnings':
							// await this.ChannelCreate(device, head_category, head_category);
							await this.localSetObject(`${stateDetails.deviceName}.${actualDate.year}.earnings.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.costs.${stateRoot}`);
							break;

						default:

					}

				} else if (!stateDetails.costs) {

					// If state deletion choosen, clean everyting up else define statename
					await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.costs.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${actualDate.year}.costs.${stateRoot}`);
					await this.localDeleteState(`${stateDetails.deviceName}.${actualDate.year}.earnings.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${actualDate.year}.earnings.${stateRoot}`);
				}
			}

		} catch (error) {
			this.log.error(`[localStateCreate ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}
	}

	// Set object routine to simplify code
	async localSetObject(stateName, commonData) {
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
			
			this.log.debug(`Calculation for ${stateID} with values : ${JSON.stringify(value)} and configuration : ${JSON.stringify(this.activeStates[stateID])}`);
			console.log(`Calculation for ${stateID} with value : ${JSON.stringify(value)}`);
			let stateName = `${this.namespace}.${stateDetails.deviceName}`;

			// Define proper calculation value
			let reading = null;

			// Convert watt to watt hours
			if (currentCath === 'Watt'){
				reading = await this.wattToWattHour(stateID, value);
			}

			// Convert volume liter to cubics
			//TODO: Should  be handle  by library
			if (currentCath === 'Liter' && targetCath === 'Cubic_meter' 
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
					//TODO: Still  needed?
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
			// 	if (obj_cust.state_type == 'impuls'){

			// 		// cancel calculation in case of impuls counter
			// 		return;

			// 	}

			//TODO: Implement periods
			// temporary set to sero, this value will be used later to handle period calculations
			const reading_start = 0; //obj_cust.start_meassure;

			this.log.debug(`previousCalculationRounded for ${stateID} : ${JSON.stringify(previousCalculationRounded)}`);

			// Store meter values
			if (stateDetails.meter_values === true) {
				// Always write generic meterReadings for current year
				stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${actualDate.year}.meterReadings`;
				const readingRounded = await this.roundDigits(reading);
				// Week
				// await this.setStateChangedAsync(`${stateName}.this_week.${actualDate.Day}`, { val: calculationRounded.consumedDay, ack: true });
				if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, { val: readingRounded, ack: true });
				// Month
				if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, { val: readingRounded, ack: true });
				// Quarter
				if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.Q${actualDate.quarter}`, { val: readingRounded, ack: true });

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
				stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${actualDate.year}.${stateDetails.headCategory}`;
				// Generic
				await this.setStateChangedAsync(`${stateName}.01_current_day`, { val: calculationRounded.consumedDay, ack: true });
				await this.setStateChangedAsync(`${stateName}.02_current_week`, { val: calculationRounded.consumedWeek, ack: true });
				await this.setStateChangedAsync(`${stateName}.03_current_month`, { val: calculationRounded.consumedMonth, ack: true });
				await this.setStateChangedAsync(`${stateName}.04_current_quarter`, { val: calculationRounded.consumedQuarter, ack: true });
				await this.setStateChangedAsync(`${stateName}.05_current_year`, { val: calculationRounded.consumedYear, ack: true });

				// Week
				// await this.setStateChangedAsync(`${stateName}.this_week.${currentDay}`, { val: calculationRounded.consumedDay, ack: true });
				if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, { val: calculationRounded.consumedWeek, ack: true });
				// Month
				if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, { val: calculationRounded.consumedMonth, ack: true });
				// Quarter
				if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.quarters.Q${actualDate.quarter}`, { val: calculationRounded.consumedQuarter, ack: true });
			}

			// Store prices
			if (stateDetails.costs) {

				stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${actualDate.year}.${stateDetails.financielCategory}`;
				// Generic
				await this.setStateChangedAsync(`${stateName}.01_current_day`, { val: calculationRounded.priceDay, ack: true });
				await this.setStateChangedAsync(`${stateName}.02_current_week`, { val: calculationRounded.priceWeek, ack: true });
				await this.setStateChangedAsync(`${stateName}.03_current_month`, { val: calculationRounded.priceMonth, ack: true });
				await this.setStateChangedAsync(`${stateName}.04_current_quarter`, { val: calculationRounded.priceQuarter, ack: true });
				await this.setStateChangedAsync(`${stateName}.05_current_year`, { val: calculationRounded.priceYear, ack: true });

				// Week
				// await this.setStateChangedAsync(`${stateName}.this_week.${currentDay}`, { val: calculationRounded.priceDay, ack: true });
				if (storeSettings.storeWeeks) await this.setStateChangedAsync(`${stateName}.weeks.${actualDate.week}`, { val: calculationRounded.priceWeek, ack: true });
				// Month
				if (storeSettings.storeMonths) await this.setStateChangedAsync(`${stateName}.months.${actualDate.month}`, { val: calculationRounded.priceMonth, ack: true });
				// Quarter
				if (storeSettings.storeQuarters) await this.setStateChangedAsync(`${stateName}.quarters.Q${actualDate.quarter}`, { val: calculationRounded.priceQuarter, ack: true });

			}

			// Store results of current calculation to memory
			previousCalculationRounded[stateID] = calculationRounded;
			this.log.debug(`Calculation for ${stateID} : ${JSON.stringify(calculations)}`);
			this.log.debug(`CalculationRounded for ${stateID} : ${JSON.stringify(calculationRounded)}`);

			this.log.debug(`Meter Calculation executed consumed data for ${stateID} : ${JSON.stringify(calculationRounded)}`);

		} catch (error) {
			this.log.error(`[calculationHandler ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}

	}

	async roundDigits(value) {
		try {
			let rounded = Number(value);
			rounded = Math.round(rounded * 1000) / 1000;
			this.log.debug(`roundDigits with ${value} rounded ${rounded}`);
			if (!rounded) return value;
			return rounded;
		} catch (error) {
			this.log.error(`[roundDigits ${value}`);
		}
	}

	async roundCosts(value) {
		try {
			let rounded = Number(value);
			rounded = Math.round(rounded * 100) / 100;
			this.log.debug(`roundCosts with ${value} rounded ${rounded}`);
			if(!rounded) return value;
			return rounded;
		} catch (error) {
			this.log.error(`[roundCosts ${value}`);
		}
	}

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
			this.log.error(`[wattToKwh ${stateID}] vaule ${value} error: ${error.message}, stack: ${error.stack}`);
		}
	}

	// Read current calculated totals, needed to ensure Cumulative calculations
	async getCurrentTotal(stateID, deviceName) {
		let calckWh = null;

		// Check if previous reading exist in state
		const previousReadingV4 = await this.getStateAsync(`${deviceName}.Current_Reading`);

		// temporary indicate source of kWh value
		let valueSource = null;

		// Check if previous reading exist in state (routine for <4 version )
		if (!previousReadingV4 || previousReadingV4.val === 0) {
			const previousReadingVold = await this.getStateAsync(`${deviceName}.Meter_Readings.Current_Reading`);
			if (!previousReadingVold || previousReadingVold.val === 0) {
				calckWh = 0;
			} else {
				calckWh = previousReadingVold.val;
				// temporary indicate source of kWh value
				valueSource = 'Version < 4';
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
