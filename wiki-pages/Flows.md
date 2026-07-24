# Flows & EMS

## Power Modes (EMS)
- Auto
- Idle
- Charge / Discharge
- Grid Charge (Akkunetzladen) – mit Dauer oder untilSoc

Wichtig: Aktive Pläne (Ladeplaner-Widget) haben Vorrang vor manuellen Flow-Befehlen.

## Wichtige Flow-Karten (HKW)
- Power Limits setzen/entfernen
- Manueller Batterie-Ladevorgang (Wh oder %)
- Emergency Reserve
- Island Mode („Inselbetrieb (Notstrom) begonnen/beendet“) — für Push bei Stromausfall
- Power Mode (mit Dauer)
- PV Surplus Trigger, SoC Trigger

### Island Mode / Stromausfall
- Trigger, sobald das HKW in den **Inselbetrieb** wechselt (Notstrom aktiv), nicht „Netzspannung = 0“ in der ersten Millisekunde.
- HKW-Umschaltung dauert typisch ca. **5 s**; Homey/Router (idealerweise USV) **und** der Pfad zum HKW (Switch/Kabel/**WLAN-Repeater**) müssen den Ausfall überstehen — sonst kein Poll und kein Push. Repeater ohne Notstrom = HKW „offline“, auch wenn Homey auf USV läuft.

## Wallbox Flows
- Erlauben / Blockieren
- Sonnenmodus
- Stromstärke
- Batterie vor Auto / Mix-Modus
- Entlade Hausakku bis %

RSCP Read-Back wird verwendet, um Doppelbefehle zu vermeiden.

## Tipps für externe EMS
Nutze die PV-Überschuss- und SoC-Trigger für Apps wie Ultimate EMS, Tibber, Power by the Hour etc.

