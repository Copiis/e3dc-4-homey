# Fehlerbehebung

## Häufige Probleme
- **Keine Verbindung:** IP prüfen, RSCP-Passwort korrekt, Port 5033 offen, feste IP.
- **Falsche Werte:** Vorzeichen bei Grid/Batterie beachten (E3DC-Konvention).
- **Ladepläne unterbrechen sich:** War ein bekanntes Problem mit 30s-Refresh – in aktuellen Versionen auf 10s Keep-Alive korrigiert.
- **Wallbox reagiert nicht:** Flow prüfen, ob Plan aktiv ist (Pläne haben Vorrang).
- **Stromausfall / Inselbetrieb nicht in Timeline oder Flow:** Homey **und der gesamte Netzwerkpfad zum HKW** (Router, Switch, **WLAN-Repeater**, Access Point) müssen während des Ausfalls weiterlaufen (USV oder **Notstromkreis des HKW**). Läuft z. B. nur Homey/Router auf USV, der **Repeater am HKW aber am normalen Netz**, ist das HKW für die App unerreichbar → Timeline **„HKW nicht erreichbar“**, kein Live-Insel-Trigger. Nach Strom-Wiederkehr bootet der Repeater erst (oft 30–90 s); sobald das HKW wieder antwortet: **„HKW wieder verbunden“** und — falls noch/im Inselbetrieb — **verspätete** Meldung **„Inselbetrieb erkannt nach Wiederverbindung“** + Flow. Live ohne Delay nur mit durchgehendem Netzpfad. HKW-Umschaltung selbst ca. **5 s**. Flow-Karte: **„Inselbetrieb (Notstrom) begonnen“**.

## Diagnose
In den Einstellungen des HKW-Geräts:
- „Detaillierte Diagnoseaufzeichnung aktivieren“
- Bericht exportieren und im Forum posten (ohne sensible Daten).

## Logs
Homey-App-Logs und RSCP-Debug (im Gerät) nutzen.

## Weitere Hilfe
Immer Modell, Firmware und den Diagnosebericht angeben.

