const utils = require("@iobroker/adapter-core");
const test_Object_list = require('./lib/test_Object_list');
const translate = require('./lib/words');
// Lets make sure we know all days and months
const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');
const history    = {};
const aliasMap   = {};

// Time Modules
const cron = require('node-cron'); // Cron Scheduler
// const moment = require('moment-quarter'); // Quarter of year

// Create the adapter and define its methods
const adapter = utils.adapter({
	name: "sourceanalytix",

	ready: main, // Initializ all objetc at adapter start

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
			
			// // Start initializing & intervall when new object is added to SourceAnalytix
			// if (obj.common.custom !== null  && obj.common.custom !== undefined) {
			// 	// The object was changed
			// 	const inst_name = adapter.namespace 

			// 	adapter.log.info("new state : " + id + " added to SourceAnalytix")

			// 	adapter.getForeignObject(id, function (err, obj){
			// 		if (obj !== undefined && obj !== null){
			// 			initialize(obj)
			// 		}
			// 	})

			// } else {
			// 	// The object was deleted
			// 	// adapter.log.info(`object ${id} deleted`);
			// }
		} catch (error) {
				
		}			
	},
	
});

// Adapter hartbeat
function main (){ 
	// initialise all SourceAnalytix enabled states
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
								adapter.log.info('Activate SourceAnalytix for : ' + obj._id);
								// create object structure and start interval
								initialize(obj)
								// reset start values for messurement at midnight
								 reset_shedules(obj);
							}
						})
					}
				}
			}
		}
	});	
	
	adapter.subscribeForeignObjects("*");

}

