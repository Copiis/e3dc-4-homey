# Flows & EMS

Flow cards are registered on the **HKW** and **Wallbox** drivers (device-level cards).

## HKW — triggers

| Card (EN sense) | Notes |
|-----------------|--------|
| Firmware updated | After station firmware change |
| Max charge / discharge limit changed | |
| Manual battery charging started / stopped | |
| **Island mode started / stopped** | Notstrom / island — use for outage push |
| Emergency power reserve changed | |
| House / battery / grid power changed | Custom power capabilities |
| **PV surplus exceeds …** | Threshold trigger |
| **Battery SoC below …** | Threshold trigger |

## HKW — conditions

- Max charge/discharge limit greater/less, active or not
- Any power limit active
- Manual charge active
- Emergency reserve greater/less
- Island mode active / possible

## HKW — actions

- Set / remove max charge power, max discharge power, all limits
- Activate / deactivate configured station limits
- Provide current charging configuration (tokens)
- Manual charge by amount (Wh) or to SoC %; stop manual charge
- **Power modes:** auto · idle · force charge · force discharge · **grid charge**
- Configure / remove emergency reserve
- Export diagnostic report

### Power modes

| Mode | Behaviour (summary) |
|------|---------------------|
| Auto | Normal EMS on the station |
| Idle | Pause battery |
| Charge / Discharge | Force charge or discharge |
| Grid charge | Charge battery from grid (duration or until SoC depending on card args) |

**Active HKW charge plans** (Ladeplaner widget) override manual power-mode commands.

### Island mode tips

- Trigger fires when the station reports island / emergency power — not necessarily in the first second of a blackout
- Delayed report after reconnect is intentional if Homey could not reach the HKW during the outage
- Keep Homey and the path to the HKW on UPS/notstrom where possible

## Wallbox — conditions

- Sun mode on / off
- Charging allowed / blocked  

Use conditions **before** actions and notifications so the flow branch stops when already in the desired state.

## Wallbox — actions

| Action | Purpose |
|--------|---------|
| Allow / block charging | Mixed-mode allow or pause |
| Sun mode on / off | PV surplus mode |
| Set sun mode / set charge current | Advanced / legacy variants |
| Battery before car (sun mode priority) | Ladepriorität |
| Battery discharge in sun mode | Hausakku → Auto (sun) |
| Discharge battery until % | Min home-battery SoC for EV discharge |
| Battery discharge in mixed mode | Mix-mode Hausakku |
| **Set vehicle SOC** | Push SoC from Flow (e.g. Tesla token) |

Actions **read back** RSCP (`EXTERN_DATA_ALG`) and skip redundant writes (`skipped: true` when already correct).

## External EMS

Use **PV surplus** and **SoC below** triggers plus Energy Summary / HKW power capabilities with apps such as Ultimate EMS, Tibber helpers, Power by the Hour, etc.

## Example (no double push)

```
WHEN  [Wallbox] sun mode is off
THEN  [Wallbox] sun mode on
AND   Push notification "Sun mode on"
```
