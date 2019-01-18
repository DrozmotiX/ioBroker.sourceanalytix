const utils = require("@iobroker/adapter-core");
const test_Object_list = require('./lib/test_Object_list');
const translate = require('./lib/words');
// Lets make sure we know all days and months
const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');
const history    = {};
const aliasMap   = {};
let state_set = [];
let logging;

// Time Modules
const cron = require('node-cron'); // Cron Scheduler
// const moment = require('moment-quarter'); // Quarter of year

// Create the adapter and define its methods
const adapter = utils.adapter({
	name: "sourceanalytix",

	// ready: main, // Initializ all objetc at adapter start
	ready: update_states_all, // Initializ all objetc at adapter start

	// is called when adapter shuts down - callback has to be called under any circumstances!
	unload: (callback) => {
		try {
			adapter.log.warn("Adapter SourceAnalytix stopped !");
			
			// Add functionality to sync values at adapter stop
			
			callback();
		} catch (e) {
			callback();
		}
	},

	// To-Do, initialise new state
	objectChange: (id, obj) => {


		try {
			// Start initializing & intervall when new object is added to SourceAnalytix
			//@ts-ignore obj is  not undefined or null and common.custom exists
			if (obj.common.custom !== null  && obj.common.custom !== undefined) {
				// The object was changed
				const inst_name = adapter.namespace; 

				adapter.log.info("new state : " + id + " added to SourceAnalytix");
				adapter.getForeignObject(id, function (err, obj){

					if (obj !== undefined && obj !== null){
						state_set.push(obj);
						initialize;
					};
				});
				// initialize(obj)

			} else {
				// The object was deleted
				// adapter.log.info(`object ${id} deleted`);
			}
		} catch (error) {
				
		}			
	},
	
});

function update_states_all (){ 
	// clean variable
	state_set = [];
	// Adopt logging setting from configuration
	logging = adapter.config.developer_logging;
	
	// // initialize all SourceAnalytix enabled states
	// adapter.log.info("Update state settings");
	
	// read all objects and get list of SourceAnalytix enabled states
	//@ts-ignore {} not recognized must me fixed in template
	adapter.objects.getObjectView('custom', 'state', {}, (err, doc) => {
		let count = 0;
		if (doc && doc.rows) {
			for (let i = 0, l = doc.rows.length; i < l; i++) {
				if (doc.rows[i].value) {
					let id = doc.rows[i].id;
					const realId = id;
					if (doc.rows[i].value[adapter.namespace] && doc.rows[i].value[adapter.namespace].aliasId) {
						aliasMap[id] = doc.rows[i].value[adapter.namespace].aliasId;
						adapter.log.debug('Found Alias: ' + id + ' --> ' + aliasMap[id]);
						id = aliasMap[id];
					}
					history[id] = doc.rows[i].value;

					if (history[id].enabled !== undefined) {
						history[id] = history[id].enabled ? {'history.0': history[id]} : null;
						if (!history[id]) {
							adapter.log.info("undefined id");
							// delete history[id];
							continue;
						}
					}
					if (!history[id][adapter.namespace] || history[id][adapter.namespace].enabled === false) {
						// delete history[id];
					} else {
						count++;
						adapter.getForeignObject(id, function (err, obj){

							if (obj !== undefined && obj !== null){
								//  adapter.log.info('Activate SourceAnalytix for : ' + obj._id);
								// Push item into variable array

								// for 0.3.0 : Optimise, only run initialisation for newly added items not all
								// build check to verify

								state_set.push(obj);
								initialize(obj);
								// adapter.log.info(JSON.stringify(state_set));
							};
						});
					};
				};
			};	
		};

		// Start intervall for state calculations
		// to be improved in release
		const interval_timer = setInterval(function () {
			calc_intervall()
		}, 5000);

	});	
	adapter.subscribeForeignObjects("*");
}

// Run calculations
function calc_intervall(){
	if(logging === true){"Calculation handling started"};
	for (const i in state_set){
		if(logging === true){"Handle calculation for state : " + state_set[i]};
		if(logging === true){adapter.log.info(JSON.stringify(state_set[i]));};
		calculation_handler(state_set[i]);
	};
	adapter.log.info(JSON.stringify(state_set));
}

