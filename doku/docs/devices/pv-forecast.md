# PV forecast (HKW – PV-Prognose)

Optional sensor linked to your HKW. Estimates **daily PV energy (kWh)** using weather data from [Open-Meteo](https://open-meteo.com/).

## Capabilities

| Capability | Meaning |
|------------|---------|
| `measure_pv_forecast_baseline` | **PV forecast** — morning freeze of the model day total (kWh) |
| `measure_pv_forecast_adjusted` | **PV forecast (recalculated)** — afternoon correction toward real production |
| `measure_pv_actual_today` | PV generated today from the station counter (kWh) |

Titles match the Homey tile labels (not “original” / “adjusted” wording).

## Configuration

Device settings:

- Up to **3 PV surfaces** (kWp, tilt °, compass). Set kWp to **0** to disable a row. At least one surface required.
- Calibration / performance-ratio style hints in settings (see on-device labels)
- Location is taken from the Homey / plant context used by the forecast service

## How recalculated forecast works (overview)

1. **Baseline** — frozen in the morning from weather × kWp × PR × calibration  
2. **From ~noon** — hourly blend:  
   \(A \approx E_{\text{actual}} + R_{\text{weather remaining}} \cdot f\)  
   with \(f\) clamped, soft caps vs baseline, and evening taper toward actual production  
3. **Pace cap** — if Open-Meteo remaining energy is too optimistic vs recent production slope, the residual is limited so Insights do not overshoot late day  

Exact parameters evolve with app versions; see [Release notes](../about/release-notes.md).

## Tips

- Compare baseline vs recalculated in Homey Insights over several sunny days
- Wrong kWp/tilt/orientation will bias both series
- Needs network access for Open-Meteo (forecast only; live station data stays local RSCP)
