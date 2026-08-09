# Fehlerbehebung

Siehe auch [Setup](https://copiis.github.io/e3dc-4-homey/setup/setup/) und [Forum](https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181).

## Häufige Probleme

- **Keine Verbindung:** IP, RSCP-Passwort, Port 5033, gleiches Netz, feste IP, **Repair**  
- **Repair zeigt `unknown_error_getting_file` (my.homey.app):** Repair-View fehlte unter `drivers/.../repair/` (nur `pair/`). Fix ab nächstem Release; **Workaround:** Zugangsdaten in den **HKW-Geräteeinstellungen** ändern (IP, Portal, RSCP, Port) — speichern genügt.  
- **App-Crash bei offline HKW:** ab v1.8.61/62 gehärtet — bei alten Builds updaten  
- **Falsche Werte:** Vorzeichen Grid/Batterie (E3DC-Konvention); Kapazität manuell am HKW setzen  
- **Wallbox reagiert nicht:** Ladeplan aktiv? Bedingungen nutzen; Diagnosebericht  
- **Fahrzeug-SOC 0 %:** Wallbox-Einstellung Auto / Homey-Auto-Gerät; Flow „Fahrzeug-SOC setzen“  
- **Stromausfall / Timeline:**  
  1. HKW offline → „HKW nicht erreichbar…“  
  2. Wieder erreichbar + Insel → „Netzausfall — HKW im Inselbetrieb!“ + Flow (auch nachträglich)  
  3. Normalbetrieb → „Netz wieder da…“  
- **Repeater ohne Notstrom:** während Offline kein Live-Insel-Trigger  

## Diagnose

HKW-Einstellungen → detaillierte Diagnose (opt-in, ~60 min Auto-Aus) → Bericht exportieren (ohne Passwörter).

Immer Modell, Firmware und App-Version angeben.