// Initialise all states
function test_initialise(){
	if(logging === true){"Calc intervall state list overview: " + adapter.log.info(JSON.stringify(state_set));};
	for (const i in state_set){
		if(logging === true){adapter.log.info(JSON.stringify(state_set[i]));};
		calculation_handler(state_set[i]);
	};
}

// Create object tree and states for all devices to be handled
function initialize(obj) {
	const inst_name = adapter.namespace
	
	// adapter.log.info(JSON.stringify(obj));
	adapter.log.info('Activate SourceAnalytix for : ' + obj._id);
	// calculate interval from minutes to milliseconds
	const id = obj._id;
	const obj_cust = obj.common.custom[inst_name];
	//@ts-ignore intervall is always a number
	const intervall = (adapter.config.intervall * 60000);
	// adapter.log.info("Intervall : " + intervall);
	let unit = obj.common.unit;
	if(logging === true){adapter.log.info("Device : " + id + " with intervall : " + intervall + " and unit : " + unit);};
	if(logging === true){adapter.log.info("instanze name : " + inst_name);};

	// const obj_cust = adapter.config.custom;
	if(logging === true){adapter.log.info(JSON.stringify(obj_cust));};

	if(logging === true){adapter.log.info("Custom object tree : " + JSON.stringify(obj_cust));};

	// Currently only support kWh & m3)
	if((unit == "kWh") || (unit == "m3") || (unit == "Wh") || (unit == "l")){

		if(unit === "Wh"){unit = "kWh"};
		if(unit === "l"){unit = "m3"};

		// replace "." in datapoints to "_"
		const device = id.split(".").join("__");

		if(logging === true){adapter.log.info("Changed Device Name : " + device);};

		// 	// Set type to consume or deliver
		let delivery;
		if(logging === true){adapter.log.info("Delivery type = : " + delivery);};

		if (obj_cust.state_type == "kWh_delivery") {
			delivery = true;
		} else {
			delivery = false;
		};
		
		// define device name, change with alias when required
		let alias = obj.common.name;
		if(logging === true){adapter.log.info("Device name = : " + alias);};
		if(logging === true){adapter.log.info("State alias name = : " + obj_cust.alias);};
		if(obj_cust.alias !== undefined) {alias = obj_cust.alias};
		
		
		// Create new device object for every state in powermonitor tree
		adapter.setObjectNotExists(device, {
			type: "device",
			common: {
				name: alias
			},
			native: {},
		});

		// change device name when alias is updated
		let objekt = {};
		objekt.common = {
			name: alias
			};
			adapter.extendObject(device, objekt, function (err) {		
		});		

		if(logging === true){adapter.log.info("Customized Device name = : " + alias);};

		if(logging === true){adapter.log.info("Days ? : " + adapter.config.store_days);};
		if(logging === true){adapter.log.info("Consumption ?  : " + obj_cust.consumption);};
		if(logging === true){adapter.log.info("Costs : " + obj_cust.costs);};
		if(logging === true){adapter.log.info("Meter History ? : " + obj_cust.meter_values);};

		if (adapter.config.store_days === true) {
			if(logging === true){adapter.log.info("Creating weekdays");};
			// create states for weekdays
			for (const x in weekdays){
				let curent_day = ".current_year.this_week." + weekdays[x];
				// doStateCreate(delivery, device, curent_day , weekdays[x], "number","value.day", unit, obj_cust.consumption, obj_cust.CalcCost, obj_cust.meter_values);
				doStateCreate(delivery, device, curent_day , weekdays[x], "number","value.day", unit, obj_cust.consumption, obj_cust.costs, obj_cust.meter_values);
			};
		};

		if (adapter.config.store_weeks) {
			// create states for weeks
			let weeknr;
			for (let y = 1; y < 54; y++) {
				if ( y < 10 ) {
					weeknr = "0" + y;
				} else {
					weeknr = y;
				}
				let state_root = ".current_year.weeks." + weeknr;
				doStateCreate(delivery,device,state_root , "week " + weeknr, "number","value.day", unit, obj_cust.consumption, obj_cust.costs, obj_cust.meter_values);
			};
		};

		if (adapter.config.store_months) {
			// create states for months
			for (const x in months){
				let curent_day = ".current_year.months." + months[x];
				doStateCreate(delivery,device,curent_day , months[x], "number","value.month", unit, obj_cust.consumption, obj_cust.costs, obj_cust.meter_values);
			};
		};

		// create state for current day/week/quarters/month current value
		let state_root = ".01_current_day";
		if (adapter.config.store_days === true){doStateCreate(delivery,device,state_root , "current Day ", "number","value.day", unit, obj_cust.consumption, obj_cust.costs, false);};
		state_root = ".02_current_week";
		if (adapter.config.store_weeks === true){doStateCreate(delivery,device,state_root , "current Week ", "number","value.week", unit, obj_cust.consumption, obj_cust.costs, false);};
		state_root = ".03_current_month";
		if (adapter.config.store_months === true){doStateCreate(delivery,device,state_root , "current Month ", "number","value.month", unit, obj_cust.consumption, obj_cust.costs, false);};
		state_root = ".04_current_quarter";
		if (adapter.config.store_quarters === true){doStateCreate(delivery,device,state_root , "current Quarter", "number","value.quarter", unit, obj_cust.consumption, obj_cust.costs, false);};
		state_root = ".05_current_year";
		if (adapter.config.store_years === true){doStateCreate(delivery,device,state_root , "current Year", "number","value.year", unit, obj_cust.consumption, obj_cust.costs, false);};

		state_root = ".Current_Reading";
		doStateCreate(delivery,device,state_root , "Current Reading", "number","value.current", unit, false, false, obj_cust.meter_values);

		adapter.log.info("Initialization finished for : " + device)
		// Write state values first time
		// Meter_Calculations(obj);

	// 	// Start intervall for state calculations
	// 	const interval_timer = setInterval(function () {
	// 		if(logging === true){adapter.log.info('`interval run` for : ' + obj._id);};
	// 		Meter_Calculations(obj);
	// 	}, interval);

	// 	// start cron to reseet counters at midnight
	// 	reset_shedules(obj);

	} else {
		adapter.log.error("Sorry unite type " + unit + " not supported yet");
	}
}


