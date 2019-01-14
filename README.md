#  [Beta - Released] SourceAnalytix

## Warning, this adapter needs node 8 or higher !!!

ioBroker SourceAnalytix allows you to keep track & trace of consumption, cost and meter values for your devices.
You need data as input (total amount of Wh, l/h or m3 used) from your devices and this adapter will :

* Trace comsumption daily, weekly, monthly, quarterly, yearly
* calculate costs (current price is configurable)
* Can be used for Power Consumption, liquids, and GAS
* Input values can be wh/kWh/m3/l

## How-To

* [ ] To-Do

This adapter has is roots with thanks to pix back in 2016 
https://forum.iobroker.net/viewtopic.php?f=21&t=2262

Which has been improved by @hadering and published on github
https://github.com/hdering/homematic_verbrauchszaehler

## Known issues

* [ ] translations
* [ ] quarters not calculated
* [ ] monthly costprice not yet implemented in calculation
* [ ] statest for cost type delivery are not writen
* [ ] device name alias not correct
* [ ] adapter restart needed to add calculation of new objects

## To-Do
* [ ] Documentation
* [ ] recalcalation based on meter values (configurable by date)
* [ ] ensure all values are stored when adapter shuts down to prevent data gaps
* [ ] better logic to reset start values to cover possible issue when adapter is not running during midnight
* [ ] write meter value to object to use in calculations
* [ ] configurable data points (yes/no) for cost and meter-values
* [ ] storage of meter values for every state
* [ ] calculations for quarter values
* [ ] calculation for m3 values
* [ ] test/implementation of liter & m3 values
* [ ] code optimalisation
* [ ] add object states for previous [x]day, [x]week, [x]month, [x]quarter, [x]year configurable in adapter settings
* [ ] compact mode
* [x] add support for calculation of wh/h values
* [x] Fix basic translations
* [x] ready state values and store to states
* [x] write meter value to "start" state to use in calculations
* [x] configurable intervall for every state
* [x] configurable unit for every state
* [x] configurable cost price for every state
* [x] configurable unit price for every state
* [x] state used for cost or earning
* [x] consumption calculation
* [x] cost calculation
* [x] adjustable starting point of meassurement
* [x] support of multiple device states
* [x] configuration in adapter settings (currently only demo objects of discovergy are supported)
* [x] delete temporary states for calculations

## Changelog

### 0.1.1
* (Dutchman) add support for calculation of wh/h values

### 0.1.0
* (Dutchman) first public beta release
* (Dutchman) fix translations
* (Dutchman) rebuild calculation logic
* (Dutchman) fix calculation of start offset
* (Dutchman) adjustable if state is used for cosumption or delivery
* (Dutchman) limited possible logging to kWh only for this moment
* (Dutchman) only create states and channels for logging types selected

### 0.0.9
* (Dutchman) fix wrong calculation of start values
* (Dutchman) fix wrong calculation of quarter values
* (Dutchman) prepare public beta and travis testing
* (Dutchman) change name to SourceAnalytix
* (Dutchman) implemented SourceAnalytix settings at states (equal to data logging adapters)
* (Dutchman) configurable unit for every state, automatically from object state. currently only kWh supported !

### 0.0.8
* (Dutchman) configurable intervall for every state

### 0.0.7
* (Dutchman) automated reset of start values

### 0.0.6
* (Dutchman) fix issue with travis build
* (Dutchman) fix wrong information in package-json

### 0.0.4
* (Dutchman) cost calculation
* (Dutchman) adjustable starting point of meassurement
* (Dutchman) support of multiple device states instead of 1
* (Dutchman) fix calculation of current consumptions

### 0.0.3
* (Dutchman) code optimalisation

### 0.0.2
* (Dutchman) creation of object structure
* (Dutchman) first values read based on test_object.js input file to read values adn write data of current period.s

### 0.0.1
* (Dutchman) initial release

## License
MIT License

Copyright (c) 2018 Dutchman

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