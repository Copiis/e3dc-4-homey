# Widgets

Details: [Docs – Widgets](https://copiis.github.io/e3dc-4-homey/widgets/)

## E3DC-HKW (Live Energy Flow)

Animierte Energieströme PV ↔ Haus ↔ Netz ↔ Batterie ↔ Wallbox.

- PV als Sonne, Netz als Blitz  
- Batterie-Flows auf **gleicher Höhe** wie Netz-Flows  
- Nebenwerte: kWh heute, SoC, Fahrzeug-SOC  
- Einstellung: Mindestleistung für sichtbare Flows (W)  

## Wallbox

Live-Steuerung der Wallbox (HKW-Zuordnung bei mehreren Anlagen).

## HKW Ladeplaner

Zeitgesteuerte Power-Modi (inkl. Netzladen). Schreibt in die EMS-Pläne; **aktive Pläne haben Vorrang** vor manuellen Flow-Power-Modes.

## Wallbox Ladeplaner

Zeitfenster und Priorisierung; Status auf dem Wallbox-Gerät (`wallbox_ladeplan_*`).