// ######################

// Calculation handler
async function calculation_handler(id){
	const inst_name = adapter.namespace
	let cost_t, del_t,state_val;
	const date = new Date();
	let cost_basic;
	let cost_unit;
	if(logging === true){adapter.log.info("Write calculations for : " + id._id);};

	// replace "." in datapoints to "_"
	const obj_id = id._id.split(".").join("__");
	const obj_root = adapter.namespace + "." + obj_id;  

	// Get current value from meter
	const reading = await adapter.getForeignStateAsync(id._id);
	const calc_reading = unit_calc_fact(id, reading.val);

	if(logging === true){adapter.log.info("Meter current reading : " + reading.val);};

	const obj_cont = await adapter.getForeignObjectAsync(id._id);
	//@ts-ignore custom does exist
	const obj_cust = obj_cont.common.custom[inst_name];

	// Define whih calculation factor must be used

	switch (obj_cust.state_type) {

		case "kWh_consumption":
				if(logging === true){adapter.log.info("Case result : Electricity consumption");};
				cost_unit = adapter.config.unit_price_power;
				cost_basic = adapter.config.basic_price_power;
			break;

		case "kWh_delivery":
				if(logging === true){adapter.log.info("Case result : Electricity consumption night");};
				cost_unit = adapter.config.unit_price_power_night;
				cost_basic = adapter.config.basic_price_power;
			break;

		case "Electricity delivery":
				if(logging === true){adapter.log.info("Case result : Electricity delivery");};
				cost_unit = adapter.config.unit_price_power_delivery;
				cost_basic = adapter.config.basic_price_power;
			break;
		
		case "gas":
				if(logging === true){adapter.log.info("Case result : Gas");};
				cost_unit = adapter.config.unit_price_gas;
				cost_basic = adapter.config.basic_price_gas;
			break;
		
		case "water_m3":
				if(logging === true){adapter.log.info("Case result : Water");};
				cost_unit = adapter.config.unit_price_water;
				cost_basic = adapter.config.basic_price_water;
			break;
		
		case "oil_m3":
				if(logging === true){adapter.log.info("Case result : Oil");};
				cost_unit = adapter.config.unit_price_oil;
				cost_basic = adapter.config.basic_price_oil

		default:
		adapter.log.error("Error in case handling of cost type identificaton" + obj_cust.state_type);
	};

	if(logging === true){adapter.log.info("Handle cost calculations : " + obj_cust.costs);};
	if(logging === true){adapter.log.info("Calculation Factor : " + cost_unit);};
	if(logging === true){adapter.log.info("Cost basic : " + cost_basic);};
	if(logging === true){adapter.log.info("Cost unit : " + cost_unit);};
	if(logging === true){adapter.log.info("Handle consumption calculations : " + obj_cust.consumption);};
	if(logging === true){adapter.log.info("Handle meter history : " + obj_cust.meter_values);};

	// temporary set to sero, this calue will be used later to handle period calculations
	const reading_start = 0; 	//obj_cust.start_meassure; 
	const day_bval = obj_cust.start_day;
	const week_bval = obj_cust.start_week;
	const month_bval = obj_cust.start_month;
	const quarter_bval = obj_cust.start_quarter;
	const year_bval = obj_cust.start_year;

	if(logging === true){adapter.log.info("reading_start : " + reading_start);};
	if(logging === true){adapter.log.info("day start : " + day_bval);};
	if(logging === true){adapter.log.info("week start : " + week_bval);};
	if(logging === true){adapter.log.info("month start " + month_bval);};
	if(logging === true){adapter.log.info("quarter start " + quarter_bval);};
	if(logging === true){adapter.log.info("year start : " + year_bval);};

	// set correct naming for cost & delivery based on type
	if(obj_cust.state_type == "kWh_delivery"){
		cost_t =  ".earnings.";
		del_t = ".delivery.";
	} else {
		cost_t = ".cost.";
		del_t = ".consumption.";
	}

	if(obj_cust.consumption === true){
		// Store current meter value to state
		adapter.setState(obj_root + ".Meter_Readings.Current_Reading", { val: calc_reading.toFixed(3) ,ack: true });
		
		// Calculate consumption
		// Weekday & current day
		state_val = ((calc_reading - day_bval) - reading_start).toFixed(3);

		adapter.log.error(obj_root);
		adapter.log.error(del_t);
		adapter.log.error("01_current_day");

		if(logging === true){adapter.log.info("calculated reading day : " + state_val);};
		adapter.setState(obj_root + del_t + "01_current_day", { val: state_val,ack: true });
		adapter.setState(obj_root + del_t + "current_year.this_week." + weekdays[date.getDay()], { val: state_val ,ack: true });

		// Week
		state_val = ((calc_reading - week_bval) - reading_start).toFixed(3);
		if(logging === true){adapter.log.info("calculated reading week : " + state_val);};
		adapter.setState(obj_root + del_t + "02_current_week", { val: state_val,ack: true });
		adapter.setState(obj_root + del_t + "current_year.weeks." + getWeekNumber(new Date()), { val: state_val,ack: true });

		// Month
		state_val = ((calc_reading - month_bval) - reading_start).toFixed(3);
		if(logging === true){adapter.log.info("calculated reading month : " + state_val);};
		adapter.setState(obj_root + del_t + "03_current_month", { val: state_val,ack: true });
		adapter.setState(obj_root + del_t + "current_year.months." + months[date.getMonth()], { val: state_val,ack: true });

		// Quarter
		state_val = ((calc_reading - quarter_bval) - reading_start).toFixed(3);
		if(logging === true){adapter.log.info("calculated reading quarter : " + state_val);};
		adapter.setState(obj_root + del_t + "04_current_quarter", { val: state_val,ack: true });

		// Year
		state_val = ((calc_reading - year_bval) - reading_start).toFixed(3);
		if(logging === true){adapter.log.info("calculated reading day : " + state_val);};
		adapter.setState(obj_root + del_t + "05_current_year", { val: state_val,ack: true });
	}

	const day_bval_consumend = ((calc_reading - day_bval) - reading_start);
	const week_bval_consumend =  ((calc_reading - week_bval) - reading_start);
	const month_bval_consumend = ((calc_reading - month_bval) - reading_start);
	const quarter_bval_consumend = ((calc_reading - quarter_bval) - reading_start);
	const year_bval_consumend = ((calc_reading- year_bval) - reading_start);

	if(logging === true){adapter.log.info("day consumed " + day_bval_consumend);};
	if(logging === true){adapter.log.info("week consumed " + week_bval_consumend);};
	if(logging === true){adapter.log.info("month consumed " + month_bval_consumend);};
	if(logging === true){adapter.log.info("quarter consumed " + quarter_bval_consumend);};
	if(logging === true){adapter.log.info("year consumed "+ year_bval_consumend);};


	if(logging === true){adapter.log.info("objroot " + obj_root);};
	if(logging === true){adapter.log.info("cost type " + cost_t);};
	if(logging === true){adapter.log.info("delivery type " + del_t);};
	if(logging === true){adapter.log.info("example state string : " + obj_root + cost_t + "01_current_day");};
	
	if(obj_cust.costs){
		// Weekday & current day
		//@ts-ignore cost_unit is always a number
		state_val = (day_bval_consumend * cost_unit).toFixed(2);};
		if(logging === true){adapter.log.info("calculated cost day : " + state_val);
		adapter.setState(obj_root + cost_t + "01_current_day", { val: state_val,ack: true });
		adapter.setState(obj_root + cost_t + "current_year.this_week." + weekdays[date.getDay()], { val: state_val ,ack: true });
		
		// Week
		//@ts-ignore cost_unit is always a number
		state_val = (week_bval_consumend * cost_unit).toFixed(2);};
		if(logging === true){adapter.log.info("calculated cost week : " + state_val);
		adapter.setState(obj_root + cost_t + "02_current_week", { val: state_val,ack: true });
		adapter.setState(obj_root + cost_t + "current_year.weeks." + getWeekNumber(new Date()), { val: state_val,ack: true });

		// Month
		//@ts-ignore cost_unit is always a number
		state_val = (month_bval_consumend * cost_unit).toFixed(2);};
		if(logging === true){adapter.log.info("calculated cost month : " + state_val);
		adapter.setState(obj_root + cost_t + "03_current_month", { val: state_val,ack: true });
		adapter.setState(obj_root + cost_t + "current_year.months." + months[date.getMonth()], { val: state_val,ack: true });

		// Quarter
		//@ts-ignore cost_unit is always a number
		state_val = (quarter_bval_consumend * cost_unit).toFixed(2);};
		if(logging === true){adapter.log.info("calculated cost quarter : " + state_val);
		adapter.setState(obj_root + cost_t + "04_current_quarter", { val: state_val,ack: true });

		// Year
		//@ts-ignore cost_unit is always a number
		state_val = (year_bval_consumend * cost_unit).toFixed(2);};
		if(logging === true){adapter.log.info("calculated cost year : " + state_val);
		adapter.setState(obj_root + cost_t + "05_current_year", { val: state_val,ack: true });
	}
	if(logging === true){adapter.log.info("Meter Calculation executed");};
};

