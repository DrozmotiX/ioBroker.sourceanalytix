"use strict";

/*
 * Created with @iobroker/create-adapter v1.11.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Lets make sure we know all days and months
const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');

// Create variables for object arrays
const history = {}, w_values = {}, aliasMap = {}, cron_set = [], state_set = [];
// Load Time Modules
const cron = require("node-cron"); // Cron Scheduler

class Sourceanalytix extends utils.Adapter {

	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "sourceanalytix",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("objectChange", this.onObjectChange.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here
		this.log.info("Adapter SourceAnalytix startet :-)");

		// // initialize all SourceAnalytix enabled states
		this.log.info("Initializing all enabled states for SourceAnalytix");

		// Subscribe on all foreign states to ensure changes in objects are reflected
		this.subscribeForeignObjects("*");

		this.objects.getObjectView("custom", "state", {}, (err, doc) => {
			this.log.debug("Result doc : " + JSON.stringify(doc));
			if (doc && doc.rows) {

				for (let i = 0, l = doc.rows.length; i < l; i++) {
					if (doc.rows[i].value) {
						let id = doc.rows[i].id;

						// temporary disable, should consider to have alias also in SourceAnalytix in case meters are changed
						// const realId = id;
						if (doc.rows[i].value[this.namespace] && doc.rows[i].value[this.namespace].aliasId) {
							aliasMap[id] = doc.rows[i].value[this.namespace].aliasId;
							this.log.debug("Found Alias: " + id + " --> " + aliasMap[id]);
							id = aliasMap[id];
						}
						history[id] = doc.rows[i].value;

						if (history[id].enabled !== undefined) {
							history[id] = history[id].enabled ? { "history.0": history[id] } : null;
							if (!history[id]) {
								this.log.info("undefined id");
								// delete history[id];
								continue;
							}
						}
						if (!history[id][this.namespace] || history[id][this.namespace].enabled === false) {
							// delete history[id];
						} else {
							this.getForeignObject(id, (err, obj) => {
								if (obj !== undefined && obj !== null) {
									// Push object into variable array used for checks later
									state_set.push(id);
									this.log.silly(JSON.stringify(obj));
									// run initialisation for objects
									this.log.info("Activate SourceAnalytix for : " + obj._id);
									this.initialize(obj);
									this.log.debug("Object array : " + JSON.stringify(state_set));
								}
							});
						}
					}
				}
			}
		});
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.log.info("Adapter SourceAnalytix stopped !");
			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed object changes
	 * @param {string} id
	 * @param {ioBroker.Object | null | undefined} obj
	 */
	onObjectChange(id, obj) {
		let existing = false;
		let array_id;

		this.log.debug("Object array of all activated states : " + JSON.stringify(state_set));
		this.log.debug("Object array of object trigger : " + JSON.stringify(obj));
		// Check if change object is part of array
		for (const x in state_set) {

			if (state_set[x] === id) {
				existing = true;
				array_id = x;
			}

		}

		// Check if object is activated for SourceAnalytix
		if (obj && obj.common &&
			(
				(obj.common.custom && obj.common.custom[this.namespace] && obj.common.custom[this.namespace].enabled)
			)
		) {
			// Verify if the object was already activated, if not initialize new device
			if (existing === false) {
				this.log.info("Enable SourceAnalytix for : " + id);
				// Add object to array
				state_set.push(id);
				this.initialize(obj);
			} else {
				this.log.info("Updated SourceAnalytix configuration for : " + id);
				this.initialize(obj);
			}

			this.log.debug("Complete object array : " + JSON.stringify(state_set));

		} else {

			if (existing === true) {
				this.log.info("Disable SourceAnalytix for : " + id);
				this.unsubscribeForeignStates(id);
				// TODO: array_id is a string, but is used like a number
				state_set.splice(array_id, 1);
			}
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
			this.log.debug(`state ${id} changed : ${state.val} SourceAnalytix calculation executed`);

			this.getForeignObject(id, (err, obj) => {
				if (obj !== undefined && obj !== null) {
					this.calculation_handler(obj);
				}
			});
		}
	}

	// null values must be set 0 to avoid issue in later processing, def: 0 at object creation possible n js-controler 2.0
	async set_zero_val(id) {

		const inst_name = this.namespace;
		const reading = await this.getForeignStateAsync(inst_name + "." + id);

		if (reading === null) {
			this.log.debug("Zero val at initalisation, target state : " + inst_name + "." + id);
			this.setState(inst_name + "." + id, { val: 0, ack: true });
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
			weekNo = "0" + weekNo;
		}
		// Return array of year and week number
		return [weekNo];
	}

	// Function to calculate current quarter
	// function quarter_of_the_year(){
	// 		const date = new Date();
	// 		const m = date.getMonth()+1;
	// 		return Math.ceil(m/3);
	// }

	// Function to reset start values for each day, week, month, quarter, year
	async reset_shedules(obj_array) {
		const inst_name = this.namespace;
		let existing = false;
		for (const x in cron_set) {

			// check if cronjob is already running, if not initiate
			if (cron_set[x] === obj_array._id) {
				existing = true;
			}

		}

		if (existing === false) {
			// Store object id in array to prevent double run on shedules when object configuration changes
			this.log.debug("Sheduled reset activate for : " + JSON.stringify(obj_array));
			cron_set.push(obj_array._id);

			// Prepare custom object
			const obj = {};
			obj.common = {};
			obj.common.custom = {};
			obj.common.custom[inst_name] = {};

			// Reset day counter
			cron.schedule("0 0 * * *", async () => {
				// get current meter value
				const reading = await this.getForeignStateAsync(obj_array.MeterReading);
				if (!reading) return;
				//const calc_reading = this.unit_calc_fact(obj_array, reading.val);

				// Extend object with start value day
				obj.common.custom[this.namespace].start_day = reading.val;
				this.log.debug("Object content custom current : " + JSON.stringify(obj));

				this.extendForeignObject(obj_array._id, obj, (err) => {
					if (err) {
						this.log.error("Setting start value Day failed : " + err);
					} else {
						this.log.debug("Object content custom after start_day value reset : " + JSON.stringify(obj));
						this.log.info("Setting start value Day for device : " + obj_array._id + " succeeded with value + " + reading.val);
					}
				});
			});

			// Reset Week counter
			cron.schedule("0 0 * * 1", async () => {

				// get current meter value
				const reading = await this.getForeignStateAsync(obj_array.MeterReading);
				if (!reading) return;
				//const calc_reading = this.unit_calc_fact(obj_array, reading.val);

				// Extend object with start value week
				obj.common.custom[this.namespace].start_week = reading.val;
				this.log.debug("Object content custom current : " + JSON.stringify(obj));

				this.extendForeignObject(obj_array._id, obj, (err) => {
					if (err) {
						this.log.error("Setting start value Week failed : " + err);
					} else {
						this.log.debug("Object content custom after start_day value reset : " + JSON.stringify(obj));
						this.log.info("Setting start value Week for device : " + obj_array._id + " succeeded with value + " + reading.val);
					}
				});
			});

			// Reset month counter
			cron.schedule("0 0 1 * *", async () => {

				// get current meter value
				const reading = await this.getForeignStateAsync(obj_array.MeterReading);
				if (!reading) return;
				//const calc_reading = this.unit_calc_fact(obj_array, reading.val);

				// Extend object with start value month
				obj.common.custom[this.namespace].start_month = reading.val;
				this.log.debug("Object content custom current : " + JSON.stringify(obj));

				this.extendForeignObject(obj_array._id, obj, (err) => {
					if (err) {
						this.log.error("Setting start value month failed : " + err);
					} else {
						this.log.debug("Object content custom after start_day value reset : " + JSON.stringify(obj));
						this.log.info("Setting start value month for device : " + obj_array._id + " succeeded with value + " + reading.val);
					}
				});
			});

			// Reset quarter counter
			cron.schedule("0 0 1 1,4,7,10 *", async () => {

				// get current meter value
				const reading = await this.getForeignStateAsync(obj_array.MeterReading);
				if (!reading) return;
				//const calc_reading = this.unit_calc_fact(obj_array, reading.val);

				// Extend object with start value quarter
				obj.common.custom[this.namespace].start_quarter = reading.val;
				this.log.debug("Object content custom current : " + JSON.stringify(obj));

				this.extendForeignObject(obj_array._id, obj, (err) => {
					if (err) {
						this.log.error("Setting start value quarter failed : " + err);
					} else {
						this.log.debug("Object content custom after start_day value reset : " + JSON.stringify(obj));
						this.log.info("Setting start value quarter for device : " + obj_array._id + " succeeded with value + " + reading.val);
					}
				});
			});

			// Reset year counter
			cron.schedule("0 0 1 1 *", async () => {

				// get current meter value
				const reading = await this.getForeignStateAsync(obj_array.MeterReading);
				if (!reading) return;
				//const calc_reading = this.unit_calc_fact(obj_array, reading.val);

				// Extend object with start value year
				obj.common.custom[this.namespace].start_year = reading.val;
				this.log.debug("Object content custom current : " + JSON.stringify(obj));

				this.extendForeignObject(obj_array._id, obj, (err) => {
					if (err) {
						this.log.error("Setting start value year failed : " + err);
					} else {
						this.log.debug("Object content custom after start_day value reset : " + JSON.stringify(obj));
						this.log.info("Setting start value year for device : " + obj_array._id + " succeeded with value + " + reading.val);
					}
				});
			});
		} else {

			this.log.debug("shedule already present, do nothing");

		}
	}

	// Ensure always the calculation factor is correctly applied (example Wh to kWh, we calculate always in kilo)
	unit_calc_fact(obj, value) {
		this.log.debug("Object array input for unit factore calculation : " + JSON.stringify(obj));
		this.log.debug("State value input for unit factore calculation : " + JSON.stringify(value));
		if (value === null) {
			this.log.error("Data error ! NULL value received for current reading of device : " + obj._id);
		}

		const unit = this.defineUnit(obj);

		this.log.debug("Test unit : " + unit);

		let calc_value;

		switch (unit) {
			case "kwh":
				calc_value = value;
				break;
			case "wh":
				calc_value = value / 1000;
				break;
			case "m3":
				calc_value = value;
				break;
			case "l":
				calc_value = value / 1000;
				break;
			case "w":
				calc_value = value;
				break;
			default:
				this.log.error("Case error : value received for calculation with unit : " + unit + " which is currenlty not (yet) supported");
		}

		if (calc_value === null) {
			this.log.error("Data error ! NULL value received for current reading of device : " + obj._id);
		}

		this.log.debug("State value output of unit factore calculation : " + JSON.stringify(calc_value));

		return calc_value;
	}

	// Function to handle channel creation
	async ChannelCreate(id, channel, name) {
		this.log.debug("Parent device : " + id);
		this.log.debug("Create channel id : " + channel);
		this.log.debug("Create channel name : " + name);

		await this.createChannelAsync(id, channel, {
			"name": name
		});
	}

	// Function to handle state creation
	async doStateCreate(delivery, device, id, name, type, role, unit, head, financial, reading) {
		let head_cathegorie;
		let financiel_cathegorie;

		// create seperate channels for amounts, costs and current value
		if (delivery) {
			head_cathegorie = "delivery";
			financiel_cathegorie = "earnings";
		} else {
			head_cathegorie = "consumption";
			financiel_cathegorie = "cost";
		}

		let object = device + "." + head_cathegorie + id;

		if (head) {
			await this.ChannelCreate(device, head_cathegorie, head_cathegorie);
			await this.setObjectNotExistsAsync(object, {
				type: "state",
				common: {
					name: name,
					type: type,
					role: role,
					read: true,
					unit: unit,
					def: 0,
				},
				native: {},
			});
			await this.set_zero_val(object);
		}

		if (financial) {
			await this.ChannelCreate(device, financiel_cathegorie, financiel_cathegorie);
			object = device + "." + financiel_cathegorie + id;
			await this.setObjectNotExistsAsync(object, {
				type: "state",
				common: {
					name: name,
					type: type,
					role: role,
					read: true,
					unit: "€",
					def: 0,
				},
				native: {},
			});
			await this.set_zero_val(object);
		}

		if (reading) {

			object = device + "." + "Meter_Readings" + id;
			await this.ChannelCreate(device, "Meter_Readings", "Meter_Readings");
			await this.setObjectNotExistsAsync(object, {
				type: "state",
				common: {
					name: name,
					type: type,
					role: role,
					read: true,
					unit: unit,
					def: 0,
				},
				native: {},
			});
			await this.set_zero_val(object);
		}
	}

	// Create object tree and states for all devices to be handled
	async initialize(obj) {
		const inst_name = this.namespace;
		const id = obj._id;
		const obj_cust = obj.common.custom[inst_name];
		let w_calc = false;
		let unit = this.defineUnit(obj);

		this.log.debug("instanze name : " + inst_name);
		// const obj_cust = this.config.custom;
		this.log.debug("Content custom of object : " + JSON.stringify(obj_cust));
		this.log.debug("Custom object tree : " + JSON.stringify(obj_cust));

		if ((unit === "kwh") || (unit === "m3") || (unit === "wh") || (unit === "l") || (unit == "w")) {

			if (unit === "wh") { unit = "kWh"; }
			if (unit === "w") { unit = "kWh"; w_calc = true; }
			if (unit === "kwh") { unit = "kWh"; }
			if (unit === "l") { unit = "m3"; }

			// replace "." in datapoints to "_"
			const device = id.split(".").join("__");

			this.log.debug("Changed Device Name : " + device);

			// Set type to consume or deliver
			let delivery;
			if (obj_cust.state_type === "kWh_delivery") {
				delivery = true;
			} else {
				delivery = false;
			}
			this.log.debug("Delivery type : " + delivery);

			// define device name, change with alias when required
			let alias = obj.common.name;
			this.log.debug("Name before alias renaming : " + alias);
			this.log.debug("Device name : " + alias);
			this.log.debug("State alias name : " + obj_cust.alias);
			if (obj_cust.alias !== undefined && obj_cust.alias !== null && obj_cust.alias !== "") {
				alias = obj_cust.alias;
			}
			this.log.debug("Name after alias renaming" + alias);

			// Create new device object for every state in powermonitor tree
			this.setObjectNotExistsAsync(device, {
				type: "device",
				common: {
					name: alias
				},
				native: {},
			});

			// change device name when alias is updated
			const objekt = {};
			objekt.common = {
				name: alias
			};
			this.extendObjectAsync(device, objekt, (err) => {
				if (err !== null) {
					this.log.error("Changing alias name failed with : " + err);
				}
			});

			this.log.debug("Customized Device name = : " + alias);
			this.log.debug("Days ? : " + this.config.store_days);
			this.log.debug("Consumption ?  : " + obj_cust.consumption);
			this.log.debug("Costs : " + obj_cust.costs);
			this.log.debug("Meter History ? : " + obj_cust.meter_values);

			if (this.config.store_days === true) {
				this.log.debug("Creating weekdays");
				// create states for weekdays
				for (const x in weekdays) {
					const curent_day = ".current_year.this_week." + weekdays[x];
					await this.doStateCreate(delivery, device, curent_day, weekdays[x], "number", "value.day", unit, obj_cust.consumption, obj_cust.costs, obj_cust.meter_values);
				}
			}

			if (this.config.store_weeks) {
				// create states for weeks
				let weeknr;
				for (let y = 1; y < 54; y++) {
					if (y < 10) {
						weeknr = "0" + y;
					} else {
						weeknr = y;
					}
					const state_root = ".current_year.weeks." + weeknr;
					await this.doStateCreate(delivery, device, state_root, "week " + weeknr, "number", "value.day", unit, obj_cust.consumption, obj_cust.costs, obj_cust.meter_values);
				}
			}

			if (this.config.store_months) {
				// create states for months
				for (const x in months) {
					const curent_day = ".current_year.months." + months[x];
					await this.doStateCreate(delivery, device, curent_day, months[x], "number", "value.month", unit, obj_cust.consumption, obj_cust.costs, obj_cust.meter_values);
				}
			}

			// create state for current day/week/quarters/month current value
			let state_root = ".01_current_day";
			await this.doStateCreate(delivery, device, state_root, "current Day ", "number", "value.week", unit, obj_cust.consumption, obj_cust.costs, false);
			state_root = ".02_current_week";
			await this.doStateCreate(delivery, device, state_root, "current Week ", "number", "value.week", unit, obj_cust.consumption, obj_cust.costs, false);
			state_root = ".03_current_month";
			await this.doStateCreate(delivery, device, state_root, "current Month ", "number", "value.month", unit, obj_cust.consumption, obj_cust.costs, false);
			state_root = ".04_current_quarter";
			await this.doStateCreate(delivery, device, state_root, "current Quarter", "number", "value.quarter", unit, obj_cust.consumption, obj_cust.costs, false);
			state_root = ".05_current_year";
			await this.doStateCreate(delivery, device, state_root, "current Year", "number", "value.year", unit, obj_cust.consumption, obj_cust.costs, false);
			state_root = ".Current_Reading";
			await this.doStateCreate(delivery, device, state_root, "Current Reading", "number", "value.current", unit, false, false, true);

			this.log.silly("Current reading state : " + delivery + device + state_root);

			// Create meassurement state used for calculations related w to kWh
			if (w_calc === true) {
				state_root = ".Current_Reading_W";
				await this.doStateCreate(delivery, device, state_root, "Current Reading W", "number", "value.current", "W", false, false, true);
			}

			this.log.debug("Initialization finished for : " + device);
			// Subscribe state, every state change will trigger calculation
			this.subscribeForeignStates(obj._id);

			// Calculate all values for the first time
			await this.calculation_handler(obj);

			// code here
			// From version 0.2.8.1 always use current meter readings in kWh to handle resets
			obj.MeterReading = this.namespace + "." + device + ".Meter_Readings.Current_Reading";
			this.reset_shedules(obj);

		} else {

			this.log.error("Sorry unite type " + unit + " not supported yet");

		}
	}
	// Calculation handler
	async calculation_handler(id) {
		const inst_name = this.namespace;
		let cost_t, del_t, cost_basic, cost_unit;
		this.log.debug("Write calculations for : " + id._id);
		this.log.debug("Instance name : " + inst_name);

		const date = new Date();

		// replace "." in datapoints to "_"
		const obj_id = id._id.split(".").join("__");
		const obj_root = this.namespace + "." + obj_id;

		this.log.debug("Calc obj root " + obj_root);

		const obj_cont = await this.getForeignObjectAsync(id._id);

		if (obj_cont === undefined || obj_cont === null) {
			return;
		}
		this.log.debug("State object content: " + JSON.stringify(obj_cont));

		if (obj_cont.common.custom === undefined) {
			return;
		}

		const obj_cust = obj_cont.common.custom[inst_name];
		this.log.debug("State object custom content: " + JSON.stringify(obj_cust));

		// Define unit
		const unit = await this.defineUnit(obj_cont);

		// Define which calculation factor must be used
		switch (obj_cust.state_type) {

			case "kWh_consumption":
				this.log.debug("Case result : Electricity consumption");
				cost_unit = this.config.unit_price_power;
				cost_basic = this.config.basic_price_power;
				break;
			case "kWh_consumption_night":
				this.log.debug("Case result : Electricity consumption night");
				cost_unit = this.config.unit_price_power_night;
				cost_basic = this.config.basic_price_power;
				break;

			case "kWh_delivery":
				this.log.debug("Case result : Electricity delivery");
				cost_unit = this.config.unit_price_power_delivery;
				cost_basic = this.config.basic_price_power;
				break;

			case "kWh_heatpomp":
				this.log.debug("Case result : Heat Pump");
				cost_unit = this.config.unit_price_heatpump;
				cost_basic = this.config.basic_price_heatpump;
				break;

			case "kWh_heatpomp_night":
				this.log.debug("Case result : Heat Pump night");
				cost_unit = this.config.unit_price_heatpump_night;
				cost_basic = this.config.basic_price_heatpump;
				break;

			case "gas":
				this.log.debug("Case result : Gas");
				cost_unit = this.config.unit_price_gas;
				cost_basic = this.config.basic_price_gas;
				break;

			case "water_m3":
				this.log.debug("Case result : Water");
				cost_unit = this.config.unit_price_water;
				cost_basic = this.config.basic_price_water;
				break;

			case "oil_m3":
				this.log.debug("Case result : Oil");
				cost_unit = this.config.unit_price_oil;
				cost_basic = this.config.basic_price_oil;
				break;

			default:
				this.log.error("Error in case handling of cost type identificaton : " + obj_cust.state_type);
				return;
		}

		// Get current value from meter
		const reading = await this.getForeignStateAsync(id._id);

		if (!reading) {
			this.log.error("Current value cannot be read during calculation of state : " + id._id);
			return;
		}

		// Declare variable containing meassurement
		let calc_reading;

		// Different logic for W values, calculate to kWh first
		if (unit !== "w") {

			calc_reading = await this.unit_calc_fact(id, reading.val);
			await this.setState(obj_root + ".Meter_Readings.Current_Reading", { val: calc_reading ,ack: true });

		} else {
			// Get previous reading of W and its related timestammps
			const Prev_Reading = await this.getStateAsync(obj_id + ".Meter_Readings.Current_Reading_W");
			this.log.debug("Previous_reading from state : " + JSON.stringify(Prev_Reading));
			if (!Prev_Reading) return;

			// Get current calculated kWh value, if not present in memory read from states
			let Prev_calc_reading = 0;
			this.log.debug("W value from memory : " + JSON.stringify(w_values));
			this.log.debug("W value from memory_2 : " + JSON.stringify(w_values.calc_reading));
			if (w_values.calc_reading !== undefined && w_values.calc_reading !== null && (w_values.calc_reading[obj_id] !== undefined && w_values.calc_reading[obj_id] !== null)) {
				Prev_calc_reading = w_values.calc_reading[obj_id];
				this.log.debug("Previous_calc_reading from memory : " + JSON.stringify(Prev_calc_reading));

				// Calculation logic W to kWh
				calc_reading = Prev_calc_reading + (((reading.ts - Prev_Reading.ts) / 1000) * Prev_Reading.val / 3600000);
				// Update variable with new value for next calculation cyclus
				w_values.calc_reading[obj_id] = calc_reading;
				this.log.debug("New calculated reading : " + JSON.stringify(calc_reading));
				this.log.debug("new W value from memory : " + JSON.stringify(w_values));

				// Write values to state
				await this.setState(obj_root + ".Meter_Readings.Current_Reading", { val: calc_reading ,ack: true });
				await this.setState(obj_root + ".Meter_Readings.Current_Reading_W", { val: reading.val ,ack: true });

			} else {
				this.log.debug("Else clause no value in memory present");
				const temp_reading = await this.getStateAsync(obj_root + ".Meter_Readings.Current_Reading");
				if (temp_reading !== undefined && temp_reading !== null) {
					Prev_calc_reading = parseFloat(temp_reading.val);
					if(w_values.calc_reading !== undefined && w_values.calc_reading !== null) {
						w_values.calc_reading[obj_id] = Prev_calc_reading;
					} else {
						w_values.calc_reading = {
							[obj_id]: Prev_calc_reading
						};
					}

					await this.setState(obj_root + ".Meter_Readings.Current_Reading_W", { val: reading.val ,ack: true });
					this.log.debug("Previous_calc_reading from state : " + JSON.stringify(Prev_calc_reading));
					this.log.debug("W value from state : " + JSON.stringify(w_values));
					return;
				}
			}
		}

		this.log.debug("Meter current reading : " + reading.val);
		this.log.debug("Meter calculated reading : " + calc_reading);
		this.log.debug("Handle cost calculations : " + obj_cust.costs);
		this.log.debug("Calculation Factor : " + cost_unit);
		this.log.debug("Cost basic : " + cost_basic);
		this.log.debug("Cost unit : " + cost_unit);
		this.log.debug("Handle consumption calculations : " + obj_cust.consumption);
		this.log.debug("Handle meter history : " + obj_cust.meter_values);

		// temporary set to sero, this value will be used later to handle period calculations
		const reading_start = 0; //obj_cust.start_meassure;
		const day_bval = obj_cust.start_day;
		const week_bval = obj_cust.start_week;
		const month_bval = obj_cust.start_month;
		const quarter_bval = obj_cust.start_quarter;
		const year_bval = obj_cust.start_year;

		this.log.debug("reading_start : " + reading_start);
		this.log.debug("day start : " + day_bval);
		this.log.debug("week start : " + week_bval);
		this.log.debug("month start " + month_bval);
		this.log.debug("quarter start " + quarter_bval);
		this.log.debug("year start : " + year_bval);

		// set correct naming for cost & delivery based on type
		if (obj_cust.state_type === "kWh_delivery") {
			cost_t = ".earnings.";
			del_t = ".delivery.";
		} else {
			cost_t = ".cost.";
			del_t = ".consumption.";
		}

		this.log.debug("Delivery state set to : " + del_t);

		// Store meter values
		if (obj_cust.meter_values === true) {

			this.log.debug("Start meter value calculations");

			// Calculate consumption
			// Weekday & current day
			const state_val = calc_reading.toFixed(3);

			this.log.debug("calculated reading day : " + state_val);
			this.setState(obj_root + ".Meter_Readings.current_year.this_week." + weekdays[date.getDay()], { val: state_val, ack: true });

			// Week
			this.log.debug("calculated reading week : " + state_val);
			this.setState(obj_root + ".Meter_Readings.current_year.weeks." + this.getWeekNumber(new Date()), { val: state_val, ack: true });

			// Month
			this.log.debug("calculated reading month : " + state_val);
			this.setState(obj_root + ".Meter_Readings.current_year.months." + months[date.getMonth()], { val: state_val, ack: true });

			// // Quarter
			// state_val = ((calc_reading - quarter_bval) - reading_start).toFixed(3);
			// this.log.debug("calculated reading quarter : " + state_val);

			// Year
			this.log.debug("calculated reading day : " + state_val);
			this.setState(obj_root + ".Meter_Readings.05_current_year", { val: state_val, ack: true });

		}

		// calculatte consumption
		if (obj_cust.consumption === true) {
			this.log.debug("Start consumption calculations");

			// Calculate consumption
			// Weekday & current day
			let state_val = ((calc_reading - day_bval) - reading_start).toFixed(3);

			this.log.debug("calculated reading day : " + state_val);
			this.setState(obj_root + del_t + "01_current_day", { val: state_val, ack: true });
			this.setState(obj_root + del_t + "current_year.this_week." + weekdays[date.getDay()], { val: state_val, ack: true });

			// Week
			state_val = ((calc_reading - week_bval) - reading_start).toFixed(3);
			this.log.debug("calculated reading week : " + state_val);
			this.setState(obj_root + del_t + "02_current_week", { val: state_val, ack: true });
			this.setState(obj_root + del_t + "current_year.weeks." + this.getWeekNumber(new Date()), { val: state_val, ack: true });

			// Month
			state_val = ((calc_reading - month_bval) - reading_start).toFixed(3);
			this.log.debug("calculated reading month : " + state_val);
			this.setState(obj_root + del_t + "03_current_month", { val: state_val, ack: true });
			this.setState(obj_root + del_t + "current_year.months." + months[date.getMonth()], { val: state_val, ack: true });

			// Quarter
			state_val = ((calc_reading - quarter_bval) - reading_start).toFixed(3);
			this.log.debug("calculated reading quarter : " + state_val);
			this.setState(obj_root + del_t + "04_current_quarter", { val: state_val, ack: true });

			// Year
			state_val = ((calc_reading - year_bval) - reading_start).toFixed(3);
			this.log.debug("calculated reading day : " + state_val);
			this.setState(obj_root + del_t + "05_current_year", { val: state_val, ack: true });
		}

		const day_bval_consumend = ((calc_reading - day_bval) - reading_start);
		const week_bval_consumend = ((calc_reading - week_bval) - reading_start);
		const month_bval_consumend = ((calc_reading - month_bval) - reading_start);
		const quarter_bval_consumend = ((calc_reading - quarter_bval) - reading_start);
		const year_bval_consumend = ((calc_reading - year_bval) - reading_start);

		this.log.debug("day consumed " + day_bval_consumend);
		this.log.debug("week consumed " + week_bval_consumend);
		this.log.debug("month consumed " + month_bval_consumend);
		this.log.debug("quarter consumed " + quarter_bval_consumend);
		this.log.debug("year consumed " + year_bval_consumend);
		this.log.debug("objroot " + obj_root);
		this.log.debug("cost type " + cost_t);
		this.log.debug("delivery type " + del_t);
		this.log.debug("example state string : " + obj_root + cost_t + "01_current_day");

		// Calculate costs
		if (obj_cust.costs === true) {
			// Weekday & current day
			let state_val = (day_bval_consumend * cost_unit).toFixed(2);
			this.log.debug("calculated cost day : " + state_val);
			this.setState(obj_root + cost_t + "01_current_day", { val: state_val, ack: true });
			this.setState(obj_root + cost_t + "current_year.this_week." + weekdays[date.getDay()], { val: state_val, ack: true });

			// Week
			state_val = (week_bval_consumend * cost_unit).toFixed(2);
			this.log.debug("calculated cost week : " + state_val);
			this.setState(obj_root + cost_t + "02_current_week", { val: state_val, ack: true });
			this.setState(obj_root + cost_t + "current_year.weeks." + this.getWeekNumber(new Date()), { val: state_val, ack: true });

			// Month
			state_val = (month_bval_consumend * cost_unit).toFixed(2);
			this.log.debug("calculated cost month : " + state_val);
			this.setState(obj_root + cost_t + "03_current_month", { val: state_val, ack: true });
			this.setState(obj_root + cost_t + "current_year.months." + months[date.getMonth()], { val: state_val, ack: true });

			// Quarter
			state_val = (quarter_bval_consumend * cost_unit).toFixed(2);
			this.log.debug("calculated cost quarter : " + state_val);
			this.setState(obj_root + cost_t + "04_current_quarter", { val: state_val, ack: true });

			// Year
			state_val = (year_bval_consumend * cost_unit).toFixed(2);
			this.log.debug("calculated cost year : " + state_val);
			this.setState(obj_root + cost_t + "05_current_year", { val: state_val, ack: true });
		}
		this.log.debug("Meter Calculation executed");
	}

	defineUnit(obj) {

		const inst_name = this.namespace;
		const obj_cust = obj.common.custom[inst_name];
		let unit = "";

		// Check if unit is defined in state object, if not use custom value
		if (obj.common.unit !== undefined) {
			unit = obj.common.unit.toLowerCase().replace(/\s|\W|[#$%^&*()]/g, "");
		} else if (obj_cust.state_unit !== undefined && obj_cust.state_unit !== "automatically") {
			// Replace meassurement unit when selected in state setting
			unit = obj_cust.state_unit.toLowerCase();
			this.log.debug("Unit of state origing change to : " + unit);
		} else {
			this.log.error("Identifying unit failed, please ensure state has a propper unit assigned or the unit is manually choosen in state settings !");
		}

		return unit;

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
