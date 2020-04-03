'use strict';

/*
 * Created with @iobroker/create-adapter v1.11.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const adapterName = require('./package.json').name.split('.').pop();

// Lets make sure we know all days and months
const basicValues = ['01_current_day', '02_current_week', '03_current_month', '04_current_quarter', '05_current_year'];
const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');

const stateDeletion = true, deviceResetHandled = [];
let calcBlock = null;

// Create variables for object arrays
const history = {}, aliasMap = {};
let currentYear = null, currentQuarter = null, currentMonth = null, currentWeek = null, currentDay = null;
// Load Time Modules
const schedule = require('node-schedule'); // New Cron Scheduler

class Sourceanalytix extends utils.Adapter {
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		// @ts-ignore
		super({
			...options,
			name: adapterName,
		});

		this.on('ready', this.onReady.bind(this));
		this.on('objectChange', this.onObjectChange.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		this.activeStates = {}; // Array of activated states for SourceAnalytix
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		try {
			// Initialize your adapter here
			this.log.info('Welcome to SourceAnalytix, making things ready ... ');
			await this.resetDates();

			// Subscribe on all foreign states to ensure changes in objects are reflected
			this.subscribeForeignObjects('*');

			// initialize all SourceAnalytix enabled states
			this.log.info('Initializing enabled states for SourceAnalytix');

			// get all objects with custom configuraiton items
			// @ts-ignore : getObjectViewAsync missing in definiton
			const customStateArray = await this.getObjectViewAsync('custom', 'state', {});
			this.log.debug(`All states with custom items : ${JSON.stringify(customStateArray)}`);

			// Get all active state for Sou
			if (customStateArray && customStateArray.rows) {

				for (let i = 0, l = customStateArray.rows.length; i < l; i++) {
					if (customStateArray.rows[i].value) {
						let id = customStateArray.rows[i].id;

						// temporary disable, should consider to have alias also in SourceAnalytix in case meters are changed
						// const realId = id;
						if (customStateArray.rows[i].value[this.namespace] && customStateArray.rows[i].value[this.namespace].aliasId) {
							aliasMap[id] = customStateArray.rows[i].value[this.namespace].aliasId;
							this.log.debug('Found Alias: ' + id + ' --> ' + aliasMap[id]);
							id = aliasMap[id];
						}
						history[id] = customStateArray.rows[i].value;

						if (history[id].enabled !== undefined) {
							history[id] = history[id].enabled ? { 'history.0': history[id] } : null;
							if (!history[id]) {
								this.log.warn('undefined id');
								// delete history[id];
								continue;
							}
						}

						// If enabled for SourceAnalytix, handle routine to store relevant date to memory
						if (!history[id][this.namespace] || history[id][this.namespace].enabled === false) {
							// Not SourceAnalytix relevant ignore
						} else {
							await this.buildStateDetailsArray(id);
						}
					}
				}
			}

			// // Handle initialisation for all discovered states
			let count = 1;
			for (const stateID in this.activeStates) {
				this.log.info(`Initialising (${count} of ${Object.keys(this.activeStates).length}) state ${stateID}`);
				await this.initialize(stateID);
				count = count + 1;
			}

			this.resetShedules();

			this.log.debug(`Active state array after initialisation : ${JSON.stringify(this.activeStates)}`);
			this.log.info(`SourceAnalytix initialisation finalized, will handle calculations ...`);
		} catch (error) {
			this.log.error(`[onReady] error: ${error.message}, stack: ${error.stack}`);
		}
	}

	async buildStateDetailsArray(stateID) {
		const stateInfo = await this.getForeignObjectAsync(stateID);
		const newDeviceName = stateID.split('.').join('__');

		this.log.silly(`[buildStateDetailsArray] with current value ${stateID} state data : ${JSON.stringify(stateInfo)}`);

		if (stateInfo && stateInfo.common && stateInfo.common.custom) {
			const customData = stateInfo.common.custom[this.namespace];
			const valueAtDeviceReset = (customData.valueAtDeviceReset && customData.valueAtDeviceReset !== 0) ? customData.valueAtDeviceReset : 0;
			/** @type {number} */
			let currentValuekWh = await this.getCurrentTotal(stateID, newDeviceName);
			currentValuekWh = currentValuekWh ? currentValuekWh : 0;
			const stateType = customData.state_type;

			// Load state settings to memory
			// To-Do added error handling in case values ar empty
			this.activeStates[stateID] = {
				stateDetails: {
					alias: customData.alias,
					consumption: customData.consumption,
					costs: customData.costs,
					deviceName: newDeviceName,
					financielCathegorie: stateType === 'kWh_delivery' ? 'earnings' : 'costs',
					headCathegorie: stateType === 'kWh_delivery' ? 'delivered' : 'consumed',
					meter_values: customData.meter_values,
					name: stateInfo.common.name,
					state_type: customData.state_type,
					state_unit: customData.state_unit,
					unit: stateInfo.common.unit
				},
				calcValues: {
					currentValuekWh: currentValuekWh,
					start_day: customData.start_day,
					start_month: customData.start_month,
					start_quarter: customData.start_quarter,
					start_week: customData.start_week,
					start_year: customData.start_year,
					valueAtDeviceReset: valueAtDeviceReset,
				},
				prices: {},
			};
			if (stateInfo.common.unit === 'w') {
				this.activeStates[stateID].calcValues.previousReadingWatt = null;
				this.activeStates[stateID].calcValues.previousReadingWattTs = null;
			}
			this.log.silly(`[buildStateDetailsArray] of ${stateID}: with content ${JSON.stringify(this.activeStates[stateID])}`);
		}
	}

	// Create object tree and states for all devices to be handled
	async initialize(stateID) {
		try {

			this.log.silly(`Initialising ${stateID} with configuration ${JSON.stringify(this.activeStates[stateID])}`);

			// ************************************************
			// ****************** Code Break ******************
			// ************************************************

			// Define propper calculation values based on system configuration
			const prices = await this.priceDeclaration(stateID);
			// Skip initialisation if values are null
			if (!prices || !prices.basicPrice || !prices.unitPrice) return;
			this.activeStates[stateID].prices.basicPrice = prices.basicPrice;
			this.activeStates[stateID].prices.unitPrice = prices.unitPrice;

			// Define propper unite cancel initialisation if no unit defined
			this.activeStates[stateID].useUnit = await this.defineUnit(stateID);
			this.log.debug(`useUnit defined ${this.activeStates[stateID].useUnit}`);
			if (!this.activeStates[stateID].useUnit || this.activeStates[stateID].useUnit === '') return;
			// ************************************************
			// ****************** Code Break ******************
			// ************************************************

			// Shorten configuraiton details for easier access
			const stateDetails = this.activeStates[stateID].stateDetails;

			this.log.silly(`Defined calculation attributes for ${stateID} : ${JSON.stringify(this.activeStates[stateID])}`);

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
					weekNr = y;
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
			for (const state of basicValues) {
				const stateRoot = state;
				await this.doLocalStateCreate(stateID, stateRoot, state);

			}

			const stateRoot = 'Current_Reading';
			await this.doLocalStateCreate(stateID, stateRoot, 'Current Reading', true);

			this.log.silly(`Initialization finished for : ${stateID}`);

			// Handle first time calculation
			const value = await this.getForeignStateAsync(stateID);
			if (value) {
				await this.calculationHandler(stateID, value.val);
			}

			// Subscribe state, every state change will trigger calculation now automatically
			this.subscribeForeignStates(stateID);

		} catch (error) {
			this.log.error(`[initialize ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}
	}

	// Define propper unit notation 
	async defineUnit(stateID) {
		try {
			const stateDetails = this.activeStates[stateID].stateDetails;
			let unit = null;

			// Check if unit is defined in state object, if not use custom value
			if (stateDetails.unit && stateDetails.state_unit === 'automatically') {
				unit = stateDetails.unit.toLowerCase().replace(/\s|\W|[#$%^&*()]/g, '');
			} else if (stateDetails.state_unit && stateDetails.state_unit !== 'automatically') {
				// Replace meassurement unit when selected in state setting
				unit = stateDetails.state_unit.toLowerCase();
				this.log.debug(`Unit manually assignd : ${unit}`);
			} else {
				this.log.error('Identifying unit failed, please ensure state has a propper unit assigned or the unit is manually choosen in state settings !');
			}

			switch (unit) {

				case 'kwh':
					unit = 'kWh';
					break;

				case 'l':
					unit = 'm3';
					break;

				case 'm³':
					unit = 'm3';
					break;

				case 'm3':
					break;

				case 'w':
					unit = 'kWh';
					break;

				case 'wh':
					unit = 'kWh';
					break;

				default:

					this.log.error(`Sorry unite type ${stateDetails.unit} not supported (yet), ${stateID} will be ignored from calculations!`);

			}
			return unit;
		} catch (error) {
			this.log.error(`[Define unir ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}
	}

	/**
	 * Is called if a subscribed object changes
	 * @param {string} id
	 * @param {ioBroker.Object | null | undefined} obj
	 */
	async onObjectChange(id, obj) {
		const stateID = id;

		this.log.debug(`Object array of all activated states : ${JSON.stringify(this.activeStates)}`);
		this.log.debug(`Object array of onObjectChange trigger : ${JSON.stringify(obj)}`);

		// Check if object is activated for SourceAnalytix
		if (obj && obj.common) {

			// @ts-ignore : from does exist on states	
			// if (obj.from === `system.adapter.${this.namespace}`) return; // Ignore object change if cause by Source analytx to prevent overwrite 
			// Verify if custom information is available regaring SourceAnalytix
			if (obj.common.custom && obj.common.custom[this.namespace] && obj.common.custom[this.namespace].enabled) {

				// Verify if the object was already activated, if not initialize new device
				if (!this.activeStates[stateID]) {
					this.log.info(`Enable SourceAnalytix for : ${stateID}`);
					await this.buildStateDetailsArray(id);
					this.log.debug(`Active state array after enabling ${stateID} : ${JSON.stringify(this.activeStates)}`);
					await this.initialize(stateID);
				} else {
					this.log.info(`Updated SourceAnalytix configuration for : ${stateID}`);
					await this.buildStateDetailsArray(id);
					this.log.debug(`Active state array after updating configuraiton of ${stateID} : ${JSON.stringify(this.activeStates)}`);
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

	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {

		if (state) {
			// The state was changed
			this.log.debug(`state ${id} changed : ${JSON.stringify(state)} SourceAnalytix calculation executed`);

			// Implement x ignore time (configurable) to avoid overload of uneeded calculations
			this.calculationHandler(id, state);

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
		// Return array of year and week number
		return [weekNo];

	}

	// Cronjobs startvalue reset for each day, week, month, quarter, year
	async resetShedules() {

		schedule.scheduleJob('0 0 * * *', async () => {
			await this.resetDates; // Reset date values in memory
			await this.resestValues('start_day');

		});

		// Reset Week counter
		schedule.scheduleJob('0 0 * * 1', async () => {
			await this.resetDates; // Reset date values in memory
			await this.resestValues('start_week');

		});

		// Reset month counter
		schedule.scheduleJob('0 0 1 * *', async () => {
			await this.resetDates; // Reset date values in memory
			await this.resestValues('start_month');

		});

		// Reset quarter counter
		schedule.scheduleJob('0 0 1 1,4,7,10 *', async () => {
			await this.resetDates; // Reset date values in memory
			await this.resestValues('start_quarter');

		});

		// Reset year counter
		schedule.scheduleJob('0 0 1 1 *', async () => {
			await this.resetDates; // Reset date values in memory

			// create object structure for new year
			for (const stateID in this.activeStates) {
				await this.initialize(stateID);
			}

			await this.resestValues('start_year');

		});

	}

	async resestValues(type) {

		calcBlock = true; // Pauze all calculations
		// Read state array and write Data for every active state
		for (const stateID in this.activeStates) {
			// Prepare custom object
			const obj = {};
			obj.common = {};
			obj.common.custom = {};
			obj.common.custom[this.namespace] = {};
			// get current meter value
			const reading = this.activeStates[stateID].calcValues.currentValuekWh;
			if (!reading) return;

			this.log.info(`Resetting startvalue for ${stateID} type ${type} with value ${reading}`);

			// Extend object with start value [type] & updat memory
			obj.common.custom[this.namespace][type] = reading;
			this.activeStates[stateID].calcValues[type] = reading;

			await this.extendForeignObject(stateID, obj);
			this.log.debug(`startvalue for ${stateID} resettet`);
		}
		calcBlock = false; // Enable all calculations
	}

	// Ensure always the calculation factor is correctly applied (example Wh to kWh, we calculate always in kilo)
	async calcFac(stateID, value) {
		try {
			const stateDetails = this.activeStates[stateID].stateDetails;
			if (value === null) {
				this.log.error(`Data error ! NULL value received for current reading of device : ${stateID}`);
			}

			switch (stateDetails.unit.toLowerCase()) {
				case 'kwh':
					// Keep value
					break;
				case 'wh':
					value = value / 1000;
					break;
				case 'm3':
					// Keep value
					break;
				case 'm³':
					// Keep value
					break;
				case 'l':
					value = value / 1000;
					break;
				case 'w':
					// Keep value
					break;
				default:
					this.log.error(`Case error : ${stateID} received for calculation with unit : ${stateDetails.unit} which is currenlty not (yet) supported`);
			}

			return value;
		} catch (error) {
			this.log.error(`[calcFac ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}

	}

	// Function to handle channel creation
	async ChannelCreate(id, channel, name) {
		this.log.debug('Parent device : ' + id);
		this.log.debug('Create channel id : ' + channel);
		this.log.debug('Create channel name : ' + name);

		await this.createChannelAsync(id, channel, {
			name: name
		});
	}

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
				unit: this.activeStates[stateID].useUnit,
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
					switch (stateDetails.headCathegorie) {

						case 'consumed':
							await this.localSetObject(`${stateDetails.deviceName}.${currentYear}.consumed.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.delivered.${stateRoot}`);
							break;

						case 'delivered':
							await this.localSetObject(`${stateDetails.deviceName}.${currentYear}.delivered.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.consumed.${stateRoot}`);
							break;

						default:

					}

				} else if (deleteState || !stateDetails.consumption) {

					// If state deletion choosen, clean everyting up else define statename
					await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.consumed.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${currentYear}.consumed.${stateRoot}`);
					await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.delivered.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${currentYear}.delivered.${stateRoot}`);

				}

				// Create MeterReading states
				if (!deleteState && stateDetails.meter_values) {

					// Do not create StateRoot values
					if (!basicValues.includes(stateRoot)) {
						await this.localSetObject(`${stateDetails.deviceName}.${currentYear}.meterReadings.${stateRoot}`, commonData);
					}

				} else if (deleteState || !stateDetails.meter_values) {

					// If state deletion choosen, clean everyting up else define statename
					await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.meterReadings.${stateRoot}`);

				}

				// Create cost states
				if (!deleteState && stateDetails.costs) {

					commonData.unit = '€'; // Switch Unit to money

					switch (stateDetails.financielCathegorie) {

						case 'costs':
							// await this.ChannelCreate(device, head_cathegorie, head_cathegorie);
							await this.localSetObject(`${stateDetails.deviceName}.${currentYear}.costs.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.earnings.${stateRoot}`);
							break;

						case 'earnings':
							// await this.ChannelCreate(device, head_cathegorie, head_cathegorie);
							await this.localSetObject(`${stateDetails.deviceName}.${currentYear}.earnings.${stateRoot}`, commonData);
							await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.costs.${stateRoot}`);
							break;

						default:

					}

				} else if (!stateDetails.costs) {

					// If state deletion choosen, clean everyting up else define statename
					await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.costs.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${currentYear}.costs.${stateRoot}`);
					await this.localDeleteState(`${stateDetails.deviceName}.${currentYear}.earnings.${stateRoot}`);
					this.log.debug(`Try deleting state ${stateDetails.deviceName}.${currentYear}.earnings.${stateRoot}`);
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

	// Define which calculation factor must be used
	async priceDeclaration(stateID) {
		this.log.debug(`[priceDeclaration for ${stateID}`);
		try {
			const stateDetails = this.activeStates[stateID].stateDetails;
			let unitPrice = null;
			let basicPrice = null;

			switch (stateDetails.state_type) {

				case 'kWh_consumption':
					this.log.debug('Case result : Electricity consumption');
					unitPrice = this.config.unit_price_power;
					basicPrice = this.config.basic_price_power;
					break;

				case 'kWh_consumption_night':
					this.log.debug('Case result : Electricity consumption night');
					unitPrice = this.config.unit_price_power_night;
					basicPrice = this.config.basic_price_power;
					break;

				case 'impuls':
					this.log.debug('Case result : Impuls');
					unitPrice = this.config.unit_price_power;
					basicPrice = this.config.basic_price_power;
					break;

				case 'kWh_delivery':
					this.log.debug('Case result : Electricity delivery');
					unitPrice = this.config.unit_price_power_delivery;
					basicPrice = this.config.basic_price_power;
					break;

				case 'kWh_heatpomp':
					this.log.debug('Case result : Heat Pump');
					unitPrice = this.config.unit_price_heatpump;
					basicPrice = this.config.basic_price_heatpump;
					break;

				case 'kWh_heatpomp_night':
					this.log.debug('Case result : Heat Pump night');
					unitPrice = this.config.unit_price_heatpump_night;
					basicPrice = this.config.basic_price_heatpump;
					break;

				case 'gas':
					this.log.debug('Case result : Gas');
					unitPrice = this.config.unit_price_gas;
					basicPrice = this.config.basic_price_gas;
					break;

				case 'water_m3':
					this.log.debug('Case result : Water');
					unitPrice = this.config.unit_price_water;
					basicPrice = this.config.basic_price_water;
					break;

				case 'oil_m3':
					this.log.debug('Case result : Oil');
					unitPrice = this.config.unit_price_oil;
					basicPrice = this.config.basic_price_oil;
					break;

				default:
					this.log.error(`Error in case handling of cost type identificaton for state ${stateID} state_type : ${stateDetails.state_type}`);
					return;
			}

			// Return values
			return { unitPrice, basicPrice };

		} catch (error) {
			this.log.error(`[priceDeclaratioee ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}
	}
	// Calculation handler
	async calculationHandler(stateID, value) {
		if (calcBlock) return; // cancel operation if calculcaiton block is activate
		try {
			const stateDetails = this.activeStates[stateID].stateDetails;
			const statePrices = this.activeStates[stateID].prices;
			this.log.debug(`Calculation for  ${stateID} with values : ${JSON.stringify(value)} and configuration : ${JSON.stringify(this.activeStates[stateID])}`);

			let stateName = `${this.namespace}.${stateDetails.deviceName}`;

			// Different logic for W values, calculate to kWh first
			let reading = null;
			if (stateDetails.unit.toLowerCase() === 'w') {
				this.log.debug(`Wat value ${value} and array ${JSON.stringify(this.activeStates[stateID])}`);
				reading = await this.wattToKwh(stateID, value);
				this.log.debug(`Result of Watt to kWh calculation ${reading}`);
			} else {
				reading = await this.calcFac(stateID, value.val);
				this.log.debug(`non Watt value ${value.val} and array ${JSON.stringify(this.activeStates[stateID])}`);
			}

			this.log.debug(`Recalculated value ${reading}`);
			if (!reading) return;

			// Detect meter reset & ensure komulative calculation
			if (reading < this.activeStates[stateID].calcValues.currentValuekWh) {
				this.log.debug(`New reading ${reading} lower than stored value ${this.activeStates[stateID].calcValues.currentValuekWh}`);
				this.log.debug(`deviceResetHandled ${JSON.stringify(deviceResetHandled)}`);

				// Treshold of 1 kWh to detect reset of meter
				if (reading < 1 && !deviceResetHandled[stateID]) {
					this.log.warn(`Device reset detected store current value ${this.activeStates[stateID].calcValues.currentValuekWh} to value of reset`);
					deviceResetHandled[stateID] = true;

					// Prepare object array for extension
					const obj = {};
					obj.common = {};
					obj.common.custom = {};
					obj.common.custom[this.namespace] = {};

					// Extend valueAtDeviceReset with currentValuekWh at object and memory
					obj.common.custom[this.namespace].valueAtDeviceReset = this.activeStates[stateID].calcValues.currentValuekWh;
					this.activeStates[stateID].calcValues.valueAtDeviceReset = this.activeStates[stateID].calcValues.currentValuekWh;
					await this.extendForeignObject(stateID, obj);

					// Calculate propper reading
					reading = reading + this.activeStates[stateID].calcValues.valueAtDeviceReset;
				} else {
					this.log.debug(`Adding ${reading} to stored value ${this.activeStates[stateID].calcValues.valueAtDeviceReset}`);

					// Add current reading to value in memory
					reading = reading + this.activeStates[stateID].calcValues.valueAtDeviceReset;
					this.log.debug(`Calculation outcome ${reading} valueAtDeviceReset ${this.activeStates[stateID].calcValues.valueAtDeviceReset}`);
					// Reset device reset variable
					if (reading > 1) deviceResetHandled[stateID] = true;

				}
			} else {
				this.log.debug(`New reading ${reading} bigger than stored value ${this.activeStates[stateID].calcValues.currentValuekWh} processing normally`);
			}

			this.log.debug(`Set current value ${reading} on state : ${stateDetails.deviceName}.Current_Reading}`);
			// Update current value to memory
			this.activeStates[stateID]['calcValues'].currentValuekWh = reading;
			const calcValues = this.activeStates[stateID].calcValues;
			await this.setState(`${stateDetails.deviceName}.Current_Reading`, { val: await this.roundDigits(reading), ack: true });

			// 	// Handle impuls counters
			// 	if (obj_cust.state_type == 'impuls'){

			// 		// cancel calculation in case of impuls counter
			// 		return;

			// 	}

			// temporary set to sero, this value will be used later to handle period calculations
			const reading_start = 0; //obj_cust.start_meassure;

			// Store meter values
			if (stateDetails.meter_values === true) {
				// Always write generic meterReadings for current year
				stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${currentYear}.meterReadings`;
				const readingRounded = await this.roundDigits(reading);
				// Week
				// await this.setState(`${stateName}.this_week.${currentDay}`, { val: calculationRounded.consumedDay, ack: true });
				await this.setState(`${stateName}.weeks.${currentWeek}`, { val: readingRounded, ack: true });
				// Month
				await this.setState(`${stateName}.months.${currentMonth}`, { val: readingRounded, ack: true });
				// Quarter
				await this.setState(`${stateName}.quarters.Q${currentQuarter}`, { val: readingRounded, ack: true });

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

			this.log.silly(`Consumed data for ${stateID} : ${JSON.stringify(calculations)}`);

			// Store consumption
			if (stateDetails.consumption) {
				// Always write generic meterReadings for current year
				stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${currentYear}.${stateDetails.headCathegorie}`;
				// Generic
				await this.setState(`${stateName}.01_current_day`, { val: calculationRounded.consumedDay, ack: true });
				await this.setState(`${stateName}.02_current_week`, { val: calculationRounded.consumedWeek, ack: true });
				await this.setState(`${stateName}.03_current_month`, { val: calculationRounded.consumedMonth, ack: true });
				await this.setState(`${stateName}.04_current_quarter`, { val: calculationRounded.consumedQuarter, ack: true });
				await this.setState(`${stateName}.05_current_year`, { val: calculationRounded.consumedYear, ack: true });

				// Week
				// await this.setState(`${stateName}.this_week.${currentDay}`, { val: calculationRounded.consumedDay, ack: true });
				await this.setState(`${stateName}.weeks.${currentWeek}`, { val: calculationRounded.consumedWeek, ack: true });
				// Month
				await this.setState(`${stateName}.months.${currentMonth}`, { val: calculationRounded.consumedMonth, ack: true });
				// Quarter
				await this.setState(`${stateName}.quarters.Q${currentQuarter}`, { val: calculationRounded.consumedQuarter, ack: true });
			}

			// Store prices
			if (stateDetails.costs) {

				stateName = `${`${this.namespace}.${stateDetails.deviceName}`}.${currentYear}.${stateDetails.financielCathegorie}`;
				// Generic
				await this.setState(`${stateName}.01_current_day`, { val: calculationRounded.priceDay, ack: true });
				await this.setState(`${stateName}.02_current_week`, { val: calculationRounded.priceWeek, ack: true });
				await this.setState(`${stateName}.03_current_month`, { val: calculationRounded.priceMonth, ack: true });
				await this.setState(`${stateName}.04_current_quarter`, { val: calculationRounded.priceQuarter, ack: true });
				await this.setState(`${stateName}.05_current_year`, { val: calculationRounded.priceYear, ack: true });

				// Week
				// await this.setState(`${stateName}.this_week.${currentDay}`, { val: calculationRounded.priceDay, ack: true });
				await this.setState(`${stateName}.weeks.${currentWeek}`, { val: calculationRounded.priceWeek, ack: true });
				// Month
				await this.setState(`${stateName}.months.${currentMonth}`, { val: calculationRounded.priceMonth, ack: true });
				// Quarter
				await this.setState(`${stateName}.quarters.Q${currentQuarter}`, { val: calculationRounded.priceQuarter, ack: true });

			}

			this.log.silly('Meter Calculation executed');

		} catch (error) {
			this.log.error(`[calculationHandler ${stateID}] error: ${error.message}, stack: ${error.stack}`);
		}

	}

	async roundDigits(value) {
		try {
			let rounded = Number(value);
			rounded = Math.round(rounded * 1000) / 1000;
			this.log.debug(`roundDigits with ${value} rounded ${rounded}`);
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
			return rounded;

		} catch (error) {
			this.log.error(`[roundCosts ${value}`);
		}
	}

	async wattToKwh(stateID, value) {
		const calcValues = this.activeStates[stateID].calcValues;
		const stateDetails = this.activeStates[stateID].stateDetails;

		this.log.silly(`Watt to kWh for ${stateID} current reading : ${value.val} previousReading : ${JSON.stringify(this.activeStates[stateID])}`);

		// Prepare needed data to handle calculations
		const readingData = {
			currentValuekWh: Number(calcValues.currentValuekWh),
			previousReadingWatt: Number(calcValues.previousReadingWatt),
			previousReadingWattTs: Number(calcValues.previousReadingWattTs),
			currentReadingWatt: Number(value.val),
			currentReadingWattTs: Number(value.ts),
		};

		// Prepeare function return
		let calckWh = null;

		if (readingData.previousReadingWatt && readingData.previousReadingWattTs) {

			// Calculation logic W to kWh
			calckWh = (((readingData.currentReadingWattTs - readingData.previousReadingWattTs) / 1000) * readingData.previousReadingWatt / 3600000);
			this.log.debug(`Calc kWh current timing : ${calckWh} adding current value ${readingData.currentValuekWh}`);
			// add current meassurement to previous kWh total
			calckWh = calckWh + readingData.currentValuekWh;
			this.log.debug(`Calc kWh total : ${calckWh}`);

			// Update timestamp current reading to memory
			this.activeStates[stateID]['calcValues'].previousReadingWatt = readingData.currentReadingWatt;
			this.activeStates[stateID]['calcValues'].previousReadingWattTs = readingData.currentReadingWattTs;

		} else {

			// Update timestamp current reading to memory
			this.activeStates[stateID]['calcValues'].previousReadingWatt = readingData.currentReadingWatt;
			this.activeStates[stateID]['calcValues'].previousReadingWattTs = readingData.currentReadingWattTs;

			calckWh = await this.getCurrentTotal(stateID, stateDetails.deviceName);

		}

		this.log.debug(`Watt to kWh outcome for ${stateID} : ${JSON.stringify(this.activeStates[stateID].calcValues)}`);
		return calckWh;
	}

	// Read current calculated totals, needed to ensure komulative calculations
	async getCurrentTotal(stateID, deviceName) {
		let calckWh = null;

		// Check if previous reading exist in state
		const previousReadingV4 = await this.getStateAsync(`${deviceName}.Current_Reading`);

		// temporary indicate source of kWh value
		let valueSource = null;

		// Check if previous reading exist in state (routine for <4 version )
		if (!previousReadingV4 || previousReadingV4.val === 0) {

			const previousReadingVold = await this.getStateAsync(`${deviceName}.Meter_Readings.Current_Reading`);
			if (!previousReadingVold || previousReadingVold.val === 0) return;
			calckWh = previousReadingVold.val;
			// temporary indicate source of kWh value
			valueSource = 'Version < 4';

		} else {
			calckWh = previousReadingV4.val; // use previous stored vlaue
			valueSource = 'Version > 4';
			this.log.info(`for state ${stateID} Previous watt calculated reading used ${valueSource} from ${JSON.stringify(previousReadingV4)}`);
		}
		return calckWh;
	}

	async resetDates() {
		const today = new Date();
		currentDay = weekdays[today.getDay()];
		currentWeek = await this.getWeekNumber(new Date());
		currentMonth = months[today.getMonth()];
		currentQuarter = Math.floor((today.getMonth() + 3) / 3);
		currentYear = (new Date().getFullYear());
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
