# Fehlerbehebung

## Häufige Probleme
- **Keine Verbindung:** IP prüfen, RSCP-Passwort korrekt, Port 5033 offen, feste IP.
- **Falsche Werte:** Vorzeichen bei Grid/Batterie beachten (E3DC-Konvention).
- **Ladepläne unterbrechen sich:** War ein bekanntes Problem mit 30s-Refresh – in aktuellen Versionen auf 10s Keep-Alive korrigiert.
- **Wallbox reagiert nicht:** Flow prüfen, ob Plan aktiv ist (Pläne haben Vorrang).

## Diagnose
In den Einstellungen des HKW-Geräts:
- „Detaillierte Diagnoseaufzeichnung aktivieren“
- Bericht exportieren und im Forum posten (ohne sensible Daten).

## Logs
Homey-App-Logs und RSCP-Debug (im Gerät) nutzen.

## Weitere Hilfe
Immer Modell, Firmware und den Diagnosebericht angeben.

