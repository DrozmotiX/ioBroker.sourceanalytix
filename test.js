obj.common = {};
obj.common.custom = {};
	currentValue: reading,
	start_day: reading,
	start_week: beforeReset.week === actualDate.week ? stateValues.start_week : reading,
	start_month: beforeReset.month === actualDate.month ? stateValues.start_month : reading,
	start_quarter: beforeReset.quarter === actualDate.quarter ? stateValues.start_quarter : reading,
	start_year: beforeReset.year === actualDate.year ? stateValues.start_year : reading,
	valueAtDeviceReset: stateValues.valueAtDeviceReset !== undefined ? stateValues.valueAtDeviceReset : 0
};