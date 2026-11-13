# Anleitungen

Anleitungen nach Aufgaben: Quellen einrichten, Zählerstände korrigieren, Preise hinterlegen, Werte auswerten und den Adapter pflegen.

## [Quellen, Einheiten und Vorzeichen](01.quellen-und-einheiten.md)

- [Wie trenne ich Bezug und Einspeisung (ein Datenpunkt mit Vorzeichen)?](01.quellen-und-einheiten.md#separate-import-feed-one-datapoint)
- [Welche Einheit stelle ich am Datenpunkt ein (kWh statt Wh, m³ statt Liter)?](01.quellen-und-einheiten.md#unit-datapoint-kwh-wh-m3)
- [Kann SourceAnalytix aus Leistung (W) Verbrauch und Zählerstand berechnen?](01.quellen-und-einheiten.md#sourceanalytix-compute-consumption-meter-reading)
- [Wie erfasse ich PV-Ertrag, Einspeisung und Erlöse?](01.quellen-und-einheiten.md#track-pv-yield-feed-earnings)
- [Wie leite ich einen Zähler aus Durchfluss, Laufzeit oder mehreren Geräten ab?](01.quellen-und-einheiten.md#derive-counter-flow-run-time)
- [Kann ich Skript-Datenpunkte oder unzuverlässige Quellen verwenden?](01.quellen-und-einheiten.md#use-script-datapoints-unreliable-sources)

## [Zählerstände korrigieren und Zähler tauschen](02.zaehlerstaende-korrigieren.md)

- [Wie korrigiere ich falsche, zu hohe oder negative Werte nach einem Reset?](02.zaehlerstaende-korrigieren.md#correct-wrong-too-high-negative)
- [Warum sind meine Werte nach der Eingabe von Startwerten negativ?](02.zaehlerstaende-korrigieren.md#values-negative-after-entering-start)
- [Ich habe Zähler oder Gerät getauscht – wie vermeide ich negative Werte?](02.zaehlerstaende-korrigieren.md#replaced-meter-device-avoid-negative)
- [Mein Zähler startet nach Stromausfall oder täglich bei 0 – was stelle ich ein?](02.zaehlerstaende-korrigieren.md#meter-restarts-after-power-loss)
- [Wie übernehme ich meinen echten Zählerstand (cumulativeReading, RAW-Objekt)?](02.zaehlerstaende-korrigieren.md#apply-real-meter-reading-cumulativereading)

## [Preise und Kosten](03.preise-und-kosten.md)

- [Werden berechnete Kosten neu berechnet, wenn ich den Preis ändere – und wie ändere ich ihn ab einem Datum?](03.preise-und-kosten.md#costs-recalculated-change-price-change)
- [Wie rechne ich einen monatlichen Grundpreis ein?](03.preise-und-kosten.md#include-monthly-base-fee)
- [Wie berücksichtige ich einen dynamischen Strompreis (Tibber, Awattar)?](03.preise-und-kosten.md#use-dynamic-electricity-price-tibber)
- [Wie rechne ich einen Tag-/Nachttarif (HT/NT) ab?](03.preise-und-kosten.md#bill-day-night-tariff)
- [Wie ordne ich Preise zu und lege eigene Tarife an (z. B. Wärmepumpe)?](03.preise-und-kosten.md#assign-prices-create-custom-tariffs)

## [Werte auswerten (Grafana, VIS, Skripte)](04.werte-auswerten.md)

- [Wie werte ich Werte über mehrere Jahre aus, ohne jedes Jahr alles anzupassen?](04.werte-auswerten.md#evaluate-across-years-adjusting-everything)
- [Welche Datenpunkte nehme ich für Grafana/InfluxDB?](04.werte-auswerten.md#datapoints-use-grafana-influxdb)
- [Wie visualisiere ich die Werte in VIS, Flot, HabPanel und der Historie?](04.werte-auswerten.md#visualise-values-vis-flot-habpanel)
- [Wie lese ich SourceAnalytix-Werte im Skript?](04.werte-auswerten.md#read-sourceanalytix-values-script)

## [Betrieb und Wartung](05.betrieb-und-wartung.md)

- [Wie aktualisiere ich SourceAnalytix (und was ist ein Downgrade)?](05.betrieb-und-wartung.md#update-sourceanalytix-downgrade)
- [Wie schalte ich einen Datenpunkt ab oder entferne Quellen und States?](05.betrieb-und-wartung.md#disable-datapoint-remove-sources-states)
- [Wo liegen die Daten, wie sichere ich sie und ziehe ich um?](05.betrieb-und-wartung.md#data-back-up-move-new)
- [Wie fange ich mit einem Datenpunkt neu an und räume alte Jahre auf?](05.betrieb-und-wartung.md#restart-datapoint-clean-up-old)
- [ioBroker war um Mitternacht aus – wie hole ich den Tageswechsel nach?](05.betrieb-und-wartung.md#iobroker-was-down-midnight-recover)

[Zurück zur Übersicht](../README.md)