// Create object tree and states for all devices to be handled
function initialize(obj) {
	const inst_name = adapter.namespace
	// calculate interval from minutes to milliseconds
	const interval = (obj.common.custom[inst_name].interval * 60000)
	const unit = obj.common.unit;


	// replace "." in datapoints to "_"
	const device = obj._id.split(".").join("__"); 	

	// adapter.log.info("Initializing ; " + device)

	// Temporary set devlivery here until its build into adapter settings
	const delivery = false;

	// Create new device object for every state in powermonitor tree
	adapter.setObjectNotExists(device, {
		type: "device",
		common: {
			name: obj
		},
		native: {},
	});

	// create states for weekdays
	for (const x in weekdays){
		//adapter.log.info("Processing : " + weekdays[x]);
		let curent_day = ".current_year.this_week." + weekdays[x];
		doStateCreate(delivery, device, curent_day , weekdays[x], "number","value.day", unit, false, true, true, true);
	}

	// create states for weeks
	let weeknr;
	for (let y = 1; y < 54; y++) {
		//adapter.log.info("dataloop : " + y);
		if ( y < 10 ) {
			weeknr = "0" + y;
		} else {
			weeknr = y;
		}
		let state_root = ".current_year.weeks." + weeknr;
		doStateCreate(delivery,device,state_root , "week " + weeknr, "number","value.day", unit, false, true, true, true);
	}

	// create states for months
	for (const x in months){
		//adapter.log.info("Processing : " + months[x]);

		let curent_day = ".current_year.months." + months[x];
		doStateCreate(delivery,device,curent_day , months[x], "number","value.month", unit, false, true, true, true);
	}

	// create state for current day/week/quarters/month current value
	let state_root = ".01_current_day";
	doStateCreate(delivery,device,state_root , "current Day ", "number","value.day", unit, false, true, true, false);
	state_root = ".02_current_week";
	doStateCreate(delivery,device,state_root , "current Week ", "number","value.week", unit, false, true, true, false);
	state_root = ".03_current_month";
	doStateCreate(delivery,device,state_root , "current Month ", "number","value.month", unit, false, true, true, false);
	state_root = ".04_current_quarter";
	doStateCreate(delivery,device,state_root , "current Quarter", "number","value.quarter", unit, false, true, true, false);
	state_root = ".05_current_year";
	doStateCreate(delivery,device,state_root , "current Year", "number","value.year", unit, false, true, true, false);

	state_root = ".Current_Reading";
	doStateCreate(delivery,device,state_root , "Current Reading", "number","value.quarter", unit, false, false, false, true);

	state_root = ".Reading_start";
	doStateCreate(delivery,device,state_root , "Start Value Reading", "number","value.quarter", unit, true,false, false, true);

	state_root = ".start_values.01_day";
	doStateCreate(delivery,device,state_root , "Meter reading at day start", "number","value.day", unit, false, false, false, true);
	state_root = ".start_values.02_week";
	doStateCreate(delivery,device,state_root , "Meter reading at week start", "number","value.week", unit, false, false, false, true);
	state_root = ".start_values.03_month";
	doStateCreate(delivery,device,state_root , "Meter reading at month start", "number","value.month", unit, false, false, false, true);
	state_root = ".start_values.04_quarter";
	doStateCreate(delivery,device,state_root , "Meter reading at quarter start", "number","value.quarter", unit, false, false, false, true);
	state_root = ".start_values.05_year";
	doStateCreate(delivery,device,state_root , "Meter reading at year start", "number","value.year", unit, false, false, false, true);


	// adapter.log.info("Initialisation finished for ; " + device)
	// Write state values first time
	Meter_Calculations(obj);

	// Start intervall for state calculations
	const interval_timer = setInterval(function () {
		adapter.log.info('`interval run` for : ' + obj._id);
		Meter_Calculations(obj);

	}, interval);

}
// Handle all calculations
async function Meter_Calculations(id){
	const inst_name = adapter.namespace
	const date = new Date();

	// Write current Meter value to variables
	const obj_id = id._id.split(".").join("__");
	const obj_root = adapter.namespace + "." + obj_id;  

	const reading = await adapter.getForeignStateAsync(id._id);
	
	// adapter.log.info("Reading start : " + JSON.stringify(id.common.custom[inst_name].start_meassure));
	// adapter.log.info("Reading : " + reading.val);
	// adapter.log.info("Test : " + id.common.custom[inst_name].start_day);

	const obj_cont = await adapter.getForeignObjectAsync(id._id);
	const reading_start = obj_cont.common.custom[inst_name].start_meassure;
	const day_bval = obj_cont.common.custom[inst_name].start_day;
	const week_bval = obj_cont.common.custom[inst_name].start_week
	const month_bval = obj_cont.common.custom[inst_name].start_month
	const quarter_bval = obj_cont.common.custom[inst_name].start_quarter
	const year_bval = obj_cont.common.custom[inst_name].start_year

	// Store current meter value
	adapter.setState(obj_root + ".Meter_Readings.Current_Reading", { val: reading.val.toFixed(2) ,ack: true });
	
	// Calculate consumption
	// Weekday & current day
	let state_val = ((reading.val - day_bval) - reading_start).toFixed(2);
	adapter.setState(obj_root + ".consumption.01_current_day", { val: state_val,ack: true });
	adapter.setState(obj_root + ".consumption.current_year.this_week." + weekdays[date.getDay()], { val: state_val ,ack: true });

	// Week
	state_val = ((reading.val - week_bval) - reading_start).toFixed(2);
	adapter.setState(obj_root + ".consumption.02_current_week", { val: state_val,ack: true });
	adapter.setState(obj_root + ".consumption.current_year.weeks." + getWeekNumber(new Date()), { val: state_val,ack: true });

	// Month
	state_val = ((reading.val - month_bval) - reading_start).toFixed(2);
	adapter.setState(obj_root + ".consumption.03_current_month", { val: state_val,ack: true });
	adapter.setState(obj_root + ".consumption.current_year.months." + months[date.getMonth()], { val: state_val,ack: true });

	// Quarter
	state_val = ((reading.val - quarter_bval) - reading_start).toFixed(2);
	adapter.setState(obj_root + ".consumption.04_current_quarter", { val: state_val,ack: true });

	// Year
	state_val = ((reading.val - year_bval) - reading_start).toFixed(2);
	adapter.setState(obj_root + ".consumption.05_current_year", { val: state_val,ack: true });

	// Calculate costs
	const cost_basic = obj_cont.common.custom[inst_name].basic_price;
	const cost_unit = obj_cont.common.custom[inst_name].unit_price;

	adapter.log.info("Cost basic : " + cost_basic);
	adapter.log.info("Cost unit : " + cost_unit);

	const day_bval_consumend = await adapter.getForeignStateAsync(obj_root + ".consumption.01_current_day");
	const week_bval_consumend = await adapter.getForeignStateAsync(obj_root + ".consumption.02_current_week");
	const month_bval_consumend = await adapter.getForeignStateAsync(obj_root + ".consumption.03_current_month");
	const quarter_bval_consumend = await adapter.getForeignStateAsync(obj_root + ".consumption.04_current_quarter");
	const year_bval_consumend = await adapter.getForeignStateAsync(obj_root + ".consumption.05_current_year");

	// Weekday & current day
	state_val = (day_bval_consumend.val * cost_unit).toFixed(2);

	adapter.setState(obj_root + ".cost.01_current_day", { val: state_val,ack: true });
	adapter.setState(obj_root + ".cost.current_year.this_week." + weekdays[date.getDay()], { val: state_val ,ack: true });

	// Week
	state_val = (week_bval_consumend.val * cost_unit).toFixed(2);
	adapter.setState(obj_root + ".cost.02_current_week", { val: state_val,ack: true });
	adapter.setState(obj_root + ".cost.current_year.weeks." + getWeekNumber(new Date()), { val: state_val,ack: true });

	// Month
	state_val = (month_bval_consumend.val * cost_unit).toFixed(2);
	adapter.setState(obj_root + ".cost.03_current_month", { val: state_val,ack: true });
	adapter.setState(obj_root + ".cost.current_year.months." + months[date.getMonth()], { val: state_val,ack: true });

	// Quarter
	state_val = (quarter_bval_consumend.val * cost_unit).toFixed(2);
		adapter.setState(obj_root + ".cost.04_current_quarter", { val: state_val,ack: true });

	// Year
	state_val = (year_bval_consumend.val * cost_unit).toFixed(2);
	adapter.setState(obj_root + ".cost.05_current_year", { val: state_val,ack: true });
 
};

