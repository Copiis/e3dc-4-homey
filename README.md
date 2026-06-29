# E3DC Home power station (Community Fork)

> **Community-maintained fork** of [jnk-cons/e3dc-4-homey](https://github.com/jnk-cons/e3dc-4-homey), kept up to date for current Homey versions.
> Focus: reliable local RSCP integration, rich **wallbox** support, **Homey Energy**, EMS-friendly flows, and a polished device UI.

Feedback and test reports: [Homey community thread](https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181) · Issues & PRs: [Copiis/e3dc-4-homey](https://github.com/Copiis/e3dc-4-homey)

**Current release:** v1.8.7 · Full docs: [copiis.github.io/e3dc-4-homey](https://copiis.github.io/e3dc-4-homey/)

---

Integrate your **E3DC home power station (HPS)** into Homey. All communication runs **locally** over RSCP — no E3DC cloud required.

### RSCP setup (on the HPS)

1. Main menu → **Personalize** → **Profile**
2. Set an **RSCP password**
3. Pair the HPS in Homey with IP, portal credentials, and that password

---

## Devices

| Device | Purpose |
|--------|---------|
| **HPS (HKW)** | Central connection — live PV, house load, grid, battery, firmware, diagnostics |
| **Grid meter** | Import/export (today + cumulative) for Homey Energy |
| **Battery module** | Per-module monitoring (temperature, capacity, charge/discharge meters) |
| **Wallbox** | Per wallbox: power, solar share, plug state, sun mode, charging allowed/blocked |
| **Statistics** | Period stats (today / yesterday / month …): PV, consumption, grid, battery, autarky, self-consumption |
| **Energy summary** | Live aggregation incl. wallbox power and **PV surplus** — ideal for EMS flows |
| **PV forecast** | Daily PV estimate (kWh) via [Open-Meteo](https://open-meteo.com/), up to **3 tilted surfaces**, baseline + adjusted forecast |

Tile layouts for HPS, grid, wallbox, and statistics are ordered for everyday use (updated automatically on app upgrade).

---

## Dashboard widgets

- **Live energy flow** — animated arrows between PV, house, grid, battery, and wallbox; battery charging shown as **PV → battery** or **grid → house → battery**
- **Overview** — configurable live power overview for your HPS

Add widgets from the Homey dashboard and select your HPS in the widget settings.

---

## Flows & EMS

- HPS: power limits, manual charge, emergency reserve, island mode, **EMS power modes** (auto / idle / force charge / discharge / grid charge)
- HPS: triggers for house/grid/battery power, firmware, **PV surplus threshold**, **battery SoC below threshold**
- Wallbox: allow/block charging, sun mode, current, battery-before-car / mix modes (with RSCP read-back)
- **Repair** on the HPS: refresh RSCP credentials without deleting the device

Works well with external EMS apps (e.g. Ultimate EMS, Power by the Hour) via surplus and SoC triggers.

---

## Wallbox

Each wallbox is a separate `evcharger` device with live power and solar share. Flow cards cover start/stop, sun mode, and advanced E3DC wallbox settings. The tile shows everyday values first; expert fields (lock, Schuko, battery mix options) remain available for flows.

---

## PV forecast (v1.8+)

Optional device linked to your HPS:

- Weather-based **baseline** and **adjusted** daily forecast (kWh)
- Up to **3 PV surfaces** (kWp, tilt, compass) — e.g. east/west roof + south wall
- Actual “today” from the HPS daily PV counter; calibration & performance-ratio hints in settings

---

## Homey Energy & timeline

- Grid meter and battery devices register for import/export and battery energy
- Timeline entries for HPS connection, island mode, firmware, wallbox plug/sun mode/charging

---

## Try a test build

Community test versions (when published):

`https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/test/`

See the [forum thread](https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181) for the latest test notes.

---

## Recent highlights

**v1.8.7** — Improved tile order (HPS, grid, wallbox, statistics); cleaner wallbox tile; live energy flow widget battery paths fixed

**v1.8.0–1.8.6** — PV forecast device, multi-surface config, Open-Meteo integration, HPS offline crash guard

**v1.7.0** — Energy summary device, live energy flow widget, EMS triggers, HPS repair flow

---

## Contributing

Issues and pull requests are welcome. For hardware-specific behaviour we rely on community testing — please share model, firmware, and logs (diagnostic report from HPS settings) when reporting problems.