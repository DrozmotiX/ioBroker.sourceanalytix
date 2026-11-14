# Guides

Task-based guides: set up sources, correct meter readings, enter prices, evaluate values and maintain the adapter.

## [Sources, units and signs](01.quellen-und-einheiten.md)

- [How do I separate consumption from the grid and feed-in (one datapoint with a sign)?](01.quellen-und-einheiten.md#separate-import-feed-one-datapoint)
- [Which unit do I set on the datapoint (kWh instead of Wh, m³ instead of liters)?](01.quellen-und-einheiten.md#unit-datapoint-kwh-wh-m3)
- [Can SourceAnalytix calculate consumption and a meter reading from power (W)?](01.quellen-und-einheiten.md#sourceanalytix-compute-consumption-meter-reading)
- [How do I track PV yield, feed-in and earnings?](01.quellen-und-einheiten.md#track-pv-yield-feed-earnings)
- [How do I derive a counter from flow rate, run time or several devices?](01.quellen-und-einheiten.md#derive-counter-flow-run-time)
- [Can I use script datapoints or unreliable sources?](01.quellen-und-einheiten.md#use-script-datapoints-unreliable-sources)

## [Correcting meter readings and replacing meters](02.zaehlerstaende-korrigieren.md)

- [How do I correct wrong, too high or negative values after a reset?](02.zaehlerstaende-korrigieren.md#correct-wrong-too-high-negative)
- [Why are my values negative after I entered start values?](02.zaehlerstaende-korrigieren.md#values-negative-after-entering-start)
- [I replaced a meter or device: how do I avoid negative values?](02.zaehlerstaende-korrigieren.md#replaced-meter-device-avoid-negative)
- [My meter restarts at 0 after a power failure or every day: what do I set?](02.zaehlerstaende-korrigieren.md#meter-restarts-after-power-loss)
- [How do I apply my real meter reading (cumulativeReading, RAW object)?](02.zaehlerstaende-korrigieren.md#apply-real-meter-reading-cumulativereading)

## [Prices and costs](03.preise-und-kosten.md)

- [Are calculated costs recalculated when I change the price, and how do I change it from a certain date?](03.preise-und-kosten.md#costs-recalculated-change-price-change)
- [How do I include a monthly basic fee?](03.preise-und-kosten.md#include-monthly-base-fee)
- [How do I use a dynamic electricity price (Tibber, Awattar)?](03.preise-und-kosten.md#use-dynamic-electricity-price-tibber)
- [How do I bill a day/night tariff (high/low rate)?](03.preise-und-kosten.md#bill-day-night-tariff)
- [How do I assign prices and create my own tariffs (e.g. heat pump)?](03.preise-und-kosten.md#assign-prices-create-custom-tariffs)

## [Evaluating values (Grafana, VIS, scripts)](04.werte-auswerten.md)

- [How do I evaluate values across several years without adjusting everything every year?](04.werte-auswerten.md#evaluate-across-years-adjusting-everything)
- [Which datapoints do I use for Grafana/InfluxDB?](04.werte-auswerten.md#datapoints-use-grafana-influxdb)
- [How do I visualize the values in VIS, Flot, HabPanel and the history?](04.werte-auswerten.md#visualise-values-vis-flot-habpanel)
- [How do I read SourceAnalytix values in a script?](04.werte-auswerten.md#read-sourceanalytix-values-script)

## [Operation and maintenance](05.betrieb-und-wartung.md)

- [How do I update SourceAnalytix (and what is a downgrade)?](05.betrieb-und-wartung.md#update-sourceanalytix-downgrade)
- [How do I switch off a datapoint or remove sources and states?](05.betrieb-und-wartung.md#disable-datapoint-remove-sources-states)
- [Where is the data, how do I back it up and how do I move it?](05.betrieb-und-wartung.md#data-back-up-move-new)
- [How do I start over with a datapoint and clean up old years?](05.betrieb-und-wartung.md#restart-datapoint-clean-up-old)
- [ioBroker was off at midnight: how do I catch up the day rollover?](05.betrieb-und-wartung.md#iobroker-was-down-midnight-recover)

[Back to overview](../README.md)
