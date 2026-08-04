# Release notes

Summaries for documentation. Full bilingual store changelog: [`.homeychangelog.json`](https://github.com/Copiis/e3dc-4-homey/blob/master/.homeychangelog.json) in the repository.

## v1.8.72 (stable)

- **HKW widget:** battery charge/discharge flow lines at the **same height** as grid import/export lines

## v1.8.70 – v1.8.71

- **PV forecast (recalculated):** better end-of-day accuracy — pace-based cap on optimistic weather residual; soft-cap and evening parabola taper toward actual production

## v1.8.68 – v1.8.69

- **HKW widget:** sun icon (darker gold, aligned with grid lightning); stronger secondary/kWh text; no crop without wallbox

## v1.8.65 – v1.8.66

- **Island mode:** reliable start/stop flows + timeline texts; delayed island report after reconnect; clearer outage wording

## v1.8.61 – v1.8.62

- **Crash hardening** when HKW is unreachable (`EHOSTUNREACH` / offline) — app no longer crashes Homey on connect errors
- Device marked unavailable after repeated sync failures again

## v1.8.56 – v1.8.57

- **Vehicle SOC:** Homey car device / flow / optional cloud fallback when local RSCP is 0 %
- **HKW widget:** car front-view wallbox symbol + vehicle SOC

## v1.8.x highlights (earlier)

- PV forecast device (Open-Meteo, multi-surface, baseline + recalculated)
- Energy summary device, live energy flow widget, charge planner widgets
- EMS power modes (incl. grid charge), surplus / SoC triggers
- Wallbox as `evcharger` with sun mode, prioritization, RSCP read-back
- Grid meter for Homey Energy; battery module meters
- HKW repair flow for credentials without re-pair

## v1.7.x / v1.3.x (historical)

- Energy summary, live flow widget, EMS triggers  
- Full wallbox flow control (allow/block, sun mode, current)  
- Stable wallbox discovery / device IDs  

## v1.0.0 (2024-03-01)

- Initial release (upstream)
