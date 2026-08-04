# Grid meter

Sensor device for **Homey Energy** and clear import/export readings.

Pair after the HKW. It uses the linked station’s live and historical grid data.

## Capabilities

| Capability | Meaning |
|------------|---------|
| `measure_power` | Instant grid power (W) |
| `measure_grid_out` | Grid import today (kWh) |
| `measure_grid_in` | Grid export (feed-in) today (kWh) |
| `meter_power.imported` | Grid import total (kWh) |
| `meter_power.exported` | Grid export total (kWh) |

## Notes

- Cumulative totals come from E3DC history where possible (not pure live integration), which keeps day rollovers and S10/H20 sign quirks more stable.
- Compare “today” values with the E3DC app/portal after midnight if you validate counters.
