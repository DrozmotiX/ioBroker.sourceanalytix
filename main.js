const utils = require("@iobroker/adapter-core");
const test_Object_list = require('./lib/test_Object_list');
const translate = require('./lib/words');
// Lets make sure we know all days and months
const weekdays = JSON.parse('["07_Sunday","01_Monday","02_Tuesday","03_Wednesday","04_Thursday","05_Friday","06_Saturday"]');
const months = JSON.parse('["01_January","02_February","03_March","04_April","05_May","06_June","07_July","08_August","09_September","10_October","11_November","12_December"]');
const state_list = test_Object_list;

// Time Modules
const cron = require("node-cron"); // Cron Scheduler
// const month = require('month');
// const moment = require('moment-quarter'); // Quarter of year

// Create the adapter and define its methods
const adapter = utils.adapter({
	name: "powermonitor",

	ready: initialize, // Initializ all objetc at adapter start

	// is called when adapter shuts down - callback has to be called under any circumstances!
	unload: (callback) => {
		try {
			adapter.log.warn("Powermonitor stopped !");
			
			// Add functionality to sync values at adapter stop
			
			callback();
		} catch (e) {
			callback();
		}
	},
	
});

// Adapter hartbeat
function main (){

	// missing : loop on all devices of object array
	const id = "discovergy.0.1024000034.Power_Total";

	for ( const z in test_Object_list){

		adapter.log.info("Cron shedule startet for device : " + test_Object_list[z].Device);

		// Current version reads values based on crone, later versions seperated intervals by device will be possible
		cron.schedule("*/5 * * * * *", function(){
			Meter_Calculations(test_Object_list[z].Device);
			adapter.log.info("Cron shedule executed for device : " + test_Object_list[z].Device);

		});

	}

	// Reset day counter
	for ( const z in test_Object_list){

		// adapter.log.info("Cron shedule startet for device : " + test_Object_list[z].Device);

		cron.schedule("0 59 23 1/1 * ? *", function(){
			Meter_Calculations(test_Object_list[z].Device);

		});

	}

	// Reset Week counter
	
	// Reset month counter
	
	// Reset quarter counter
	
	// Reset year counter

}

// Create object tree and states for all devices to be handled
function initialize() {

	//Read list of objects to be monitored
	for (const i in state_list){

		const unit = state_list[i].unit

		// if ( i == '0') {

			// Ensure no empty spaces in object tree
			const device = state_list[i].Device.split(".").join("__"); 
			
			// Create seperate device channel in powermonitor object tree
			
			// Temporary set devlivery here until its build into adapter settings
			const delivery = false;

			// Create new device object for every state in powermonitor tree
			adapter.setObjectNotExists(device, {
				type: "device",
				common: {
					name: state_list[i].alias
				},
				native: {},
			});

			// create states for weekdays
			for (const x in weekdays){
				//adapter.log.info("Processing : " + weekdays[x]);
				let curent_day = ".current_year.this_week." + weekdays[x];
				doStateCreate_new(delivery, device, curent_day , weekdays[x], "number","value.day", unit, false, true, true, true);
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
				doStateCreate_new(delivery,device,state_root , "week " + weeknr, "number","value.day", unit, false, true, true, true);
			}

			// create states for months
			for (const x in months){
				//adapter.log.info("Processing : " + months[x]);

				let curent_day = ".current_year.months." + months[x];
				doStateCreate_new(delivery,device,curent_day , months[x], "number","value.month", unit, false, true, true, true);
			}

			// create state for current day/week/quarters/month current value
			let state_root = ".01_current_day";
			doStateCreate_new(delivery,device,state_root , "current Day ", "number","value.day", unit, false, true, true, false);
			state_root = ".02_current_week";
			doStateCreate_new(delivery,device,state_root , "current Week ", "number","value.week", unit, false, true, true, false);
			state_root = ".03_current_month";
			doStateCreate_new(delivery,device,state_root , "current Month ", "number","value.month", unit, false, true, true, false);
			state_root = ".04_current_quarter";
			doStateCreate_new(delivery,device,state_root , "current Quarter", "number","value.quarter", unit, false, true, true, false);
			state_root = ".05_current_year";
			doStateCreate_new(delivery,device,state_root , "current Year", "number","value.year", unit, false, true, true, false);

			state_root = ".Current_Reading";
			doStateCreate_new(delivery,device,state_root , "Current Reading", "number","value.quarter", unit, false, false, false, true);

			state_root = ".Reading_start";
			doStateCreate_new(delivery,device,state_root , "Start Value Reading", "number","value.quarter", unit, true,false, false, true);

			state_root = ".start_values.01_day";
			doStateCreate_new(delivery,device,state_root , "Meter reading at day start", "number","value.day", unit, false, false, false, true);
			state_root = ".start_values.02_week";
			doStateCreate_new(delivery,device,state_root , "Meter reading at week start", "number","value.week", unit, false, false, false, true);
			state_root = ".start_values.03_month";
			doStateCreate_new(delivery,device,state_root , "Meter reading at month start", "number","value.month", unit, false, false, false, true);
			state_root = ".start_values.04_quarter";
			doStateCreate_new(delivery,device,state_root , "Meter reading at quarter start", "number","value.quarter", unit, false, false, false, true);
			state_root = ".start_values.05_year";
			doStateCreate_new(delivery,device,state_root , "Meter reading at year start", "number","value.year", unit, false, false, false, true);
		// }
	}
	main();
}


