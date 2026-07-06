# Contributing to e3dc-4-homey

Danke für dein Interesse! Dieses Projekt strebt **Athom Code Winner** Qualität an: sauber, typsicher, testbar, dokumentiert.

## Wichtige Regeln (immer beachten)

- Lies zuerst `PROJEKT-REGELN.md` (lokal, via Syncthing) und `ARCHITECTURE.md`.
- **Backup vor jeder Code-Änderung:** `./backup-file.sh <file> <thema>`
- TypeScript: `npm run build` muss grün sein.
- **any = 0, @ts-ignore = 0** — `unknown` + Guards verwenden.
- Single Responsibility: Neue Logik in Manager/Utils extrahieren (siehe WallboxChargingManager, EmsScheduleUtils).
- Flow-Karten: Geräte-Ebene bevorzugen; Registrierung über `FlowCardManager` wo möglich.
- Tests: Verhaltens- und kritische Pfad-Tests (Lifecycle, Fehler, Concurrent, User-Journeys wie "Wallbox + Ladeplan + PV").
- JSDoc für public APIs + Update von ARCHITECTURE.md bei Design-Änderungen.
- Keine Credentials, keine .bak ins Repo.

## Coding Conventions (kurz)

- Manager-Architektur: Device = dünner Koordinator + DI über Interfaces (IHpsDevice).
- Logging/Error immer über injected logger + `formatError`.
- Serialize bei RSCP-Kommandos mit parallelen Flows.
- Polling nur über LiveDataPoller.
- Nach Arctic-Änderung: Build + install + commit + push automatisch (siehe Regeln).

## Workflow

- Kleine, fokussierte Changes.
- Bei Refactor: Größe von Device.ts prüfen (Ziel dünn wie HKW ~20kB).
- Neue Contributor: siehe `doku/` und `ARCHITECTURE.md` für Einstieg.

## Fragen / Issues

Forum: https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181

Viel Spaß — Ziel ist Code, den man Athom-Entwicklern stolz zeigt!
