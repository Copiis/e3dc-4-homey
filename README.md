# E3DC Home power station (Community Fork)

> **Community-maintained fork** of [jnk-cons/e3dc-4-homey](https://github.com/jnk-cons/e3dc-4-homey), kept up to date for current Homey versions.  
> Focus: reliable local RSCP integration, rich **wallbox** support, **Homey Energy**, EMS-friendly flows, PV forecast, and dashboard widgets.

Feedback: [Homey community thread](https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181) · Issues & PRs: [Copiis/e3dc-4-homey](https://github.com/Copiis/e3dc-4-homey)

**Current release:** **v1.8.72** · Docs: [copiis.github.io/e3dc-4-homey](https://copiis.github.io/e3dc-4-homey/) · [App Store](https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/)

---

Integrate your **E3DC home power station (HPS)** into Homey. Communication is **local RSCP** — no E3DC cloud required for normal use.

### RSCP setup (on the HPS)

1. Main menu → **Personalize** → **Profile**  
2. Set an **RSCP password** (lamp green)  
3. Pair the HPS in Homey with IP, portal credentials, and that password  

Full steps: [Setup docs](https://copiis.github.io/e3dc-4-homey/setup/setup/)

---

## Devices

| Device | Purpose |
|--------|---------|
| **HPS (HKW)** | Central connection — live PV, house load, grid, battery, firmware, diagnostics |
| **Grid meter** | Import/export (today + cumulative) for Homey Energy |
| **Battery module** | Per-module monitoring (temperature, capacity, charge/discharge meters) |
| **Wallbox** | Per wallbox: power, solar share, plug state, sun mode, charging allowed/blocked, vehicle SOC |
| **Statistics** | Period stats (today / yesterday / month …): PV, consumption, grid, battery, autarky, self-consumption |
| **Energy summary** | Live aggregation incl. wallbox power and **PV surplus** — ideal for EMS flows |
| **PV forecast** | Daily PV estimate (kWh) via [Open-Meteo](https://open-meteo.com/), up to **3 surfaces**, baseline + recalculated |

---

## Dashboard widgets

- **E3DC-HKW** — animated energy flow (PV, house, grid, battery, wallbox); battery flows aligned with grid height; secondary kWh/SoC values  
- **Wallbox** — live wallbox UI  
- **HKW Ladeplaner** / **Wallbox Ladeplaner** — time-based schedules (plans override ad-hoc EMS commands)

---

## Flows & EMS

- HPS: power limits, manual charge, emergency reserve, island mode, **power modes** (auto / idle / charge / discharge / grid charge)  
- HPS: house/grid/battery power, firmware, **PV surplus**, **battery SoC** triggers  
- Wallbox: allow/block, sun mode, current, battery-before-car / mix modes, vehicle SOC (RSCP read-back)  
- **Repair** on the HPS: refresh RSCP credentials without deleting the device  

Works well with external EMS apps via surplus and SoC triggers.

---

## PV forecast

Optional device linked to the HPS:

- Weather-based **baseline** and **recalculated** daily forecast (kWh)  
- Up to **3 PV surfaces** (kWp, tilt, compass)  
- Afternoon pace-aware correction so Insights stay closer to actual production  

---

## Homey Energy & timeline

- Grid meter and battery devices for import/export and battery energy  
- Timeline for HPS connection, island mode, firmware, wallbox events  

---

## Test builds

When announced in the forum:

`https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/test/`

---

## Recent highlights

**v1.8.72** — HKW widget: battery flow lines at same height as grid  

**v1.8.70–1.8.71** — PV recalculated forecast pace-cap / evening taper  

**v1.8.65–1.8.69** — Island-mode flows & timeline; widget sun icon and crop fixes  

**v1.8.61–1.8.62** — Crash hardening when HKW offline (`EHOSTUNREACH`)  

**v1.8.0–1.8.56** — PV forecast, multi-surface Open-Meteo, vehicle SOC from Homey car, energy flow widget, EMS  

---

## Contributing

Issues and pull requests are welcome. For hardware-specific behaviour share model, firmware, and a diagnostic report from HPS settings (no secrets).
