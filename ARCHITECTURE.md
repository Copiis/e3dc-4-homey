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
- Punkt 1 (Wallbox): Vollständig umgesetzt
- Punkt 1 (JSDoc): VOLLSTÄNDIG umgesetzt – exzellentes JSDoc in allen Dateien (Manager, Utils, Models, Converters, Cards, Types). Punkt 1 abgeschlossen.
- Punkt 3 (Test-Qualität): Verbessert – bessere Mocks, Verhaltens-Tests, Edge-Cases in zentralen Test-Dateien
- Punkt 3: JSDoc in WallboxDevice (onInit, serialize, startScheduleChecker), Action Cards
- Punkt 4: Test zu Verhaltens-Test verbessert, letzte Kommentare bereinigt
- Deploy-Zyklus durchgeführt (Build + Install + Push)

### Verbleibende Schritte (Priorität)
1. Weitere `any` auf <80 bringen (rscp-api, action cards, wallbox internals). → **ERLEDIGT** (0 any)
2. Wallbox device.ts: Struktur angleichen (weniger Monolith, mehr Manager-Extraktion wo sinnvoll). → **ERLEDIGT** (vollständiges Aufräumen)
3. JSDoc überall vervollständigen + ARCHITECTURE weiter ausbauen (Design-Rationale). → **IN PROGRESS**
4. Test-Qualität: mehr Verhaltens- und Edge-Case-Tests. → **IN PROGRESS**

Jede Änderung in dieser Phase sollte den Code **sichtbar schöner** machen.

## Design-Entscheidungen & How-To

### Warum Manager-Extraktion?
Der ursprüngliche HomePowerStationDevice war >1600 Zeilen. Durch Extraktion in CapabilityManager, WallboxManager, EmsScheduleManager, PowerModeManager, DiagnosticManager etc. wird der Device auf ~420 Zeilen reduziert. Vorteile:
- Bessere Testbarkeit (Mocks für Device + Api)
- Single Responsibility
- Einfachere Wartung und Erweiterung

### Wie füge ich ein neues Feature sauber hinzu?
1. Prüfe, ob es in einen existierenden Manager passt.
2. Bei Bedarf neuen Manager anlegen (Dependency Injection über IHpsDevice + Factory).
3. Immer über `IHpsDevice` entkoppeln – nie direkt auf Device casten.
4. Neue Live-Daten-Felder → `processLivePowerData` oder spezifischen Sync-Methoden.
5. Flow-Karten immer über `FlowCardManager` + `bindDevice` registrieren.
6. JSDoc für public API + Eintrag in ARCHITECTURE.md.

### Warum `unknown` statt `any`?
- `any` deaktiviert TypeScript komplett.
- `unknown` zwingt zu expliziten Guards oder Casts → sicherer und lesbarer Code.
- Flow-Cards nutzen `Record<string, unknown>` als Kompromiss zur Homey-SDK.

### Logging & Error-Handling
- Alle Fehler gehen durch `formatError()`.
- Logger wird injected (kein globaler Zugriff).
- Kritische Events zusätzlich über `recordAnalysisEvent` für Diagnose.

### Wallbox vs. HKW
- HKW ist zentrales Gerät.
- Wallbox ist eigenständig, aber eng mit HKW-EMS verknüpft.
- Gemeinsame Logik (z.B. Schedules) wird wo sinnvoll in Utils/Manager gekapselt.
- Ziel: Beide Devices fühlen sich ähnlich "schön" an (gleiche Dokumentation, gleiche Patterns).

### Erweiterung von LiveData
Neue Felder in `src/model/live-data.ts` definieren → im Poller und Converter updaten → im CapabilityManager verarbeiten.

Dieses Dokument soll für Außenstehende (Athom-Dev oder neue Entwickler) sofort verständlich machen, warum der Code so aufgebaut ist.
