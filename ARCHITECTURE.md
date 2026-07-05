# Architecture Notes – e3dc-4-homey

**Ziel dieses Refactorings:** Der Code soll so sauber, konsistent und professionell sein, dass ein Athom-Entwickler beim Review von der Qualität und Klarheit überwältigt ist.

## Kern-Architektur

Die App wurde von einem großen Monolithen (`drivers/home-power-station/device.ts` mit >1600 Zeilen) in eine klare, schichtbasierte Struktur überführt.

### Hauptkomponenten

- **HomePowerStationDevice** (der zentrale Geräte-Treiber)
  - Nur noch ~380–400 Zeilen
  - Verantwortlich für Initialisierung, Polling-Steuerung und Koordination
  - Enthält fast keine Fachlogik mehr

- **Manager** (in `src/managers/`)
  - `CapabilityManager` – Capability-Updates, Linked-Devices, Change-Handling
  - `DiagnosticManager` – Diagnose-Reports, Analyse-Logs, Auto-Off
  - `EmsScheduleManager` – Ladepläne, Power-Mode-Scheduling, Trigger
  - `PowerModeManager` – Aktueller Power-Mode-State + Refresh/Expire
  - `WallboxManager` – Wallbox-Erkennung, Sync, Aggregation

- **Polling**
  - `LiveDataPoller` (`src/utils/polling.ts`) – zentrale, debounce-fähige Live-Data-Abfrage
  - Keine Timer mehr direkt in den Geräten (außer wo absolut notwendig)

- **RSCP-Schicht**
  - `RscpApi`
  - `RscpTagRegistry` (zentral, typsicher, keine Hardcoded-Tag-Dateien mehr)
  - Converter (z. B. `wallbox-extern-alg-parser`, Live-State-Converter)

- **Cards**
  - Alle Flow-Karten sind in `src/cards/` modular ausgelagert (FlowCardManager)

### Design-Prinzipien (für Athom-Reviewer)

- **Single Responsibility**: Jeder Manager hat einen klaren Verantwortungsbereich.
- **Dependency Injection** über Interfaces (`IHpsDevice`).
- **Keine Magic**: Keine Hardcoded Tags mehr, keine Byte-Manipulation außerhalb dedizierter Parser.
- **Testbarkeit**: Manager sind unit-testbar (Mocks für Device + Api).
- **Konsistenz**: Alle Treiber (auch Wallbox & Energy-Summary) sollen dem gleichen Qualitätsstandard folgen.

## Aktueller Fokus (Athom Beauty)

Siehe `PROJEKT-REGELN.md` → Abschnitt "Aktueller Fokus: Athom Beauty".

### Fortschritt (2026-07-05 Session)
- ✅ **Alle `as any as IHpsDevice` Casts im HKW-Device eliminiert**  
  `HomePowerStationDevice` deklariert die benötigten Trigger- und State-Properties explizit und implementiert die erforderlichen Methoden (Delegation an DiagnosticManager).
- ✅ `IHpsDevice` stark verbessert: konkrete Typen für Trigger (z. B. `SimpleValueChangedTrigger<number>`) und States statt `unknown`.
- ✅ CapabilityManager weitgehend von `as any` befreit; saubere `PowerDataChanges` Schnittstelle.
- ✅ LiveDataPoller cast entfernt (PollerLogger mit Logger kompatibel).
- `any`-Count in `src/` von ~167 auf ~140 gesenkt.
- Tests angepasst und alle grün.
- Install + Push durchgeführt.

### Verbleibende Schritte (Priorität)
1. Weitere `any` reduzieren (Ziel < 100).
2. Wallbox-Driver (`drivers/wallbox/device.ts`) auf gleiches Niveau bringen.
3. Exzellente JSDoc überall + ARCHITECTURE.md weiter ausbauen.
4. Letzte Hacks (z. B. `['triggeredEmsSchedules']`, `@ts-ignore`) entfernen.

Jede Änderung in dieser Phase sollte den Code **sichtbar schöner** machen.
