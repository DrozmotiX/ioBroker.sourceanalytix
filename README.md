# SourceAnalytix

[![NPM version](https://img.shields.io/npm/v/iobroker.sourceanalytix.svg)](https://www.npmjs.com/package/iobroker.sourceanalytix)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sourceanalytix.svg)](https://www.npmjs.com/package/iobroker.sourceanalytix)
[![Number of Installations (latest)](https://iobroker.live/badges/sourceanalytix-installed.svg)](https://iobroker.live)
[![Number of Installations (stable)](https://iobroker.live/badges/sourceanalytix-stable.svg)](https://iobroker.live)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/sourceanalytix/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Test and Release](https://github.com/DrozmotiX/ioBroker.sourceanalytix/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/DrozmotiX/ioBroker.sourceanalytix/actions/workflows/test-and-release.yml)

SourceAnalytix turns cumulative meter readings or regularly updated power values into consumption, delivery, cost and earnings statistics. It supports fixed prices, scheduled price changes, dynamic tariffs from ioBroker states and selector-controlled tariffs.

The adapter requires **Admin 7.6.20 or newer**, **js-controller 6.0.11 or newer** and **Node.js 22 or newer**.

## What is Sentry.io and what is reported to the servers of that company?

This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers. For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

When the adapter crashes or another code error occurs, the error message which also appears in the ioBroker log is submitted to Sentry. If you allowed ioBroker GmbH to collect diagnostic data, your installation ID is included. This is an anonymous identifier without personal information such as your name or email address. It allows errors to be grouped and shows how many installations are affected.

## Features

- Current day, week, month, quarter and year totals
- Optional previous-period values and current-year weekday, week, month and quarter collections
- Optional archived week, month and quarter statistics below each calendar year
- Consumption and delivery calculations
- Cost and earnings calculations with an optional monthly basic price
- Fixed, scheduled, state-provided and selector-controlled unit prices
- Timestamped price history which preserves already calculated costs
- Automatic conversion between compatible energy, volume, mass and metric length units
- Integration of power readings over their actual update intervals
- Recovery of missed calendar rollovers after an adapter restart
- Handling of meter resets, meter replacements and small backwards fluctuations

## Setup

### 1. Configure the adapter instance

The **General settings** tab controls which detailed statistics are created. Disabling an option removes the corresponding optional states while retaining the normal current-period totals and existing archived years.

![General settings](admin/readmeDocu/mainSettings.png)

| Setting | Result |
| --- | --- |
| Year statistics: Weeks / Months / Quarters | Stores completed values below `<source>.<year>` for historical comparison. |
| Current year: Weekday | Stores the current week's values by weekday. |
| Current year: Weeks / Months / Quarters | Stores values for each period below `<source>.currentYear`. |
| Current year: Previous period | Stores the completed day, week, month, quarter and year, plus the previous week's weekday values. |

SourceAnalytix remembers the last successfully processed calendar periods. If the adapter or ioBroker is not running at midnight, missed day, week, month, quarter and year changes are processed once at the next start.

### 2. Create price definitions

Open **Price definitions** and add the categories that source states should use.

![Price definitions](admin/readmeDocu/priceSettings.png)

| Field | Description |
| --- | --- |
| Category | Unique identifier shown in the source state's **Select price definition** field. |
| Description | Free-text description of the tariff. |
| Cost type | Selects the `costs`/`consumed` or `earnings`/`delivered` result categories. |
| Unit | Target unit for consumption and the denominator of the unit price. |
| Price source | Fixed price, numeric ioBroker state or tariff selector. |
| Price per unit | Unit price for a fixed tariff, or the inactive/base price for a selector. |
| Price state | Full ID of the numeric price state or tariff selector state. |
| Active tariff price | Price used while a selector is active. |
| Active selector value | Optional exact value which activates the alternate tariff. |
| Valid from | Optional date from which a fixed price applies. |
| Price per month | Monthly basic price, applied only to sources with **Including basic rate** enabled. |

#### Fixed and scheduled prices

Select **Fixed price** and enter **Price per unit**. When changing a tariff, set **Valid from** to the date on which the new price becomes effective. The previous price remains in the history and is not applied retroactively.

#### Dynamic price state

Select **State value** and choose the state containing the current numeric unit price. SourceAnalytix subscribes to that state and records every change with the state's timestamp. Both numbers and numeric strings with a dot or comma decimal separator are accepted.

The state value must represent the system currency per selected target unit, for example currency/kWh when the price definition uses `kWh`. Convert values such as cents per kWh in the source adapter or a script before using them.

#### Tariff selector

Select **Tariff selector** for day/night, relay, contact or other two-price tariffs:

- **Price per unit** is the inactive/base price.
- **Active tariff price** is used while the selector is active.
- Without **Active selector value**, `true`, non-zero numbers and common truthy strings activate the alternate tariff.
- With **Active selector value**, only an exact string representation match activates the alternate tariff.

#### Writable current price

Each category exposes `sourceanalytix.<instance>.priceDefinitions.<category>.currentPrice`. Scripts and visualizations can write a numeric value to this state to apply a new price immediately. The value is also appended to the timestamped price history.

#### Historical price calculation

Prices are time-dependent. A new price only applies from its change timestamp onward and never changes costs already accumulated for earlier consumption.

For a cumulative meter, SourceAnalytix knows the consumption delta between two readings. If one or more price changes occurred inside that interval, the delta is distributed proportionally across the elapsed time segments and each share is charged at the price valid for that segment. A price change exactly at the timestamp of the later meter reading applies to the following interval.

The precise cost accumulator and price history survive adapter restarts. Explicit recalculation of old historical data is not currently implemented.

#### Monthly basic price

Enable **Including basic rate** on a source to add the configured monthly price. Day and week values use the daily share for the respective calendar month. Month, quarter and year values include the applicable calendar months, including weeks that cross a month boundary.

### 3. Activate a source state

SourceAnalytix is configured through the ioBroker custom settings of each source state. Open **Objects**, click the wrench/configuration icon of the desired state and expand the SourceAnalytix instance.

![Custom settings icon](admin/readmeDocu/settingKey.png)

![Source state settings](admin/readmeDocu/stateSettings.png)

| Setting | Description |
| --- | --- |
| Enabled | Activates this source for the selected SourceAnalytix instance. |
| Alias name | Optional readable name for the generated device. |
| Select price definition | Mandatory category from the adapter's price definitions. |
| Select Unit | Source unit. Leave on automatic detection when the source object has a correct supported unit. |
| Calculate costs | Creates and updates cost or earnings states. |
| Including basic rate | Adds the price definition's monthly basic price. |
| Calculate consumption | Creates and updates consumption or delivery states. |
| Average power values between updates | Optional calculation mode for power states; see [Power states](#power-states). |
| Store Meter Values | Stores meter readings in the enabled period collections. |
| Device value reset detection | Continues a cumulative total after a meter reset or replacement. |
| Threshold | Largest backwards fluctuation ignored as measurement jitter, expressed in the target unit. |

The source state ID is converted to the generated SourceAnalytix device ID by replacing dots with double underscores.

## Source Values And Units

### Cumulative source states

Use a cumulative total which normally only increases, for example Tasmota `ENERGY_Total` or a smart meter's total consumption. Do not use a value such as `ENERGY_Today` that intentionally resets every day. If no cumulative total is available, create one in an upstream adapter or script.

For cumulative sources, consumption is calculated as:

```text
current cumulative reading - reading at the beginning of the period
```

On first activation, SourceAnalytix initializes empty or zero day, week, month, quarter and year start values with the current normalized meter reading. This prevents the existing lifetime meter total from appearing as new consumption. The values remain editable and are not overwritten on later starts.

![Period start values](admin/readmeDocu/stateStartValues.png)

Enter manual start values in the **target unit** selected by the price definition. Each value must represent the meter reading at the beginning of that period, not the consumption during the period.

### Power states

Power values such as `W` or `kW` are integrated over the actual time between state updates to produce energy. The first reading establishes the baseline and does not create consumption.

By default, the previous power value is treated as valid for the complete interval. Enable **Average power values between updates** for sensors which report regularly and change gradually; SourceAnalytix then uses the average of the previous and current values. Leave it disabled for devices that switch abruptly when the update marks the switch event.

### Supported units

SourceAnalytix automatically converts values only between compatible quantities:

| Quantity | Supported units |
| --- | --- |
| Power | `GW`, `MW`, `kW`, `W`, `mW` |
| Energy | `GWh`, `MWh`, `kWh`, `Wh`, `mWh` |
| Cubic volume | `km³`, `m³`, `dm³`, `cm³`, `mm³` |
| Liquid volume | `hl`, `l`, `dl`, `cl`, `ml` |
| Mass | `t`, `kg`, `g` |
| Metric length | `km`, `m`, `dm`, `cm`, `mm`, `µm`, `nm` |

Liter and cubic-meter units can be converted into each other. Incompatible conversions, such as kilograms to kWh or meters to liters, are rejected instead of producing misleading results.

## Generated States

For every source, SourceAnalytix creates a `cumulativeReading` and the enabled result trees:

| Path | Content |
| --- | --- |
| `<source>.currentYear.consumed` | Current consumption totals for cost categories. |
| `<source>.currentYear.delivered` | Current delivery totals for earnings categories. |
| `<source>.currentYear.costs` | Current cost totals. |
| `<source>.currentYear.earnings` | Current earnings totals. |
| `<source>.currentYear.meterReadings` | Optional meter readings by enabled periods. |
| `<source>.<year>` | Optional archived week, month and quarter statistics. |

The basic current and optional previous states use names such as `01_currentDay`, `02_currentWeek`, `03_currentMonth`, `04_currentQuarter`, `05_currentYear` and their `previous` equivalents.

## Meter Resets And Corrections

With reset detection enabled, a decrease larger than **Threshold** is treated as a real meter reset or replacement. SourceAnalytix stores an offset and continues its cumulative reading without losing earlier consumption. A smaller backwards change is treated as jitter and ignored. A threshold of `0` treats every decrease as a reset.

If reset detection is disabled, decreasing source readings are accepted and can reduce calculated totals. This mode is intended only for sources where that behavior is expected.

To correct an already wrong `cumulativeReading`:

1. Stop the SourceAnalytix instance.
2. Open **Objects** and enable expert mode.
3. Correct `<source>.cumulativeReading`.
4. Open the source state's SourceAnalytix custom settings and correct the affected period start values in the same target unit.
5. Start the adapter again and verify the current-period results.

![Correcting a cumulative reading](admin/readmeDocu/cumulativeReading-Reset.png)

Changing the current unit price does not recalculate historical costs. There is currently no user-triggered historical recalculation.

## Troubleshooting

### Source is not initialized

- Verify that the custom configuration is enabled for the correct SourceAnalytix instance.
- Select an existing price definition. A price definition is required even when only consumption is enabled.
- Ensure the source unit can be detected from the object or select it manually.
- Check that the source and target units represent compatible quantities.
- Review the adapter log for the exact rejected state or configuration value.

### Consumption starts with the complete lifetime meter reading

This normally indicates old or manually entered period start values. Set the day, week, month, quarter and year starts to the corresponding historical meter readings. For today's value, this is usually:

```text
current cumulative reading - consumption since the beginning of today
```

### Dynamic prices appear incorrect

- Verify that the price state uses currency per target unit, not cents unless the value was converted.
- Check the timestamp of the price state and the source meter readings.
- Remember that a meter delta spanning price changes is divided by elapsed time because no finer consumption profile is available.
- Inspect `priceDefinitions.<category>.currentPrice` for the active price.

## Known Limitations

- Automatic historical recalculation is intentionally disabled, and no explicit recalculation action is available yet.
- User-configurable rolling periods are not implemented.
- Unitless counters, time units and digital-size units are not supported.

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
### 0.5.2 (2026-07-28)
* The npm release workflow no longer fails at the Sentry step: commit association is disabled because the previous release commit is not reachable in the shallow, squash-merged history ([#1179](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1179)).
* README now carries the standard Sentry notice required by the ioBroker repository checker ([#1179](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1179)).

### 0.5.1 (2026-07-28)
* Power states can optionally use the average of consecutive readings over their actual update interval ([#1166](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1166)).
* First-time activation initializes empty period starts from the current cumulative reading while keeping them editable ([#148](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/148)).
* Missed calendar rollovers are recovered after restarts, and all current-year week, month and quarter settings now control their complete state lifecycle ([#904](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/904), [#307](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/307)).
* Cumulative mass and metric length units are supported with validated conversions between compatible quantities ([#614](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/614)).
* User documentation and neutral English Admin screenshots were refreshed ([#613](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/613)).
* Dependabot runs again: its cron schedules used an unsupported key and failed config validation ([#1182](https://github.com/DrozmotiX/ioBroker.sourceanalytix/pull/1182)).

### 0.5.0 (2026-07-28)
* A large quality and feature update, with thanks to **softwarecrash** for providing the solutions behind this release.
* Dynamic and historical unit prices can now be taken from ioBroker states, including tariff switching and timestamped price changes ([#1159](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1159), [#715](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/715), [#687](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/687), [#485](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/485), [#486](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/486), [#487](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/487)).
* Cost calculations stay precise across restarts and price changes, without rewriting already calculated history ([#625](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/625), [#783](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/783), [#750](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/750)).
* Meter resets, meter replacements and small counter fluctuations are handled much more reliably, avoiding broken totals and duplicate consumption ([#686](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/686), [#754](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/754), [#759](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/759), [#794](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/794)).
* Day, week, month and year rollovers are more robust, including midnight resets and automatic creation of new year statistics ([#478](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/478), [#481](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/481), [#536](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/536), [#775](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/775)).
* Deleted or disabled sources no longer keep writing unwanted values, while their existing history is preserved ([#704](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/704), [#919](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/919), [#1009](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1009)).
* Monthly basic charges are applied correctly again across the current period calculations ([#1144](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1144)).
* The admin configuration has been modernized to `jsonConfig`, with improved price settings, state pickers and translations ([#1007](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1007)).
* Tooling and maintenance were refreshed for current ioBroker and Node.js versions, including better tests, CI updates and dependency cleanup ([#1018](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1018), [#1064](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1064), [#1121](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1121), [#1177](https://github.com/DrozmotiX/ioBroker.sourceanalytix/issues/1177)).
* (DutchmanNL) Earlier work-in-progress fixes remain included: Sentry-reported issues, logging cleanup and the `common.type` repository checker fix.

### 0.4.15-alpha.1 (2025-09-10) Repository checker fixes and dependency updates
* (DutchmanNL) Update dependencies to latest versions
* (DutchmanNL) Fix repository checker issues
* (DutchmanNL) Update @iobroker/adapter-core to ^3.3.2
* (DutchmanNL) Update @alcalzone/release-script to ^3.8.0
* (DutchmanNL) Update @iobroker/testing to ^5.0.4
* (DutchmanNL) Add Node.js version requirement
* (DutchmanNL) Add .releaseconfig.json for release script
* (DutchmanNL) Remove deprecated admin configurations

### 0.4.14 (2022-02-23) Optimize Device reset handling
* (DutchmanNL) Small code updates, lifecycle patches
* (DutchmanNL) Option to disable device reset feature added
* (DutchmanNL) Bugfix: Cannot read property 'name' of undefined solved

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
