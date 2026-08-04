# E3DC 4 Homey

Unofficial Homey app for **E3DC home power stations** (community fork [Copiis/e3dc-4-homey](https://github.com/Copiis/e3dc-4-homey)).

E3DC is a brand of HagerEnergy GmbH ([e3dc.com](https://www.e3dc.com/)). This project is not affiliated with E3DC.

**Current stable:** `v1.8.72` · [App Store](https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/) · [Forum](https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181)

## How it works

E3DC stations expose a local TCP interface (**RSCP**, port **5033**). All live data and control stay **on your LAN** — no E3DC cloud is required for normal operation.

You must enable RSCP once on the station itself. See [Setup](setup/setup.md).

Portal username/password are used only for **RSCP authentication** on the station (not for cloud control).

## Features

- Fully **local** RSCP communication
- Live energy: PV, house load, grid, battery, wallbox
- **Homey Energy** via grid meter + battery devices
- EMS-style **power modes** (auto / idle / charge / discharge / grid charge)
- **Wallbox** as `evcharger` devices with sun mode, prioritization, vehicle SOC
- **PV forecast** (Open-Meteo): baseline + recalculated daily kWh (up to 3 surfaces)
- Dashboard **widgets**: live energy flow, wallbox, HKW/wallbox charge planners
- Island / emergency-power triggers and timeline messages
- Optional diagnostic report for support

## Devices

| Device | Role |
|--------|------|
| [**HKW / HPS**](devices/hps.md) | Main connection — pair this first |
| [**Grid meter**](devices/grid-meter.md) | Import/export for Homey Energy |
| [**Battery monitor**](devices/battery.md) | Per-module monitoring |
| [**Wallbox**](devices/wallbox.md) | One device per charge point |
| [**Statistics**](devices/statistics.md) | Period totals (today, yesterday, month, …) |
| [**Energy summary**](devices/energy-summary.md) | Live aggregate + PV surplus (EMS-friendly) |
| [**PV forecast**](devices/pv-forecast.md) | Daily forecast baseline + recalculated |

## Widgets

See [Widgets](widgets.md): live energy flow (**E3DC-HKW**), wallbox control, HKW/wallbox charge planners.

## Flows

See [Flows & EMS](flows.md) for HKW and wallbox cards (limits, power modes, island mode, sun mode, vehicle SOC, …).

## Help

- Forum: [App für E3DC Hauskraftwerke](https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181)
- Issues: [GitHub](https://github.com/Copiis/e3dc-4-homey/issues)
- [Community & support](about/community.md) · [Release notes](about/release-notes.md)

The RSCP protocol is not officially documented; behaviour can vary by model and firmware. When reporting issues, include model, firmware, and a diagnostic report from the HKW device settings (no passwords).
