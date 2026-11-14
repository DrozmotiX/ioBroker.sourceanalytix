# SourceAnalytix

[![NPM version](https://img.shields.io/npm/v/iobroker.sourceanalytix.svg)](https://www.npmjs.com/package/iobroker.sourceanalytix)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sourceanalytix.svg)](https://www.npmjs.com/package/iobroker.sourceanalytix)
[![Number of Installations (latest)](https://iobroker.live/badges/sourceanalytix-installed.svg)](https://iobroker.live)
[![Number of Installations (stable)](https://iobroker.live/badges/sourceanalytix-stable.svg)](https://iobroker.live)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/sourceanalytix/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Test and Release](https://github.com/DrozmotiX/ioBroker.sourceanalytix/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/DrozmotiX/ioBroker.sourceanalytix/actions/workflows/test-and-release.yml)

SourceAnalytix turns meter readings or power values from any ioBroker state into consumption, delivery, costs and earnings per day, week, month, quarter and year.

1. **What it does.** Every source state (energy, gas, water, heat, pulses, …) gets its own device below `sourceanalytix.<instance>` with totals for the current and previous periods, optional weekday, week, month and quarter collections and yearly archives. Meter resets, meter replacements and missed midnight rollovers are handled automatically. Costs follow fixed, scheduled, dynamic (state) or day/night prices, optionally with a monthly basic fee.

2. **Requirements.** Admin 8.0.0 or newer, js-controller 6.0.11 or newer and Node.js 22 or newer.

3. **Installation.** The current version is published in the **latest** (beta) repository. Select the repository "Beta (latest)" in the ioBroker system settings and install SourceAnalytix from the Adapters tab. It moves to the stable repository after a test phase. See [Installation](docs/de/01.erste-schritte/01.installation.md).

4. **Setup in three steps.** Open the instance settings: create a price definition for each tariff, then add a source with "Add source" on the "Overview" tab and check its start values. The wizard and the source detail page cover the everyday settings. Start values of a running source and special options such as pulse counters are still set in the custom settings of the state in the object browser. See [Your first meter](docs/de/01.erste-schritte/02.erster-zaehler.md).

5. **Corrections without scripts.** The source detail page offers "Align meter reading", "Meter swapped", "Recalculate costs from date", "Recover periods", "Deactivate" and "Delete data", each with a preview before anything is changed. The "Problems" tab lists sources that need attention. See [Correcting meter readings](docs/de/02.anleitungen/02.zaehlerstaende-korrigieren.md).

6. **Documentation.** The full documentation is organised by the questions users ask in the forum and in issues. It is currently available in German; the English version follows.
   - [Getting started](docs/de/01.erste-schritte/README.md)
   - [How-to guides](docs/de/02.anleitungen/README.md): sources and units, corrections, prices, evaluation, maintenance
   - [Reference](docs/de/03.referenz/README.md): settings, states and messages
   - [Troubleshooting](docs/de/04.fehlerbehebung/README.md): log messages and wrong values
   - [Background](docs/de/05.hintergrund/README.md): how the adapter calculates

7. **Help and bug reports.** Check the "Problems" tab and the [troubleshooting pages](docs/de/04.fehlerbehebung/README.md) first. Report bugs and feature requests in the [GitHub issues](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues) with a debug log of the affected source.

8. **Error reporting with Sentry.** This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers. When the adapter crashes or another code error occurs, the error message that also appears in the ioBroker log is submitted to Sentry. If you allowed ioBroker GmbH to collect diagnostic data, your anonymous installation ID is included. For details and how to disable error reporting, see the [Sentry plugin documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry). Sentry reporting is used starting with js-controller 3.0.

## Credits

The adapter's roots go back to work by pix in 2016:
[ioBroker forum thread](https://forum.iobroker.net/viewtopic.php?f=21&t=2262)

It was later improved by `@hadering` and published as
[homematic_verbrauchszaehler](https://github.com/hdering/homematic_verbrauchszaehler).

## Support me
If you like my work, please consider a personal donation.

This is a personal donation link for DutchmanNL and is not related to the ioBroker project.

[![Donate](https://raw.githubusercontent.com/DrozmotiX/ioBroker.sourceanalytix/main/admin/button.png)](https://paypal.me/DutchmanNL)

<!--
    Placeholder for the next version (at the beginning of the line):
    ### __WORK IN PROGRESS__
-->
## Changelog
### __WORK IN PROGRESS__
* Power values sent as text with a comma, such as `"1,5"`, are read like meter readings; a value that is not a number is ignored with a warning instead of logging an invalid interval for every value ([#1288](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1288)).
* Settings page: hints name the tab "Price definitions" like the tab itself, "Quarters" is translated as "Quartale", a single comma or dot is always the decimal mark (`1.283` is 1.283 like in the adapter), and the technical ID in the wizard accepts the same characters as the adapter ([#1287](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1287)).
* New instance settings page (requires admin 8): tabs "Overview" and "Problems" with all sources, a wizard to add a source, a detail page per source and actions that work immediately without restart ([#1269](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1269)).
* Action "Align meter reading": set the total to the value the meter shows; today's consumption and closed periods stay unchanged ([#640](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/640)).
* Action "Meter swapped": enter the end reading of the old and the start reading of the new meter, the total continues without a jump ([#1269](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1269)).
* Action "Recalculate costs from date" with the price history, for one source or all sources of a price definition ([#947](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/947)).
* Action "Delete data" removes the output folder of a source incl. all years ([#1265](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1265)).
* Fix wrong conversion between `km³`, `dm³`, `cm³`, `mm³` and between `µm`, `nm`; unit definitions are now part of the adapter and the unmaintained `iobroker-adapter-helpers` dependency was removed ([#1278](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1278)).
* The unit check in the state settings now accepts the same spellings as the adapter (`m3`, `kwh`, `L`, …), so such sources can be saved with "Detect automatically" ([#1278](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1278)).
* Reject sources whose unit cannot be converted to the unit of the selected price definition (for example `W` with `m³` or `kg` with `kWh`) at start with a clear error instead of calculating wrong values or logging an error for every reading ([#1278](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1278)).
* Ignore repeated source-object writes when the SourceAnalytix settings, source name and unit are unchanged, preventing unnecessary output reinitialization and high CPU load ([#1233](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1233)).
* Only write output objects (device, period and memory states) when their definition actually changes, so re-initializing a source updates state values without rewriting the whole object tree ([#1233](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1233)).
* The start values in the state settings are checked before saving: comma and dot are accepted, a start value must not be larger than the current total shown in the dialog, and a period that began earlier cannot have a larger start value than a later one (the week is placed by its start date). Empty fields count from now on. A hint appears when a start value would fit after dividing by 1000 (entered in Wh instead of kWh). Inconsistent start values are also logged at start ([#1267](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1267)).
* All power units (`W`, `kW`, `MW`, …) are handled alike: no start value initialisation from the first reading, and running `kW` intervals are closed at midnight like `W` intervals ([#1267](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1267)).
* New source setting "Maximum gap between power values" for power sources: an interval without a new value that is longer than the setting is not extrapolated with the last power value but counted as 0 and logged, so a device or network outage no longer produces huge consumption and costs. Empty (default) keeps the previous behaviour for devices that only send on change ([#1266](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1266)).
* The state settings show a hint when another source with the same price definition already includes the basic fee, because every such source books the full basic fee; the adapter logs the same hint at start. The calculation is unchanged ([#1268](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1268)).
* New unit `piece` with factor 1 for counters without a physical unit, such as burner starts; the spellings `pcs`, `pc`, `pieces`, `Stk` and `Stück` are recognised, and price definitions can use `piece` ([#304](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/304)).
* Pulse counters: a source with unit `piece` (pulse count) or `piece/min` (pulse rate, integrated over time like power, e.g. ESPHome `pulses/min`) is converted into the unit of the price definition with the new source setting "Pulses per unit of the price definition" (for example 1000 for 1000 imp/kWh) ([#74](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/74)).
* New source setting "Each update adds its value" for data points that send one update per pulse or a consumption increment instead of a meter reading; every update is added, also an unchanged value such as `0.001` kWh per S0 pulse, and `true` counts as one pulse ([#479](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/479)).

### 0.6.1 (2026-11-07)
* (softwarecrash) Apply negative energy deltas from integrated power sources to historical costs instead of mistaking them for cumulative meter resets ([#1242](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1242)).
* (softwarecrash) Prevent a temporary low meter reading followed by a near-return from being counted as a confirmed reset and duplicating consumption; rejected resets are now logged as a warning ([#1227](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1227)).
* (softwarecrash) Keep an existing output tree and restore its effective ID in the source settings when an output-ID change is invalid, unavailable or cannot be migrated; a source without an existing tree is not activated instead of silently starting a new one ([#1228](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1228)).
* (softwarecrash) Never delete pre-existing target objects when an output migration fails before SourceAnalytix writes to the target ([#1228](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1228)).
* (softwarecrash) Add migration, restart recovery, settings write-back and concurrent-disable regression tests for custom output IDs ([#1229](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1229)).

### 0.6.0 (2026-09-26)
* (DutchmanNL) Maintenance: raise Node.js to 22, modernise CI and release tooling, update dependencies, resolve repository checker findings
* (DutchmanNL) The adapter now requires Admin 7.8.23 or newer.
* (DutchmanNL) Tests now also run on Node.js 26 ([#1222](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1222)).
* (softwarecrash) Price definition and unit selection work again with Admin 8, and settings with a missing price definition, unit or output ID can no longer be saved ([#1202](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1202)).
* (softwarecrash) Each source has an editable output ID, pre-filled with its existing ID so nothing changes for current installations. Changing it copies and verifies the complete object tree before the old tree is removed, and reserved, invalid or already used IDs are rejected ([#617](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/617), [#1200](https://github.com/DrozmotiX/ioBroker.sourceanalytix/pull/1200)).
* (softwarecrash) A meter decrease larger than the threshold is only accepted as a reset or replacement once the following reading confirms it; a reading back within the threshold of the last accepted value discards it ([#1199](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1199)).
* (softwarecrash) Fixed a crash when a source was reconfigured or disabled while a calculation was running ([#1198](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1198)).
* (softwarecrash) Each source stores its own rounding settings, taken once from the instance defaults, so later changes to the defaults no longer affect existing sources ([#1200](https://github.com/DrozmotiX/ioBroker.sourceanalytix/pull/1200)).

### 0.5.6 (2026-08-02)
* The monthly basic price is booked as a full charge when the tariff first becomes valid and at the beginning of every following calendar month, instead of being spread over the days of a month ([#1193](https://github.com/DrozmotiX/ioBroker.sourceanalytix/pull/1193)).
* **Valid from** now also defines the first month the monthly basic price is charged, while tariffs without a validity date keep starting at the beginning of the current calendar year ([#1193](https://github.com/DrozmotiX/ioBroker.sourceanalytix/pull/1193)).
* Monthly basic prices are recorded in their own `basicPriceHistory` state, so a price change during a month only applies to the next monthly booking and already booked months stay unchanged ([#1193](https://github.com/DrozmotiX/ioBroker.sourceanalytix/pull/1193)).
* **Valid from** is available for every price source, not only for fixed prices, and a selected date becomes effective at local midnight ([#1193](https://github.com/DrozmotiX/ioBroker.sourceanalytix/pull/1193)).

### 0.5.5 (2026-08-01)
* Previous day, week, month, quarter and year values are written with the timestamp of the period they belong to (23:59:59 on its last day), so history adapters and Flot plot them in the correct period ([#497](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/497)).
* The number of decimals for consumption and cost values is configurable globally and per source, including an option to store the exact value without rounding ([#934](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/934)).
* A missed calendar rollover can be processed without restarting the instance, through the new `info.recoverPeriods` button or a `recoverPeriods` message, and an hourly check recovers a rollover the scheduler missed while the adapter kept running ([#905](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/905)).
* The midnight scheduler can no longer raise an unhandled rejection, and its cron job and timers are stopped when the instance shuts down ([#904](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/904)).

### 0.5.4 (2026-08-01)
* Each active source automatically exposes a compact `statisticsJson` state containing its current-year quantity, financial and optional meter-reading statistics ([#361](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/361), [#967](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/967)).
* Monthly basic prices are no longer imported into the variable-cost accumulator and added a second time after a restart ([#1188](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1188)).

[Older changelog entries](CHANGELOG_OLD.md)

## License
MIT License

Copyright (c) 2022-2026 DrozmotiX Services B.V.

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
