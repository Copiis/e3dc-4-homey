# Flows & EMS

Details: [Docs – Flows](https://copiis.github.io/e3dc-4-homey/flows/)

## Power Modes (HKW)

- Auto  
- Idle  
- Charge / Discharge  
- Grid Charge (Akkunetzladen)  

**Aktive Pläne (HKW-Ladeplaner-Widget) haben Vorrang** vor manuellen Flow-Befehlen.

## Wichtige HKW-Karten

- Lade-/Entladelimits setzen/entfernen  
- Manuelle Speicherladung (Wh oder %)  
- Notstromreserve  
- **Inselbetrieb begonnen/beendet** — Push bei Stromausfall  
- Power Mode  
- PV-Überschuss-Trigger, SoC-unter-Schwellwert  

### Island Mode / Stromausfall

- Trigger, sobald das HKW **Inselbetrieb** meldet (nicht in der ersten Millisekunde)  
- Umschaltung HKW typisch ca. **5 s**  
- Homey **und** Netzpfad zum HKW (Switch/Kabel/Repeater) müssen erreichbar bleiben — sonst „HKW offline“ und ggf. **nachträglicher** Insel-Trigger nach Reconnect  

## Wallbox-Flows

- Laden freigeben / sperren  
- Sonnenmodus ein/aus  
- Stromstärke  
- Batterie vor Auto / Mix / entladen bis %  
- Fahrzeug-SOC setzen  

RSCP-Read-Back verhindert Doppelbefehle.

## Externes EMS

PV-Überschuss- und SoC-Trigger + Energy Summary / HKW-Leistungen (Ultimate EMS, Tibber-Helfer, …).
