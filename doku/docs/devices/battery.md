# Battery monitor

Per-station **battery monitoring** device (Homey class `battery`). Name: **Batteriemonitor** / **Battery monitor**.

Linked to the HKW; updated from full battery RSCP readouts and live SoC/power.

## Capabilities

| Capability | Meaning |
|------------|---------|
| `measure_power` | Module/system power estimate (W; prefers DCB V×I when available, else station total) |
| `measure_battery` | SoC (%) |
| `measure_emergency_power_reserve` | Emergency power reserve |
| `measure_max_charging_power` | Max charging power |
| `measure_max_discharging_power` | Max discharging power |
| `measure_battery_charged_total` / `measure_battery_discharged_total` | Integrated charge/discharge energy |
| `meter_power.charged` / `meter_power.discharged` | Homey Energy style meters |
| `measure_capacity` | Capacity (kWh) |
| `measure_temperature` | Average cell temperature |
| `measure_temperature_min` / `measure_temperature_max` | Min / max cell temperature |
| `measure_voltage` | Battery voltage |
| `measure_dcbcount` | Number of DCB modules |
| `device_name` | Battery name from station |

## Notes

- Temperature sensors: stations often have many sensors — min, max, and average are exposed.
- Capacity can be wrong from the station; override on the **HKW** battery settings if needed.
- Useful for Homey Energy battery graphs together with the [Grid meter](grid-meter.md).