async function Meter_Calculations(id){

	const date = new Date();

	// Write current Meter value to variables
	const obj_id = id.split(".").join("__");
	const obj_root = "powermonitor." + adapter.instance + "." + obj_id;  

	const reading = await adapter.getForeignStateAsync(id);
	const reading_start = await adapter.getForeignStateAsync(obj_root + ".Meter_Readings.Reading_start");
	const day_bval = await adapter.getForeignStateAsync(obj_root + ".Meter_Readings.start_values.01_day");
	const week_bval = await adapter.getForeignStateAsync(obj_root + ".Meter_Readings.start_values.02_week");
	const month_bval = await adapter.getForeignStateAsync(obj_root + ".Meter_Readings.start_values.03_month");
	const quarter_bval = await adapter.getForeignStateAsync(obj_root + ".Meter_Readings.start_values.04_quarter");
	const year_bval = await adapter.getForeignStateAsync(obj_root + ".Meter_Readings.start_values.05_year");

	// Write all current readings and calculations for meters 

	// Store current meter value
	adapter.setState(obj_root + ".Meter_Readings.Current_Reading", { val: reading.val.toFixed(2) ,ack: true });
	// Calculate consumption
	// Weekday & current day
	let state_val = ((reading.val - day_bval.val) - reading_start.val).toFixed(2);
	adapter.log.warn(JSON.stringify(reading));
	adapter.setState(obj_root + ".consumption.01_current_day", { val: state_val,ack: true });
	adapter.setState(obj_root + ".consumption.current_year.this_week." + weekdays[date.getDay()], { val: state_val ,ack: true });

	// Week
	state_val = ((reading.val - week_bval.val) - reading_start.val).toFixed(2);
	adapter.setState(obj_root + ".consumption.02_current_week", { val: state_val,ack: true });
	adapter.setState(obj_root + ".consumption.current_year.weeks." + getWeekNumber(new Date()), { val: state_val,ack: true });

	// Month
	state_val = ((reading.val - month_bval.val) - reading_start.val).toFixed(2);
	adapter.setState(obj_root + ".consumption.03_current_month", { val: state_val,ack: true });
	adapter.setState(obj_root + ".consumption.current_year.months." + months[date.getMonth()], { val: state_val,ack: true });

	// Quarter
	state_val = ((reading.val - quarter_bval.val) - reading_start.val).toFixed(2);
//	adapter.setState(obj_root + ".consumption.current_year.04_current_quarter", { val: state_val,ack: true });

	// Year
	state_val = ((reading.val - year_bval.val) - reading_start.val).toFixed(2);
	adapter.setState(obj_root + ".consumption.05_current_year", { val: state_val,ack: true });
 
	
	// Calculate costs
	const cost_basic = 21;
	const cost_unit = 0.27;

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
//	adapter.setState(obj_root + ".cost.current_year.04_current_quarter", { val: state_val,ack: true });

	// Year
	state_val = (year_bval_consumend.val * cost_unit).toFixed(2);
	adapter.setState(obj_root + ".cost.05_current_year", { val: state_val,ack: true });
 
};


function ChannelCreate (id, channel, name){
	adapter.createChannel(id, channel,{
		"name": name
	});
}

//Function to handle state creation
function doStateCreate(id, name, type,role, unit, write) {
	adapter.setObjectNotExists(id, {
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

	// adapter.log.error("state creation function" + id);

	set_zero_val(id);

}

//Function to handle state creation
function doStateCreate_new(delivery, device, id, name, type,role, unit, write, head, financial, reading) {
				
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