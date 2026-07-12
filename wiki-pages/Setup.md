# Setup

## RSCP am Hauskraftwerk aktivieren
Standardmäßig ist RSCP deaktiviert. Du musst einmal physisch am Gerät sein:

1. Hauptmenü öffnen
2. „Personalisieren“ wählen
3. „Profil“ wählen
4. Nach unten scrollen und ein **RSCP-Passwort** setzen (die kleine Lampe muss grün werden)

## Pairing in Homey
Benötigte Daten:
- Portal-Benutzername + Passwort (wird für die RSCP-Auth verwendet)
- RSCP-Passwort (das gerade gesetzte)
- IP-Adresse des HKW (fest vergeben im Router empfohlen!)
- Port: meist 5033

Füge das **Home-Power-Station**-Gerät hinzu. Alle anderen Geräte (Wallbox, Grid, Batterie-Module) hängen am HKW.

## Weitere Tipps
- Stelle sicher, dass Homey und HKW im gleichen Netzwerk sind.
- Firewall/Ports: 5033 (RSCP) muss erreichbar sein.
- Bei Problemen: Detaillierte Diagnose in den HKW-Einstellungen aktivieren und Bericht exportieren.

