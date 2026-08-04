# Widgets

Add widgets from the Homey dashboard and select your HKW (and wallbox where needed).

## E3DC-HKW (live energy flow)

Animated energy flows between **PV**, **house**, **grid**, **battery**, and **wallbox** (if present).

- Sun icon for PV; lightning for grid; battery and house symbols
- Secondary values: PV today (kWh), grid import/export today, battery SoC / remaining time, vehicle SOC on the car symbol when available
- Battery **charge** and **discharge** flow lines align **at the same height** as the grid import/export lines
- Battery charging path is split when useful (e.g. PV vs grid contribution)
- Setting: **Min. power for flow (W)** — flows below this threshold stay inactive (default 30 W)

## Wallbox

Live wallbox widget: power, solar share, plug/charge/sun-mode style controls as implemented on the widget UI. Select the parent HKW if you have more than one.

## HKW Ladeplaner

Time-based **EMS / power-mode** plans for the station (including grid charge). Writes into the station’s schedule settings. Active plans show on the HKW tile (`hkw_ladeplan_active`) and take priority over ad-hoc power-mode flows.

## Wallbox Ladeplaner

Time windows and prioritization for wallbox charging (e.g. until full, sun vs mixed priorities). Active plan summary appears on the wallbox device (`wallbox_ladeplan_active` / `wallbox_ladeplan_summary`).

## Tips

- With only one HKW, plant selection is usually automatic
- After app updates, reopen the dashboard once if a widget still shows an old layout
