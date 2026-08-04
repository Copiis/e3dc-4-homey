# Wallbox

One Homey **`evcharger`** device per connected wallbox. Discovered via the paired HKW.

## Capabilities (tile)

| Capability | Meaning |
|------------|---------|
| `measure_power` | Charging power (W) — Homey Energy primary |
| `measure_wallbox_solarshare` | Solar share of charging power (W) |
| `measure_vehicle_soc` | Vehicle state of charge (%); title shows data source |
| `wallbox_plugged` | Charging cable plugged in |
| `measure_wallbox_max_current` | Max charge current (A) |
| `measure_wallbox_phases` | Active phases (1–3) |
| `meter_power` | Total energy charged (kWh) |
| `wallbox_charging` | Charging allowed / stopped (**sensor**, not a switch) |
| `wallbox_sun_mode` | PV surplus mode (**sensor**) |
| `wallbox_ladeplan_active` / `wallbox_ladeplan_summary` | Active wallbox charge plan |

**Also available (often secondary / flow):**

- `wallbox_plug_locked`, `wallbox_schuko`
- Ladepriorisierung (system-wide EMS, same on every wallbox of the plant):  
  `wallbox_priority_battery_first`, `wallbox_battery_discharge_sun`,  
  `measure_wallbox_discharge_soc`, `wallbox_battery_discharge_mix`

System capability `evcharger_charging` is **not** used (keeps Homey’s main EV UI clean).

## Vehicle SOC sources

Local RSCP often reports **0 %** for cloud-paired cars (e.g. Tesla). Resolution order:

1. Plausible **local RSCP** SoC  
2. **Homey car** device (`class` car, `measure_battery`) — setting **Auto** or a specific device  
3. Optional **E3DC cloud** fallback (HKW setting; throttled; not always available)  
4. Flow action **Set vehicle SOC** (e.g. token from Tesla app)  
5. **Last known** good value (title indicates this)

Wallbox setting: vehicle SOC source = Auto / specific Homey device / RSCP only.

## Control (flows)

Preferred actions (RSCP read-back before write):

- **Allow charging** / **Block charging**
- **Sun mode on** / **Sun mode off**
- **Set charge current** (and mode)
- **Battery before car**, battery discharge (sun / mixed), **discharge until %**
- **Set vehicle SOC**

Conditions: sun mode on/off, charging allowed/blocked — use them to avoid double notifications.

Example:

```
WHEN  [Wallbox] sun mode is off
THEN  [Wallbox] sun mode on
AND   Push notification "Sonnenmodus eingeschaltet"
```

Full card list: [Flows & EMS](../flows.md).

## Widgets

- **Wallbox** widget — live control UI  
- **Wallbox Ladeplaner** — schedules; active plans override conflicting ad-hoc behaviour  

See [Widgets](../widgets.md).

## EXTERN_DATA_ALG (technical)

6-byte status via `WBTag.REQ_EXTERN_DATA_ALG` (same idea as ioBroker e3dc-rscp):

| Index | Meaning |
|------:|---------|
| 0 | Vehicle SOC (%) |
| 1 | Active phases |
| 2 | Status byte (bit 7 = sun mode, bit 6 = charging canceled, bit 5 = charging active, bit 4 = plug locked, bit 3 = plugged) |
| 3 | Max charge current (A) |
| 5 | Schuko outlet on |

Sensors update on each HKW poll. Flow actions call guarded apply helpers and skip redundant RSCP writes.

## Tips

- Activate RSCP on the station ([Setup](../setup/setup.md))
- Multiple wallboxes are supported per HKW
- Firmware variants may differ slightly — test with your hardware
- On failure: diagnostic report from HKW settings