//Function to handle channel creation
function ChannelCreate (id, channel, name){
	adapter.createChannel(id, channel,{
		"name": name
	});
}

//Function to handle state creation
function doStateCreate(delivery, device, id, name, type,role, unit, write, head, financial, reading) {
				
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

	// const channeldescription  		 
	ChannelCreate(device, head_cathegorie, head_cathegorie);
	ChannelCreate(device, financiel_cathegorie, financiel_cathegorie);

	let object = device + "." + head_cathegorie + id;			

	if (head){

		adapter.setObjectNotExists(object, {
			type: "state",
			common: {
				name: name,
				type: type,
				role: role,
				read: true,
				unit: unit,
				write: write,
				def: 0,
			},
			native: {},
		});
		set_zero_val(object);
	}

	if (financial){

		object = device + "." + financiel_cathegorie + id;			

		adapter.setObjectNotExists(object, {
			type: "state",
			common: {
				name: name,
				type: type,
				role: role,
				read: true,
				unit: "€",
				write: write,
				def: 0,
			},
			native: {},
		});
		set_zero_val(object);
	}

	if (reading){

	object = device + "." + "Meter_Readings" + id;			

	adapter.setObjectNotExists(object, {
		type: "state",
		common: {
			name: name,
			type: type,
			role: role,
			read: true,
			unit: unit,
			write: write,
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

// // Function to calculate current quarter
// function quarter_of_the_year(){
// 		const date = new Date();
// 		const m = date.getMonth()+1;
// 		return Math.ceil(m/3);
// }

// Function to reset start values for each day, week, month, quarter, year
async function reset_shedules (id){
	// adapter.log.error(id._id)
//	try {

		// Build object root to handle calculations
		const obj_id = id._id.split(".").join("__");
		const obj_root = "powermonitor." + adapter.instance + "." + obj_id;

		// get current meter value, start value of meassurement & calculate value to write in start states
		const reading = await adapter.getForeignStateAsync(id);
		const reading_start = await adapter.getForeignStateAsync(obj_root + ".Meter_Readings.Reading_start");
		const obj_val = (reading.val - reading_start.val).toFixed(2);


		// adapter.log.error(id._id)

            adapter.setForeignObject(id._id, {
				common : {
					custom : {
						inst_name : {
							start_month : 9999999
						}
					} 
				}
			}, function (err) {

            });

		// Reset day counter
		cron.schedule("0 0 * * *", function(){
			//	Meter_Calculations(test_Object_list[z].Device);
			adapter.setState(obj_root + ".Meter_Readings.start_values.01_day", { val: obj_val,ack: true });
		});
		
		// Reset Week counter
		cron.schedule("0 0 1 * 1", function(){
			adapter.setState(obj_root + ".Meter_Readings.start_values.02_week", { val: obj_val,ack: true });
		});
		
		// Reset month counter
		cron.schedule("0 0 1 * *", function(){
			adapter.setState(obj_root + ".Meter_Readings.start_values.03_month", { val: obj_val,ack: true });
		});
		
		// Reset quarter counter
		cron.schedule("0 0 1 * *", function(){
			adapter.setState(obj_root + ".Meter_Readings.start_values.04_quarter", { val: obj_val,ack: true });
		});
		
		// Reset year counter
		cron.schedule("0 0 1 1 *", function(){
			adapter.setState(obj_root + ".Meter_Readings.start_values.05_year", { val: obj_val,ack: true });
		});
	// } catch (error) {
		
	// }
}