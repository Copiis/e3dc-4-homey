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

### Fortschritt (Punkte 1-4 Batch)
- Punkt 1: any 41 → 0 (ALL any eliminated. All flow cards now use Record<string, unknown> and unknown. Core was already clean.)
- Punkt 2: Wallbox komplett aufgeräumt – WallboxSchedule Interface, parse/revert/handleUntilFullStop Helper, Schedule-Methode stark vereinfacht, exzellentes JSDoc, onSettings sauberer
- Punkt 3: JSDoc in WallboxDevice (onInit, serialize, startScheduleChecker), Action Cards
- Punkt 4: Test zu Verhaltens-Test verbessert, letzte Kommentare bereinigt
- Deploy-Zyklus durchgeführt (Build + Install + Push)

### Verbleibende Schritte (Priorität)
1. Weitere `any` auf <80 bringen (rscp-api, action cards, wallbox internals).
2. Wallbox device.ts: Struktur angleichen (weniger Monolith, mehr Manager-Extraktion wo sinnvoll).
3. JSDoc überall vervollständigen + ARCHITECTURE weiter ausbauen (Design-Rationale).
4. Test-Qualität: mehr Verhaltens- und Edge-Case-Tests.

Jede Änderung in dieser Phase sollte den Code **sichtbar schöner** machen.
