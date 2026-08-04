# Energy summary (HKW – Energieübersicht)

Live **aggregate** of the station for dashboards and external EMS apps.

Name: **HKW - Energieübersicht** / **HPS - Energy Summary**.

## Capabilities

| Capability | Meaning |
|------------|---------|
| `measure_power` | PV power (W) |
| `measure_house_consumption` | House consumption (W) |
| `measure_grid_delivery` | Grid power (W) |
| `measure_battery_delivery` | Battery power (W) |
| `measure_wallbox_consumption` | Wallbox power (W) |
| `measure_pv_surplus` | PV surplus (W) — useful for surplus triggers and EMS |

## When to use

- One clean “overview” device without pairing every optional sensor
- Flows that need **PV surplus** next to live house/grid/battery/wallbox power
- Complements [Statistics](statistics.md) (period totals) and the main [HKW](hps.md)
