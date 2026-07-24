# Fehlerbehebung

## Häufige Probleme
- **Keine Verbindung:** IP prüfen, RSCP-Passwort korrekt, Port 5033 offen, feste IP.
- **Falsche Werte:** Vorzeichen bei Grid/Batterie beachten (E3DC-Konvention).
- **Ladepläne unterbrechen sich:** War ein bekanntes Problem mit 30s-Refresh – in aktuellen Versionen auf 10s Keep-Alive korrigiert.
- **Wallbox reagiert nicht:** Flow prüfen, ob Plan aktiv ist (Pläne haben Vorrang).
- **Stromausfall / Timeline-Meldungen:**
  1. HKW offline → **„HKW nicht erreichbar — Strom- oder Internetausfall?“**
  2. Wieder erreichbar + Inselbetrieb → **„Netzausfall — HKW im Inselbetrieb!“** + Flow **„Inselbetrieb begonnen“** (auch **nachträglich**, wenn der Wechsel offline verpasst wurde)
  3. Wieder Normalbetrieb → **„Netz wieder da — HKW im Normalbetrieb!“** + Flow **„Inselbetrieb beendet“**
- **Repeater ohne Notstrom:** Während Offline kein Live-Trigger; sobald das HKW wieder antwortet, werden Insel-Flows **nachträglich** ausgelöst, wenn der Zustand erkannt wird. Live ohne Delay nur mit durchgehendem Netzpfad (USV/Notstrom). HKW-Umschaltung selbst ca. **5 s**.

## Diagnose
In den Einstellungen des HKW-Geräts:
- „Detaillierte Diagnoseaufzeichnung aktivieren“
- Bericht exportieren und im Forum posten (ohne sensible Daten).

## Logs
Homey-App-Logs und RSCP-Debug (im Gerät) nutzen.

## Weitere Hilfe
Immer Modell, Firmware und den Diagnosebericht angeben.