// Function to handle channel creation
function ChannelCreate (id, channel, name){
	if(logging === true){adapter.log.info("Parent device : " + id);};
	if(logging === true){adapter.log.info("Create channel id : " + channel);};
	if(logging === true){adapter.log.info("Create channel name : " + name);};
	adapter.createChannel(id, channel,{
		"name": name
	});
}

// Function to handle state creation
function doStateCreate(delivery, device, id, name, type,role, unit, head, financial, reading){	
	let head_cathegorie;
	let financiel_cathegorie;

	// create seperate channels for amounts, costs and current value
	if(delivery){
		head_cathegorie = "delivery";
		financiel_cathegorie = "earnings";
	} else {
		head_cathegorie = "consumption";
		financiel_cathegorie = "cost";
	}
		 	
	let object = device + "." + head_cathegorie + id;			

	if (head){
		ChannelCreate(device, head_cathegorie, head_cathegorie);
		adapter.setObjectNotExists(object, {
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
		set_zero_val(object);
	}

	if (financial){
		ChannelCreate(device, financiel_cathegorie, financiel_cathegorie);
		object = device + "." + financiel_cathegorie + id;			

		adapter.setObjectNotExists(object, {
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
		set_zero_val(object);
	}

	if (reading){

	object = device + "." + "Meter_Readings" + id;			
	ChannelCreate(device, "Meter_Readings", "Meter_Readings");
	adapter.setObjectNotExists(object, {
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

	set_zero_val(object);
	}

}

// null values must be set 0 to avoid issue in later processing, def: 0 at object creation possible n js-controler 2.0
async function set_zero_val (id){
	const reading = await adapter.getForeignStateAsync("powermonitor." + adapter.instance + "." + id);
	if (reading === null) {adapter.setState(id, { val: 0, ack: true });}
}

// Function to calculate current week number
function getWeekNumber(d) {
    // Copy date so don't modify original
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    // Get first day of year
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    // Calculate full weeks to nearest Thursday
		//@ts-ignoreTS-ignore
	let weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
	
	if (weekNo < 10){
		//@ts-ignoreTS-ignore
		weekNo = "0" + weekNo;
	}
    // Return array of year and week number
    return [weekNo];
}

// Function to calculate current quarter
function quarter_of_the_year(){
		const date = new Date();
		const m = date.getMonth()+1;
		return Math.ceil(m/3);
}

// Function to reset start values for each day, week, month, quarter, year
async function reset_shedules (id){
	const inst_name = adapter.namespace
//	try {
		// Build object root to handle calculations
		const obj_id = id._id.split(".").join("__");
		const obj_root = "powermonitor." + adapter.instance + "." + obj_id;

		// get current meter value, start value of meassurement & calculate value to write in start states
		const reading = await adapter.getForeignStateAsync(id._id);
		const calc_factor = unit_calc_fact(id);
		const calc_reading = reading.val / calc_factor;

		const obj = {
			common : {
				custom : {
				} 
			}
		};

		// Reset day counter
		cron.schedule("0 0 * * *", function(){
			//	Meter_Calculations(test_Object_list[z].Device);
			// adapter.setState(obj_root + ".Meter_Readings.start_values.01_day", { val: obj_val,ack: true });
			obj.common.custom[inst_name] = {
				start_day : calc_reading
				};
				//@ts-ignore Issue in recognized obj correctly, must be fixed in template
				adapter.extendForeignObject(id._id, obj, function (err) {		
			});
		});
		
		// Reset Week counter
		cron.schedule("0 0 1 * 1", function(){
			// adapter.setState(obj_root + ".Meter_Readings.start_values.02_week", { val: obj_val,ack: true });
			obj.common.custom[inst_name] = {
				start_week : calc_reading
				};
				//@ts-ignore Issue in recognized obj correctly, must be fixed in template
				adapter.extendForeignObject(id._id, obj, function (err) {		
			});
		});
		
		// Reset month counter
		cron.schedule("0 0 1 * *", function(){
			// adapter.setState(obj_root + ".Meter_Readings.start_values.03_month", { val: obj_val,ack: true });
			obj.common.custom[inst_name] = {
				start_month : calc_reading
				};
				//@ts-ignore Issue in recognized obj correctly, must be fixed in template
				adapter.extendForeignObject(id._id, obj, function (err) {		
			});
		});
		
		// Reset quarter counter
		cron.schedule("0 0 1 1,4,7,10 *", function(){
			// adapter.setState(obj_root + ".Meter_Readings.start_values.04_quarter", { val: obj_val,ack: true });
			obj.common.custom[inst_name] = {
				start_quarter : calc_reading
				};
				//@ts-ignore Issue in recognized obj correctly, must be fixed in template
				adapter.extendForeignObject(id._id, obj, function (err) {		
			});
		});
		
		// Reset year counter
		cron.schedule("0 0 1 1 *", function(){
			// adapter.setState(obj_root + ".Meter_Readings.start_values.05_year", { val: obj_val,ack: true });
			obj.common.custom[inst_name] = {
				start_year : calc_reading
				};
				//@ts-ignore Issue in recognized obj correctly, must be fixed in template
				adapter.extendForeignObject(id._id, obj, function (err) {		
			});
		});
	// } catch (error) {
		
	// }
}

function unit_calc_fact (obj, value){

	const unit = obj.common.unit
	let calc_value;

	switch (unit) {

		case "kWh":

			calc_value = value;

		break;

		case "Wh":

			calc_value = value / 1000;

		break;

		case "m3":

			calc_value = value;

		break;
		
		case "l":

			calc_value = value / 1000;

		break;

		default:

			adapter.log.error("Case error : value received for calculation with unit : " + unit + " which is currenlty not (yet) supported")

	}
	return calc_value;
}