# Statistics (HKW – Statistiken)

Period statistics from E3DC history for comparison (today vs yesterday, month, custom range).

Name: **HKW - Statistiken** / **HPS - Statistics**.

## Capabilities

| Capability | Meaning |
|------------|---------|
| `date_range` | Selected period |
| `measure_pv_summary` | PV generation in period (kWh) |
| `measure_house_consumption_summary` | House consumption in period (kWh) |
| `measure_grid_out` | Grid import in period (kWh) |
| `measure_grid_in` | Grid export in period (kWh) |
| `measure_battery_in` | Battery charged in period (kWh) |
| `measure_battery_out` | Battery discharged in period (kWh) |
| `measure_self_consumption` | Self-consumption |
| `measure_autarky` | Autarky / self-sufficiency |

## Usage

1. Pair the statistics device and link it to your HKW  
2. Choose the date range on the device  
3. Use values on the tile, in Insights, or as flow tokens  

For **live** surplus and wallbox power, prefer [Energy summary](energy-summary.md) or the main [HKW](hps.md).
