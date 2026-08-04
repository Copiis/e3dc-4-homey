# Setup

## 1. Enable RSCP on the home power station

RSCP is disabled by default. You need physical access once (or remote screen if available). Details are also in the E3DC manual.

Example on **S10X** (other models are similar; screenshots are in German):

<figure markdown>
  ![Main Page](img/setup_main_screen.jpeg){ width=75% }
  <figcaption>From the main page open the main menu</figcaption>
</figure>

<figure markdown>
  ![Main menu](img/setup_main_menu.jpeg){ width=75% }
  <figcaption>Select “Personalize”</figcaption>
</figure>

<figure markdown>
  ![Personalization page](img/setup_personalize.jpeg){ width=75% }
  <figcaption>Select “Profile”</figcaption>
</figure>

<figure markdown>
  ![Profile page 1](img/setup_profile_1.jpeg){ width=75% }
  <figcaption>Go to the next page</figcaption>
</figure>

<figure markdown>
  ![Profile page 2](img/setup_profile_2.jpeg){ width=75% }
  <figcaption>Set the RSCP password and confirm — the small lamp must light green</figcaption>
</figure>

## 2. Network

- Homey and HKW on the **same LAN** (or routed with open **TCP 5033**)
- Prefer a **fixed IP** for the station (DHCP reservation)
- For island/outage flows: keep Homey **and** the path to the HKW (switch/cable/repeater) on UPS or notstrom — a dead Wi‑Fi repeater looks like “HKW offline”

## 3. Pair the HKW in Homey

Install **E3DC – HKW** from the [App Store](https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/) (or a [test build](https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/test/) when announced in the forum).

Add device **HKW / HPS** first. You need:

| Field | Purpose |
|-------|---------|
| Portal username + password | RSCP authentication only (not continuous cloud control) |
| RSCP password | Encryption password set on the station |
| IP | Station address |
| Port | Usually **5033** |

Then add optional devices: Grid meter, Battery monitor, Wallbox(es), Statistics, Energy summary, PV forecast — each linked to the HKW.

Use **Repair** on the HKW to change IP/credentials without deleting the device.

## 4. Homey Energy

1. Add **Grid meter**  
2. Add **Battery monitor**  
3. Check Homey Energy import/export and battery graphs  

## 5. Widgets

Dashboard → add **E3DC-HKW**, optional Wallbox / Ladeplaner widgets. Select plant if you have more than one HKW. See [Widgets](../widgets.md).

## 6. Troubleshooting

| Symptom | Check |
|---------|--------|
| No connection | IP, RSCP password, port 5033, same network, station online |
| Frequent offline | Wi‑Fi/repeater, VLAN, DHCP change → fixed IP + Repair |
| Wrong battery size | HKW battery settings override |
| Wallbox ignores flow | Active Ladeplaner may take priority; use conditions + diagnostic report |
| No island push | Path to HKW during outage; see [Flows – island mode](../flows.md) |

Enable **detailed diagnostics** on the HKW only while reproducing a problem, then export the report (no passwords) for the [forum](https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181).
