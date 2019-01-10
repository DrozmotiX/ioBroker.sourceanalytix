# ioBroker.powermonitor


## Published code is currenlty in ALPHA state and only test-objects of discovergy demo account are hard-coded implemented (see to-do !)
## first beta release for community testing expected by end of week 2 2019 ;-)


# Warning, this adapter needs node 8 or higher !!!

ioBroker Power Monitor allows you to keep track & trace power consumption for your devices.
You need data as input (total amount of Wh used) from your devices and this adapter will :

* Trace power usage daily, weekly, monthly, quarterly, yearly
* calculate costs (current price is configurable)
* Can be used for Power Consumption and GAS
* Input values can be wh/kWh/m3

This adapter has is roots with thanks to pix back in 2016 
https://forum.iobroker.net/viewtopic.php?f=21&t=2262

Which has been improved by @hadering and published on github
https://github.com/hdering/homematic_verbrauchszaehler

## To-Do
* [x] ready state values and store to states
* [x] write meter value to "start" state to use in calculations
* [x] consumption calculation
* [x] cost calculation
* [x] adjustable starting point of meassurement
* [x] support of multiple device states
* [ ] recalcalation based on meter values (configurable by date)
* [ ] ensure all values are stored when adapter shuts down to prevent data gaps
* [ ] better logic to reset start values to cover possible issue when adapter is not running during midnight
* [ ] configuration in adapter settings (currently only demo objects of discovergy are supported)
* [ ] configurable cost price for every state
* [ ] configurable unit price for every state
* [x] configurable intervall for every state
* [ ] configurable unit for every state
* [ ] storage of meter values for every state
* [ ] calculations for quarter values
* [ ] configurable data points (yes/no) for cost and meter-values
* [ ] calculation for wh/h values
* [ ] test/implementation of liter & m3 values
* [ ] code optimalisation
* [ ] add object states for previous [x]day, [x]week, [x]month, [x]quarter, [x]year configurable in adapter settings

## Changelog

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