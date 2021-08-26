# SourceAnalytix

[![NPM version](http://img.shields.io/npm/v/iobroker.sourceanalytix.svg)](https://www.npmjs.com/package/iobroker.sourceanalytix)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sourceanalytix.svg)](https://www.npmjs.com/package/iobroker.sourceanalytix)
![Number of Installations (latest)](http://iobroker.live/badges/sourceanalytix-installed.svg)
![Number of Installations (stable)](http://iobroker.live/badges/sourceanalytix-stable.svg)
[![Dependency Status](https://img.shields.io/david/DrozmotiX/iobroker.sourceanalytix.svg)](https://david-dm.org/DrozmotiX/iobroker.sourceanalytix)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/sourceanalytix/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![NPM](https://nodei.co/npm/iobroker.sourceanalytix.png?downloads=true)](https://nodei.co/npm/iobroker.sourceanalytix/)  
![Test and Release](https://github.com/DrozmotiX/ioBroker.coronavirus-statistics/workflows/Test%20and%20Release/badge.svg)   

**This adapter uses the service [Sentry.io](https://sentry.io) to automatically report exceptions and code errors and new device schemas to me as the developer.** More details see below!

Detailed analysis of your Energy, gas and liquid consumptions
Any source (kWh, Wh, Watt, l/h or m3) can be used for data analyses:

## Features

#### Basic features
| state | functionality | Description |
|--|--|--|
| >device<.cumulativeReading |  [accumulate values](#cumulativereading) | Calculate cumulated values <br/> including [transformation](#valuetransformation) <br/>cumulated value can be change by following [these steps](#cumulativereading-reset) |
| >Device<.>Year<.>Year statistics< | [Yearly statistics](#year-statistics) | Store statistic information of the Year at level <br/> >device.>thisYear<.>selected period< |
| >Device<.>Year<.>currentYear | [Current Year statistics](#current-period)  | Store statistic information of the current Year at level <br/> >device.>currentYear<.>selected period< |
| >Year<.>currentYear.>Consumption type < | [Consumption](#consumptioncalculation) | Root folder to store consumption data <br/> (current value - previous value). <br/> Can be consumption or delivery |
| >Year<.>currentYear.>Cost type < | [Costs](#costcalculation) | Root folder to store cost data. <br/> current value * cost + basic price <br/> Can be consumption or delivery |

All state locations are grouped by state name and separated in period and [Category](#categories) structures. <br/> 
Calculations will be automatically handled and values transformed to the proper unit  as defined in [Price-Definitions](#price-definitionsprice-definitions).

If you have any issues, please read the **[Troubleshooting](#troubleshooting)** first!

## How-To

### State-Activation 

![Main Settings](admin/readmeDocu/settingKey.png)

![Main Settings](admin/readmeDocu/stateSettings.png)

| Configuration Item | Description |
|--|--|
| enabled | Activate state for SourceAnalytix | 
| Alias | default: name of state, Name of device as shown in SA|
| Select Type | mandatory, choose you calculation type to calculate according [Price-Definitions](#price-definitions) |
| Select Unit | default: automatically, choose manually if needed (see logs) |
| Costs       | Cost calculation |
| with(out) basic charge  | incl;ude basic charge in cost calculation |
| consumption | calculate consumption data |
| counter values | store current counter values |
| Meter reading at <br/> 
  beginning of x : | Start value of counter for specific period to handle <br/> calculation current - startValue|

### Basic configuration (adapter instance)
![Main Settings](admin/readmeDocu/mainSettings.png)

#### cumulativeReading
*ToDo : Describe logic*

#### consumptionCalculation
*ToDo : Describe logic*

#### costCalculation
*ToDo : Describe logic*
 
#### valueTransformation
*ToDo : Document link to library (document lib also !)*<br/>
*ToDo : Document watt to kWh transformation*<br/>
*ToDo : Document unit transformation (like Watt, to Wh to KWh)*

#### Year-Statistics
Store statistic information of consumption/prices and/or costs/earnings at the Year level <br/> 
> >device.>thisYear<.>category<.>selected period

This information is typically used for data storage and historical comparisons. <br/>
States are grouped by specified period
(like year 2020 vs 2021, ore february 2019 vs february ect)

>#### *Weeks* <br/>
  >Device<.>Year<.>costs/earnings <br/> 
> consumption/delivery<.weeks.**weekNr**<
>#### *Months* <br/>
  >Device<.>Year<.>costs/earnings <br/> 
> consumption/delivery<.months.**Month**<
>#### *Quarters* <br/>
  >Device<.>Year<.>costs/earnings <br/> 
> consumption/delivery<.quarters.**Qx**<

#### Current-Period
Store statistic information of the current Year at level :
>device.>currentYear<.>selected period

>#### *Weeks* <br/>
  >Device<.>Year<.>costs/earnings <br/> 
> consumption/delivery<.weeks.**weekNr**<
>#### *Months* <br/>
  >Device<.>Year<.>costs/earnings <br/> 
> consumption/delivery<.months.**Month**<
>#### *Quarters* <br/>
  >Device<.>Year<.>costs/earnings 
  > consumption/delivery<.quarters.**Qx**<

This information is typically used for daily/weekly/monthly calculation of <br/> 
costs/earnings and/or consumption/delivery grouped by specified period

>ToDo : Add screenshots<

#### Categories
| category | type | Description |
|--|--|--|
| costs | financial | Result of calculation value * cost price + basic price |
| earnings | financial | Result of calculation value * earning price + basic price |
| consumption | calculations | Result of calculation value as cost - start value <br/>  of Year/Month/Quarter  etc |
| delivery | calculations | Result of calculation value as delivery - start value <br/>  of Year/Month/Quarter  etc |

### Troubleshooting

Before we start troubleshooting, it's important to understand how source analytix initialises as here errors may occur, see issue section.
The following sequence will be handled :

1) Start SourceAnalytix
2) List all states activated for SourceAnalytix
3) Initiate states, for each state :
    * Read current cumulatedReading <br/>
      (if present) and memory values from state
    * Check if unit can be handled {Issue 1}
    * Check if cost type is chosen {Issue 2}
    * Verify if valid price definition is present for cost type {Issue 3}
    * Check if previous init value > current cumulated value {Issue 4}
    * Check if valid known of previous device reset > current cumulated value {Issue 5}
    * Store all data to memory
4) Initialise states for each state :
    * create state cumulativeReading (to store results  of calculation, can also be used for W to kWh only) {Issue 6}
    * create states as chosen in state configuration {Issue 7}
    * start calculation
5) On state change/update
    * Verify if information is correct 
    * transform value to proper unit (unit of state to unit chosen in state configuration)
    * check if value input is correct ( current value **>** previousInit value) {See **7 At device reset** Issue 8}
    * calculate {Issue 9}
      * For Watt : calculate Watt to kWh ,calculate cumulatedReading = currentReading + cumulatedReading
      * For other : calculate cumulatedReading = currentReading + previousDeviceReset (if present)
6) At night (00.00)
    * List all SourceAnalytix enabled states
    * Reset start (Day/Week/Year/Month) values
7) At device reset
    * Store current value as previousDeviceReset and previousInit value <br/>
      If the device wil be reset again (detected by previousInit value),<br/> 
      currentReading + previousDeviceReset is stored as to previousDeviceReset.

**Issue 1** No unit defined for ....., cannot execute calculations<br/>
    Please select correct unit in state settings

**Issue 2** No cost type defined for ....., please Select Type of calculation at state setting<br/>
    Please selected wanted cost-type for to understand what amount should be used to handle calculations

**Issue 3** Selected Type ... does not exist in Price Definitions<br/>
    Now Price definitions are found for the chosen cost type, please verify your price setting (adapte config)

**Issue 4** Check settings for ..... ! Known init value : ..... > known cumulative value ..... cannot proceed<br/>
    The known init value > known cumulated values, this can be solved by removing or modifying these objects in the state raw object
    ```"valueAtDeviceInit": xxxx```

**Issue 5** Check settings for ..... ! Known valueAtDeviceReset : ..... > known cumulative value ..... cannot procee<br/>
    The known init value > known cumulated values, this can be solved<br/>
removing or modifying these objects in the state raw object
    ```valueAtDeviceReset": xxxx```

**Issue 6** State for cumulativeReading is not created<br/>
    Initialisation of state did fail, see issue 1 to 5

**Issue 7** States for costs readings ae not created<br/>
    Type of calculation is not enabled in state settings
![Main Settings](admin/readmeDocu/stateSettings.png)

### Price-Definitions
![Main Settings](admin/readmeDocu/priceSettings.png)

**Issue 8** current value **<** previousInit<br/>
A device reset is detected, see function 7

**Issue 9** My calculations are incorrect<br/>
#### cumulativeReading-Reset
  1) Verify if the correct unit is chosen (of not selected, SA will  try to autodetect)
  2) Verify if the cumulatedReading reflects the correct total value of your value reading, if not<br/>
        - Stop SA
        - Go to tab objects
          ![Main Settings](admin/readmeDocu/cumulativeReading-Reset.png)
        - Enter expert mode
        - Change the cumulatedReading
        - Exit expert mode
        - Ensure the start values are set correctly
        - Start SA <br/>
          
  3) Ensure the start values are set correctly<br/>
        SA handles calculations by cumulatedReading - known cumulatedReading at period start.<b/>
        These start values are defined at the state settings and should be < than **currentReading**<br/>
        Please ensure cumulativeReading >= DayStart >= WeekStart >= MonthStart >= QuarterStart >= YearStart
     ![Main Settings](admin/readmeDocu/stateStartValues.png)
     
4) Verify these values in state raw object :
   ```valueAtDeviceReset": xxx```
   ```"valueAtDeviceInit": xxx```

<!--
**Issue 6** Setting - Cannot deactivate state for SourceAnalytix

Im RAW NUR "consumption":false umgestellt, gespeichert. Das wurde behalten (wo ggf. noch nicht false, auch bei "enabled": false und bei "costs": false )
In der Objekt-Übersicht ist der Schraubenschlüssel nachwievor blau. Dann mit dem Schraubenschlüssel in das Objekt, SA war nicht der Haken bei aktiviert drin. Dort einmal auf aktiviert, nicht speichern, wieder auf deaktiviert, speichern.
Kontrolle im RAW, ob SA-EIntrag nun weg => jup, is nun fott
-->

<!--
* Trace consumption daily, weekly, monthly, quarterly, yearly
* calculate costs (current price is configurable)
* Can be used for Power Consumption, liquids, and GAS
* Input values can be wh/kWh/Watt/m3/l
-->

This adapter has is roots with thanks to pix back in 2016 
https://forum.iobroker.net/viewtopic.php?f=21&t=2262

Which has been improved by `@hadering` and published on github
https://github.com/hdering/homematic_verbrauchszaehler

## To-Do
* [ ] Documentation!
* [ ] Period calculation selectable but not yet implemented
* [ ] monthly cost price not yet implemented in calculation
* [ ] recalculation based on meter values (configurable by date)
* [ ] add object states for previous [x]day, [x]week, [x]month, [x]quarter, [x]year configurable in adapter settings

## Support me
If you like my work, please consider a personal donation  
(this is a personal Donate link for DutchmanNL, no relation to the ioBroker Project !)  
[![Donate](https://raw.githubusercontent.com/DrozmotiX/ioBroker.sourceanalytix/master/admin/button.png)](http://paypal.me/DutchmanNL)

## What is Sentry.io and what is reported to the servers of that company?
Sentry.io is a service for developers to get an overview about errors from their applications. And exactly this is implemented in this adapter.

When the adapter crashes or any other Code error happens, this error message that also appears in the ioBroker log is submitted to Sentry. When you allowed iobroker GmbH to collect diagnostic data then also your installation ID (this is just a unique ID **without** any additional infos about you, email, name or such) is included. This allows Sentry to group errors and show how many unique users are affected by such an error. All of this helps me to provide error free adapters that basically never crashs.

<!--
    Placeholder for the next version (at the beginning of the line):
    ### __WORK IN PROGRESS__
-->
## Changelog

### 0.4.12-1 (2021-08-26)
* (DutchmanNL) Add logging to analyse error caught by sentry

### 0.4.12-0 (2021-08-17) Add option to use alias
* (DutchmanNL) Add possibility to use an alternative name (alias)

### 0.4.11 (2021-08-16)
* (DutchmanNL) Improve log/error messages at adapter start
* (DutchmanNL) Bugfix : Cannot read property 'calcValues' of null & related issues found by Sentry

### 0.4.10 (2021-08-10)
* (DutchmanNL) Bugfix : Avoid adapter crash during night for incorrect configured states [#460](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/460)

### 0.4.9 (2021-05-31)
* (DutchmanNL) Added support for Admin 5 (Requires Admin >= 5.1.2)
* (Bluefox) Fix error in admin

### 0.4.8 (2021-01-20)
#### Breaking changes
* (DutchmanNL) Breaking!!! Move current values to currentYear [#135](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/135)
* (DutchmanNL & ToTXR4Y) MajorChange !: Replaced **Current_Reading** with **CumulativeReading** [226](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/226)

#### New Features
* (DutchmanNL) Code cleanup
* (DutchmanNL) Add back "currentYear"
* (DutchmanNL) (debug) Logging improved
* (DutchmanNL) Weekly reset of weekdays
* (DutchmanNL) Calculation for all states
* (DutchmanNL) change default log-level to info
* (DutchmanNL) Calculation for previous states [#242](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/242)
* (DutchmanNL) Optimized error reporting (Sentry)
* (DutchmanNL) Removed unneeded settings in configuration
* (DutchmanNL) Implemented new configuration for "currentYear"
* (DutchmanNL & ToTXR4Y) implement "05_currentYear" in year root folder [#280](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/280)
* (DutchmanNL) Implemented category cumulative values under year statistics
* (DutchmanNL & ToTXR4Y) implement cached memory slot for initialisation value [#226](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/226)
* (DutchmanNL & ToTXR4Y) Implement log messages if state attributes are changed
* (DutchmanNL & ToTXR4Y) Implement automatically detection of currency from admin settings [#247](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/247)

#### BugFixes
* (DutchmanNL) Bugfix : dev: 0 bug workaround
* (DutchmanNL) Do not round cumulated reading
* (DutchmanNL) Bugfix : delete states in create function
* (DutchmanNL) Bugfix : quarters.1 has no existing object
* (DutchmanNL) Bugfix : Calculations for "previous" values
* (DutchmanNL) Bugfix : Incorrect initialisation for states
* (DutchmanNL) Bugfix : Avoid NULL & 0 values at night reset
* (DutchmanNL) Bugfix : 05_currentYear has no existing object
* (DutchmanNL) Bugfix : Avoid calculation of non-Initialised states
* (DutchmanNL) Bugfix : Cannot read property 'stateDetails' of null
* (DutchmanNL) Correct error handling of "Watt" state initialisation
* (DutchmanNL) Bugfix : Ensure a proper reset and init of Watt values
* (DutchmanNL) Bugfix : Avoid loop if init value is set and > reading
* (DutchmanNL) Bugfix : Caught sentry error : Alias xxxxx has no target
* (DutchmanNL & ToTXR4Y) Bugfix : Rebuild calculation logic which solves :
  * Watt values : Ensure proper reading start (0 instead of current watt value)
    Watt values : Ensure proper reading calculation with exponent (0 instead of current watt value) [#281](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/281)
  * All calculations : correct handling  of device reset (if value is reset or 0)
* (DutchmanNL) Bugfix : Incorrect initialisation for Watt values with 0 input
* (DutchmanNL) Bugfix : Only create cumulatedXXX in year statistics if activated
* (DutchmanNL) Bugfix : Incorrect warn message if configuration for objects is changed
* (DutchmanNL) Bugfix : Error {Is not a number, cannot continue calculation} if value =  0
* (DutchmanNL) Bugfix : Throw error if value is NULL for troubleshooting instead of handling incorrect calculation
* (DutchmanNL) Bugfix : Ensure daily reset does not destroy cumulative memory value (Fixes NULL values for Watt after night reset)

### 0.4.7 (2020-09-15) Solved NULL error's & daily resets
* (DutchmanNL) Implement Sentry
* (DutchmanNL) Implement configuration for Price definitions
* (DutchmanNL) Bugfix: NULL value issue  at daily reset
* (DutchmanNL) Bugfix: Issue found in selection of category
* (DutchmanNL) Bugfix: Category issue (read value of undefined)
* (DutchmanNL) Bugfix: Issue in storing meter values by month
* (DutchmanNL) Bugfix: Wrong reading value for Watt initialisation
* (DutchmanNL) Bugfix: Warnings at object creations (js-controller 3.x)
* (DutchmanNL) Bugfix: wrong interpretation of start values at value resets
* (DutchmanNL) Bugfix: Proper error message instead of code crash if no cost type defined
* (DutchmanNL) Add device name for log messages if device value < than currently known value
* (DutchmanNL) Bugfix : Crash at adapter start if chosen Type is not present in instance configuration    

### 0.4.2 (2020-04-12) BugFixes
* (DutchmanNL) Translations updated
* (DutchmanNL) Bugfix : Values do not reset at new day start
* (DutchmanNL) Bugfix : Handle calculations when reading = 0
* (DutchmanNL) Bugfix : Handle calculations at initialisation
* (DutchmanNL) Bugfix : Pause all calculation during day-reset
* (DutchmanNL) Do not calculate values is state is update with same value as previous

### 0.4.0 (2020-04-05) Adapter completely redesigned, please test carefully
* (DutchmanNL) Complete code rebuild
* (DutchmanNL) Change data points to root by year
* (DutchmanNL) Delete unneeded states automatically
* (DutchmanNL) Calculation by quarter implemented
* (DutchmanNL) Storage of meter values implemented
* (DutchmanNL) Rebuild calculation logic to handle in memory instead of object DB (performance)

### 0.3.0   
* (DutchmanNL) m³ Implemented

### 0.2.5
* (xXBJXx) Fix wrong storage of start meter values

### 0.2.41
* (DutchmanNL) Fix wrong storage of daily reset of meter values

### 0.2.3
* (Xoroles & DutchmanNL) fix watt calculation, thank you @Xoroles !

### 0.2.29
* (DutchmanNL) implemented w to kWh calculations :) with thanks to @AlCalzone and @andiling !

### 0.2.276
* (DutchmanNL) implemented meter readings
* (DutchmanNL & @AlCalzone) code improvements & stability
* (DutchmanNL) fix issue with liquid unit reading (m3)

### 0.2.273
* (DutchmanNL) fix issue in daily reset of start values
* (DutchmanNL) Fix badges in readme
* (DutchmanNL) exclude calculations of `w` from current routines (it will be implemented in next versions)

### 0.2.272
* (DutchmanNL) change logic of initialisation
* (DutchmanNL) fix issue in calculation handling
* (DutchmanNL) extract unit definition to central function
* (DutchmanNL) removed "logging to troubleshoot", use "debug" in adapter setting

### 0.2.271
* (DutchmanNL) implement compact mode
* (DutchmanNL) fix testing issues
* (DutchmanNL) fix error "unit" or "tolowercase" is undefined
* (DutchmanNL) fixed installation issues

### 0.2.27
* (DutchmanNL) fixed issue related to multihost installations with slave as target

### 0.2.26
* (DutchmanNL) fixed issue in calculations for gas environments and liquids
* (DutchmanNL) improve logging related to issue analytics

### 0.2.25
* (DutchmanNL) add option in state setting to automatically OR manually choose the measurement unit (for cases device state does not have correct value)

### 0.2.24
* (DutchmanNL) add support for heating pumps
* (DutchmanNL) improvements in adapter configuration screen

### 0.2.2
* (DutchmanNL) fixed reset of start values
* (DutchmanNL) removed uneeded logging "Write calculations for : "
* (DutchmanNL) generic improvement of logging, to see status messages activate it in adapter settings ! Otherwise, only erros will be shown and add/del devices
* (DutchmanNL) improved complete logic of state add/delete/update config in backend which will result in better performance/error handling
* (DutchmanNL) small fixed in configuration screen to show logging options

### 0.2.1
* (DutchmanNL) fixed "current_day" missing in object tree
* (DutchmanNL) fixed log messages "removed from SourceAnalytix"
* (DutchmanNL) fixed unit issue to support upper and lower case in values
* (DutchmanNL) fixed unit issue replace strange characters
* (DutchmanNL) remove intervall setting from configuration screen (handle by state subscription now!)
* (DutchmanNL) remove start measurement from state configuration screen (not need, please use day start, week start etc !)

### 0.2.0
* (DutchmanNL) rebuild logic to calculate values (beta testing)
* (DutchmanNL) implement logic to automatically reset values by start of new day, week, month, year etc (beta testing)
* (DutchmanNL) changed logic from intervall polling to handle calculations based on state updates (beta testing, not if suitable for all situations)
* (DutchmanNL) fixed issue incorrect states are added to monitoring
* (DutchmanNL) fixed issue calculation not stopped when state removed from monitoring
* (DutchmanNL) always store all current measurements to values of categories regardless setting year etc
* (DutchmanNL) code cleanup and optimisation
* (DutchmanNL) added logging option "status notification"
* (DutchmanNL) implement new translation mechanism


### 0.1.9 
* (DutchmanNL) Adapter moved to community development tree
* (DutchmanNL) added npm version and test-status to readme
* (DutchmanNL) finalized new konfiguration screen & translations
* (DutchmanNL) adding/removing objects from analytix does not need adapter reboot anymore ! :-)
* (DutchmanNL) rebuild logic how data is handled as basic for new calculation logic (Experimental)
* (DutchmanNL) added options to year analytics to choose values (days,weeks,years etc)
* (DutchmanNL) option added for Developer logging
* (DutchmanNL) Basic price is currently not considered in cost calculations !
* (DutchmanNL) Values day start, week start etc are currently not automatically set (will be in 0.2.0)


### 0.1.8 (unuasable temporary verion )
* (DutchmanNL) konfiguration pages completely redesigned : Please do not enter values yet !
* (DutchmanNL) master konfiguration added to globally define costs
* (DutchmanNL) intervall settings moved to global setting instead of each state separated
* (DutchmanNL) instead of cost-price in each state use drop down menu to choose values from global settings
* (DutchmanNL) fixed naming and translations

### 0.1.6
* (DutchmanNL) fixed data reset for quarter values (thank you Jens !)
* (DutchmanNL) fixed usage of alias
* (DutchmanNL) fixed issue in calculation of earnings and delivery
* (DutchmanNL) logging improvement
* (DutchmanNL) fixed log messages
* (DutchmanNL) calculation for m3 values
* (DutchmanNL) calculation for l values

### 0.1.5
* (DutchmanNL) improved state write logic, only sent write commando when needed

### 0.1.3
* (DutchmanNL) add support for calculation of Wh values

### 0.1.0
* (DutchmanNL) first public beta release
* (DutchmanNL) fixed translations
* (DutchmanNL) rebuild calculation logic
* (DutchmanNL) fixed calculation of start offset
* (DutchmanNL) adjustable if state is used for consumption or delivery
* (DutchmanNL) limited possible logging to kWh only for this moment
* (DutchmanNL) only create states and channels for logging types selected

### 0.0.9
* (DutchmanNL) fixed wrong calculation of start values
* (DutchmanNL) fixed wrong calculation of quarter values
* (DutchmanNL) prepare public beta and travis testing
* (DutchmanNL) change name to SourceAnalytix
* (DutchmanNL) implemented SourceAnalytix settings at states (equal to data logging adapters)
* (DutchmanNL) configurable unit for every state, automatically from object state. Currently, only kWh supported !

### 0.0.8
* (DutchmanNL) configurable intervall for every state

### 0.0.7
* (DutchmanNL) automated reset of start values

### 0.0.6
* (DutchmanNL) fixed issue with travis build
* (DutchmanNL) fixed wrong information in package-json

### 0.0.4
* (DutchmanNL) cost calculation
* (DutchmanNL) adjustable starting point of measurement
* (DutchmanNL) support of multiple device states instead of 1
* (DutchmanNL) fixed calculation of current consumptions

### 0.0.3
* (DutchmanNL) code optimisation

### 0.0.2
* (DutchmanNL) creation of object structure
* (DutchmanNL) first values read based on test_object.js input file to read values adn write data of current period.s

### 0.0.1
* (DutchmanNL) initial release

## License
MIT License

Copyright (c) 2021 DutchmanNL

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
