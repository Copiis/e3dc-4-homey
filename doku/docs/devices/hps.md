# Home power station (HKW / HPS)

Main device — **pair this first**. All other devices and widgets hang off a linked HKW.

Class: `solarpanel`. App device name: **HKW** (DE) / **HPS** (EN).

## Live capabilities (tile)

| Capability | Meaning |
|------------|---------|
| `measure_power` | PV power (W) |
| `measure_house_consumption` | House consumption (W) |
| `measure_grid_delivery` | Grid power (W; sign follows E3DC convention) |
| `measure_battery_delivery` | Battery power (W; charge positive / discharge negative as provided by station) |
| `measure_battery` | Battery SoC (%) |
| `meter_power` | PV generation total (kWh) |
| `charge_time` | Remaining charge/discharge time under current conditions |
| `firmware_version` | Station software version |
| `hkw_ladeplan_active` | Whether an HKW charge plan (widget) is active |
| `diagnostic_report` | Text report for support (settings / flow) |

Wallbox **sum** power and solar share are shown on the HKW only when at least one wallbox is present (not as separate permanent capabilities on every install).

## Settings (device)

- **Connection** — IP, port (usually 5033), portal credentials, RSCP password  
  Use **Repair** on the device to refresh credentials without deleting the device.
- **Battery** — override storage size if the station reports a wrong capacity
- **Diagnostics** — enable detailed recording (opt-in; auto-off after ~60 minutes)
- **E3DC Cloud (optional)** — optional fallback for some values (local RSCP always preferred)

## Incorrect battery storage size

Some stations report a wrong capacity. Check the battery size in Homey device settings and set the correct value manually if needed.

## Important behaviours

### Island mode / power outage

- Flows: **Island mode started** / **Island mode stopped**
- Conditions: island active / island possible
- Timeline messages (examples, DE): HKW unreachable, island mode, grid restored
- Detection uses station emergency-power state after reconnect; island can also be reported **after** the HKW comes back online if the switch happened while Homey could not poll
- Station switchover is typically ~**5 s**. Homey **and** the network path to the HKW (switch/cable/repeater) must stay up — a non-UPS Wi‑Fi repeater often causes “HKW offline” instead of a live island trigger

### Charge plans vs manual EMS

Active plans from the **HKW Ladeplaner** widget take priority over manual power-mode flow commands.

### Homey Energy

For import/export and battery energy in Homey Energy, add the [Grid meter](grid-meter.md) and [Battery monitor](battery.md) devices.

## Related

- [Flows & EMS](../flows.md)
- [Widgets](../widgets.md)
- [Setup](../setup/setup.md)
