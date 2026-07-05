# Homey Energy-Apps: GitHub-Vergleich für e3dc-4-homey

**Stand:** 28.06.2026  
**Ziel:** Feature-Ideen aus vergleichbaren Homey-Pro-Apps (Solar, Batterie, Wallbox, Netz, EMS, dynamische Tarife) für das Community-Projekt [e3dc-4-homey](https://github.com/Copiis/e3dc-4-homey) ableiten.

**Methodik:**
- App-Store-Recherche auf [homey.app/de-de/apps/homey-pro/](https://homey.app/de-de/apps/homey-pro/) (Kategorie „Energiesparen“, Suche nach Marken/EMS)
- GitHub-Quellen über Store-Link „Quellcode“, Issues-Links und Repository-Suche
- Code-Scan (wo öffentlich): `meter_power`, `homeBattery`, `evcharger`, Widgets, Timeline, Repair/Diagnose, Scheduling, dynamische Preise

**Prioritäts-Legende für e3dc-4-homey:**
| Priorität | Bedeutung |
|-----------|-----------|
| **Hoch** | Direkt vergleichbar (All-in-One HKW) oder klarer Feature-Gap |
| **Mittel** | Teilweise relevant / Kombination mit E3DC in Flows |
| **Niedrig** | Nur Randbezug oder geschlossene Quelle |

---

## 1. Kurzüberblick (Top-Vergleichs-Apps)

| App | App-ID | Store | GitHub | Priorität |
|-----|--------|-------|--------|-----------|
| **E3DC – HKW** (Referenz) | `de.jnkconsulting.e3dc.v2` | [Store](https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/) | [Copiis/e3dc-4-homey](https://github.com/Copiis/e3dc-4-homey) | — |
| Sigenergy | `com.sigenergy` | [Store](https://homey.app/de-de/app/com.sigenergy/Sigenergy/) | [ricott/homey-com.sigenergy](https://github.com/ricott/homey-com.sigenergy) | **Hoch** |
| SMA Energy | `sma.modbus` | [Store](https://homey.app/de-de/app/sma.modbus/SMA-Energy/) | [ricott/sma.modbus](https://github.com/ricott/sma.modbus) | **Hoch** |
| Victron Energy | `com.victronenergy` | [Store](https://homey.app/de-de/app/com.victronenergy/Victron-Energy/) | [ricott/homey-com.victronenergy](https://github.com/ricott/homey-com.victronenergy) | **Hoch** |
| SolarEdge + Growatt modbus | `solaredge.modbus` | [Store](https://homey.app/de-de/app/solaredge.modbus/SolarEdge-+-Growatt-TCP-modbus/) | [biemond/solaredge.modbus](https://github.com/biemond/solaredge.modbus) | **Hoch** |
| Ultimate EMS | `com.ultimate.ems` | [Store](https://homey.app/de-de/app/com.ultimate.ems/Ultimate-EMS/) | Store verweist auf privates Repo | **Hoch** |
| Power by the Hour | `com.gruijter.powerhour` | [Store](https://homey.app/de-de/app/com.gruijter.powerhour/) | [gruijter/com.gruijter.powerhour](https://github.com/gruijter/com.gruijter.powerhour) | **Hoch** |
| HomeWizard | `com.homewizard` | [Store](https://homey.app/de-de/app/com.homewizard/) | [jtebbens/com.homewizard](https://github.com/jtebbens/com.homewizard) | **Mittel** |
| go-e Charger | `com.go-e.charger` | [Store](https://homey.app/de-de/app/com.go-e.charger/) | [oh2th-homey/com.go-e.charger](https://github.com/oh2th-homey/com.go-e.charger) | **Mittel** |
| Tibber | `com.tibber` | [Store](https://homey.app/de-de/app/com.tibber/) | [tibber/com.tibber.athom](https://github.com/tibber/com.tibber.athom) | **Mittel** |
| Fronius | `com.thomashoussin.fronius` | [Store](https://homey.app/de-de/app/com.thomashoussin.fronius/Fronius/) | [ThomasHoussin/com.thomashoussin.fronius](https://github.com/ThomasHoussin/com.thomashoussin.fronius) | **Mittel** |
| Sungrow (Cloud) | `com.sungrowpower` | [Store](https://homey.app/de-de/app/com.sungrowpower/Sungrow/) | [gruijter/com.sungrowpower](https://github.com/gruijter/com.sungrowpower) | **Mittel** |
| Reflexion | `se.innomenta.reflexion` | [Store](https://homey.app/de-de/app/se.innomenta.reflexion/Reflexion/) | Nur Issues: [fgeorgsson/se.reflexion.homey-public](https://github.com/fgeorgsson/se.reflexion.homey-public) | **Mittel** |
| PVOutput | `org.pvoutput` | [Store](https://homey.app/de-de/app/org.pvoutput/) | [gruijter/org.pvoutput](https://github.com/gruijter/org.pvoutput) | **Mittel** |
| Easee Home | `no.easee` | [Store](https://homey.app/de-de/app/no.easee/) | Geschlossen (Legacy: [ricott/homey-no.easee](https://github.com/ricott/homey-no.easee)) | **Mittel** |
| Tesla Car & Energy | `com.tesla.car` | [Store](https://homey.app/de-de/app/com.tesla.car/) | [RonnyWinkler/homey.tesla](https://github.com/RonnyWinkler/homey.tesla) | **Mittel** |
| Teslemetry | `com.teslemetry` | [Store](https://homey.app/de-de/app/com.teslemetry/) | [teslemetry/homey](https://github.com/teslemetry/homey) | **Niedrig** |
| Enphase | `com.enphase` | [Store](https://homey.app/de-de/app/com.enphase/Enphase/) | [Drenso/com.enphase](https://github.com/Drenso/com.enphase) | **Niedrig** |
| EcoFlow | `com.ecoflow` | [Store](https://homey.app/de-de/app/com.ecoflow/) | Geschlossen | **Niedrig** |
| Frank Energie | `nl.frank-energie` | [Store](https://homey.app/de-de/app/nl.frank-energie/) | Geschlossen | **Niedrig** |
| Toon | `nl.eneco.toon` | [Store](https://homey.app/de-de/app/nl.eneco.toon/) | Athom-offiziell (geschlossen) | **Niedrig** |

---

## 2. Referenz: e3dc-4-homey (aktueller Stand)

| Feld | Wert |
|------|------|
| **Name** | E3DC – HKW |
| **App-ID** | `de.jnkconsulting.e3dc.v2` |
| **Store** | https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/ |
| **GitHub** | https://github.com/Copiis/e3dc-4-homey |
| **Geräte** | HKW (`solarpanel`), Batteriemonitor (`battery`+`homeBattery`), Netz (`sensor`, import/export), Wallbox (`evcharger`), Statistiken (`sensor`) |
| **Protokoll** | Lokal RSCP/TCP |

### Bereits umgesetzte Stärken (Code-Basis)
1. **Homey Energy:** `meter_power`, `meter_power.imported`/`exported`, `meter_power.charged`/`discharged`, `measure_power` am HKW
2. **Wallbox:** `evcharger`-Klasse, `evcharger_charging`/`evcharger_charging_state`, Sonnenmodus, Ladepriorität, Batterie-Entladegrenze
3. **Timeline:** HKW online/offline, Inselbetrieb, Firmware, Wallbox-Ereignisse (`postTimelineNotification`)
4. **Widget:** `power-overview` mit konfigurierbaren Sichtbarkeits-Flags pro HKW
5. **Diagnose:** Persistenter Analyse-Log, Settings-Textarea, Flow-Karte „Diagnosebericht erstellen“
6. **Flows:** Umfangreiche HKV-Steuerung (Lade-/Entlade-Limits, manuelle Ladung, Notstromreserve), Wallbox mit Zustandsprüfung vor RSCP-Befehl
7. **Historie:** Tageswerte Netz aus E3DC-DB (Portal-konform) + kumulative Energy-Counter

### Bekannte Lücken vs. Top-Konkurrenz
- Kein integriertes **Day-Ahead-/Spotpreis-EMS** (nur über externe Apps wie PBTH/Tibber)
- Kein **Live-Energy-Summary-Widget** mit PV/Netz/Akku/Verbrauch-Flow-Diagramm (nur Übersichts-Widget)
- Kein **PVOutput-Upload** / externe Reporting-API
- Kein **Repair-Flow** bei IP/Verbindungsverlust (nur Diagnose)
- Keine **Ladeplanung** (Schedule) für Wallbox/Batterie auf App-Ebene

---

## 3. Detailanalyse: All-in-One Systeme (höchste Vergleichbarkeit)

### 3.1 Sigenergy — Priorität: **Hoch**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.sigenergy/Sigenergy/ |
| **GitHub** | https://github.com/ricott/homey-com.sigenergy |
| **Stack** | Modbus TCP lokal — Batterie, WR, Energy Meter, EV AC/DC Charger, Plant |

**Feature-Ideen für e3dc:**
1. **Live-View-Widgets** (`live-view`, `live-view-compact`) — Echtzeit-Energiefluss fürs Dashboard
2. **EV DC Charger:** Session-Counter `meter_power.session_*`, getrennte Lade-/Entladeleistung, V2H-relevante Flow-Actions
3. **Plant-Gerät** als Aggregator — vergleichbar zu E3DC „Statistiken“-Driver, aber mit Live-View-Anbindung
4. **Energy Meter** mit `meter_power.imported`/`exported` und Phasen-Details — Vorbild für Netz-Gerät (E3DC hat das bereits)
5. **Alarm-/Firmware-Trigger** für Systemwarnungen — ergänzend zu E3DC-Timeline

**Code-Hinweise:** `drivers/battery` mit `homeBattery: true`; `evdccharger` mit vollem `evcharger`-Capability-Set und Energy-Properties.

---

### 3.2 SMA Energy — Priorität: **Hoch**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/sma.modbus/SMA-Energy/ |
| **GitHub** | https://github.com/ricott/sma.modbus |
| **Stack** | Modbus/Multicast — WR, Batterie, Energy Meter, Energy Summary, PVOutput |

**Feature-Ideen für e3dc:**
1. **Energy-Summary** (virtuelles Gerät): PV + Netz + Batterie + Verbrauch aus App-internen Geräten aggregieren
2. **Realtime Energy Summary Widget** — direktes UI-Vorbild für erweitertes `power-overview`
3. **PVOutput-Integration** (eigener Driver) — Live-Upload von Erzeugung/Verbrauch
4. **Export-Limit per Flow** (Home Manager) — analog E3DC-Netz-/Überschuss-Steuerung
5. **Repair-Flow** bei Verbindungsverlust mit Auto-Discovery + manuellem Fallback (`drivers/inverter/driver.js`, `drivers/battery/driver.js`)
6. **Active Power Curtailment (%)** vs. Flash-wear-Warnung bei direkter Leistungsbegrenzung — gutes UX-Muster für WR-Steuerung

---

### 3.3 Victron Energy — Priorität: **Hoch**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.victronenergy/Victron-Energy/ |
| **GitHub** | https://github.com/ricott/homey-com.victronenergy |
| **Stack** | GX/VRM lokal — ESS, Batterie, PV, EV Charger, Generator |

**Feature-Ideen für e3dc:**
1. **Ladeplanung (Charging Schedules)** — Create/Enable/Disable per Flow + Bedingung „Scheduled charging active“ (`app.js`)
2. **Dynamic ESS / VRM API** — Trade vs. Green Mode; Tarif-/Ökologie-Modus
3. **Grid Setpoint / Min SoC / Discharge Limit** als Flow-Actions — vergleichbar E3DC Lade-/Entlade-Limits + Notstromreserve
4. **Alarm & Warning Trigger** auf GX (`alarm status changed`) — Timeline-Erweiterung
5. **`meter_power.charged`/`discharged`** am Batterie-Gerät für Homey Energy (Changelog 1.5.4)
6. **EV Charger:** Modus + Max-Current-Steuerung getrennt

---

### 3.4 SolarEdge + Growatt TCP modbus — Priorität: **Hoch**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/solaredge.modbus/SolarEdge-+-Growatt-TCP-modbus/ |
| **GitHub** | https://github.com/biemond/solaredge.modbus |
| **Stack** | Modbus TCP — SolarEdge, Sungrow, Huawei, Kostal, Growatt, Sigenergy, Solax … |

**Feature-Ideen für e3dc:**
1. **Tages- + Gesamt-Energie-Capabilities** (`meter_power.daily`, getrennte Import/Export/Today-Werte) — E3DC Netz hat Tageswerte; auf HKW/Wallbox ausweiten
2. **Export-Limit / Zero-Export** Flow-Actions (Sungrow, Growatt, SolarEdge Storedge)
3. **Batterie-Modi** (Charge/Discharge Mode, Use Mode) als Trigger + Action
4. **Zeitfenster-Steuerung** (Growatt TL-X: 4 Zeitfenster) — Inspiration für Wallbox-/Akku-Schedule
5. **Breite Trigger-Matrix** (Netzimport/-export, Batterieladeleistung, Verbrauch) — Flow-Karten-Qualität als Benchmark

*Hinweis:* Nicht E3DC-spezifisch, aber stärkstes Beispiel für **hybride System-Steuerung über Modbus** in einer App.

---

### 3.5 Ultimate EMS — Priorität: **Hoch** (Konzept, Code eingeschränkt)

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.ultimate.ems/Ultimate-EMS/ |
| **GitHub** | Store: `github.com/b2hvty299s-ux/com.ems.homey` — **Repository nicht öffentlich** (Stand 06/2026) |
| **Stack** | Meta-EMS über Homey — koordiniert PV, Akku, EV, WP, Tarife |

**Feature-Ideen für e3dc (aus Store/Flows, kein Voll-Code-Scan):**
1. **Tagesplanung** mit Wetter + PV-Prognose + Preisen (`Recalculate day plan`, Widgets „EMS Today/Tomorrow“)
2. **EMS-zu-EV-Delegation:** Trigger „EMS wants to set EV charge current“ / start/stop — E3DC-Wallbox als Zielgerät in Advanced Flows
3. **Trip-Planung:** Ziel-SoC bis Abfahrtszeit
4. **Dump-Load / Priority-System** bei Überschuss
5. **Spike-Filter** für kurze Lastspitzen (Quooker etc.)
6. **4 Dashboard-Widgets:** EMS Status, Chart, EV Charging, PV Fleet

*Strategie für e3dc:* Nicht eigenes EMS bauen, sondern **reiche Flow-Schnittstellen** bereitstellen (SoC, PV-Überschuss, Wallbox-Steuerung, Preis-Trigger via PBTH), damit Ultimate EMS E3DC als Datenquelle nutzen kann.

---

## 4. Wallbox & EV-Laden

### 4.1 go-e Charger — Priorität: **Mittel**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.go-e.charger/ |
| **GitHub** | https://github.com/oh2th-homey/com.go-e.charger |

**Feature-Ideen:**
1. **Detaillierte Ladetransaktion** (`meter_power.session`, benannte Session-Meter 1–10)
2. **Phasen-Umschaltung** 1↔3 und Trigger „Ladephasen geändert“
3. **Zustands-Trigger:** Auto verbunden, Laden erlaubt, Transaktion/Karten-Auth
4. **APIv2 lokale LAN-Anbindung** — vergleichbar E3DC RSCP (kein Cloud-Zwang)

---

### 4.2 Easee Home — Priorität: **Mittel**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/no.easee/ |
| **GitHub** | **Geschlossen** (offiziell); Legacy: https://github.com/ricott/homey-no.easee |

**Feature-Ideen (Store):**
1. **Lade-Schedule** erstellen/löschen/override per Flow
2. **Dynamic Circuit Current** (phasenweise) + Equalizer für **Hauptsicherungs-Monitoring**
3. **Smart Charging** enable/disable mit Flash-Wear-Hinweisen in Flow-Karten
4. **Phasen-Auslastung** in % als Trigger/Bedingung

*Relevanz für E3DC:* Lastmanagement-Flows (z. B. Wallbox-Strom reduzieren wenn Netzlimit erreicht) — E3DC liefert Netz/Hausverbrauch, Easee/EMS reagiert.

---

### 4.3 Tesla Car & Energy (RonnyW) — Priorität: **Mittel**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.tesla.car/ |
| **GitHub** | https://github.com/RonnyWinkler/homey.tesla |

**Feature-Ideen (Timeline/UX-Vorbild):**
1. **`createNotification()`** bei Fehlern (Telemetry, App-Registrierung) — Vorbild für E3DC Willkommens-/Status-Meldungen
2. **`insightsTitleTrue/False`** auf Boolean-Capabilities (Laden, Online, Kofferraum …) — Vorbild für Wallbox-Zeitleiste
3. **Versteckte Insight-Capability** (`device_state_insights`) für Online/Offline ohne Kachel-Chaos
4. **Willkommens-Meldung nach Update** (auskommentiert in `app.js`, Pattern übernommen in e3dc v1.6.8)

---

### 4.4 Teslemetry — Priorität: **Niedrig**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.teslemetry/ |
| **GitHub** | https://github.com/teslemetry/homey |

**Feature-Ideen:** Powerwall + Solar + Gateway + Wall Connector in einem Ökosystem; Island-Mode-Timeline; Backup-Reserve per Flow. Nur relevant wenn Nutzer **externes** Tesla-Setup parallel zu E3DC-Wallbox haben.

---

## 5. Dynamische Tarife & EMS-Layer

### 5.1 Power by the Hour (PBTH) — Priorität: **Hoch**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.gruijter.powerhour/ |
| **GitHub** | https://github.com/gruijter/com.gruijter.powerhour |

**Feature-Ideen für e3dc:**
1. **Day-Ahead 15-Minuten-Preise** (ENTSO-E) als virtuelles Gerät mit dutzenden Preis-Trigger/Bedingungen
2. **Smart ROI Batteriemonitor** — berechnet optimale Lade-/Entladeleistung aus Preisdifferenz (kann E3DC-Batterie **über Flows** steuern, nicht nativ)
3. **PV-Überwachung** mit **selbstlernender Solarprognose** aus Homey Insights + Curtailment-Erkennung
4. **Strom-/Gas-/Wasser-Zähler** mit Stunden/Tag/Monat/Jahr-Aggregation — Vorbild für E3DC „Statistiken“-Erweiterung
5. **JSON-Export** der Preiszeitreihen für Advanced Flows

*Kombination:* E3DC liefert Hardware-Steuerung; PBTH liefert **Preislogik** — typisches Setup in der Community.

---

### 5.2 Tibber — Priorität: **Mittel**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.tibber/ |
| **GitHub** | https://github.com/tibber/com.tibber.athom |

**Feature-Ideen:**
1. **Umfangreiche Preis-Trigger** (niedrigste/höchste Stunden, % unter Durchschnitt, Zeitfenster)
2. **Pulse/Watty** mit Live-Verbrauch, Phasen, Kosten seit Mitternacht
3. **Watchdog** bei API-Ausfällen (24h Grace) — Robustheits-Muster für Cloud-Polling
4. **Nord Pool Preis-Cache** für Kostenschätzung (`drivers/watty/device.ts`)

---

### 5.3 Frank Energie — Priorität: **Niedrig**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/nl.frank-energie/ |
| **GitHub** | Geschlossen |

**Feature-Ideen:** Ähnliche Preis-Trigger wie Tibber (NL/DE-markt); nur als Flow-Partner für E3DC-Laden bei günstigen Stunden.

---

### 5.4 HomeWizard Battery Policy Manager — Priorität: **Mittel**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/com.homewizard/ |
| **GitHub** | https://github.com/jtebbens/com.homewizard |

**Feature-Ideen:**
1. **Policy Engine** mit Lernen, Wetterprognose, Trading-Styles (Eco/Balanced/Aggressive)
2. **Battery Planning Widget** — Tages-/Wochenplan visualisiert
3. **„Good time to run appliances“** Trigger (günstige Preisstunden oder PV > 500 W)
4. **Away/Home Mode**, manueller Override, EV-charging-aware Policy
5. **Repair** der Policy↔P1-Verknüpfung im Driver

*Relevanz:* Zeigt, wie man **ohne Hersteller-EMS** intelligente Akku-Steuerung in Homey baut — für E3DC eher Inspiration als 1:1-Portierung (E3DC hat eigenes EMS).

---

### 5.5 Reflexion — Priorität: **Mittel**

| | |
|--|--|
| **Store** | https://homey.app/de-de/app/se.innomenta.reflexion/Reflexion/ |
| **GitHub** | Nur öffentliches Issues/Wiki-Repo: https://github.com/fgeorgsson/se.reflexion.homey-public (**kein App-Code**) |

**Feature-Ideen (Store/Roadmap):**
1. **EMS-Modi** per Modbus (Exportlimit, Min/Max SoC, Lade-/Entladeleistung)
2. Geplante Features: Spotpreis-Optimierung, Peak Shaving, Hauptabsicherungs-Limit — explizit als **Paid EMS** positioniert

---

## 6. Weitere Solar/Batterie-Apps

### 6.1 Fronius — Priorität: **Mittel**

| **GitHub** | https://github.com/ThomasHoussin/com.thomashoussin.fronius |

**Feature-Ideen:**
1. **PowerFlow-Gerät** (PV, Netz, Last, Akku) — Aggregator wie SMA Energy Summary
2. **Reporting-Gerät** mit Kosten, Einsparung, Autarkiegrad (Datamanager-Archiv)
3. **Ohmpilot** als steuerbare Last (Überschussverbrauch)

---

### 6.2 Sungrow (Cloud) — Priorität: **Mittel**

| **GitHub** | https://github.com/gruijter/com.sungrowpower |

**Feature-Ideen:** Cloud-Anlage mit WR, Batterie, Meter, Car Charger; Import/Export-Energy-Trigger; Vorsicht bei Rate-Limits („Get status update“). Vergleichbar zu E3DC nur als **fremdes** Komplettsystem.

---

### 6.3 Enphase — Priorität: **Niedrig**

| **GitHub** | https://github.com/Drenso/com.enphase |

**Feature-Ideen:** Cloud IQ Battery + Inverter; Live-Leistung nur auf Homey Pro. Minimale Flows — wenig übertragbar außer Homey-Energy-Pattern.

---

### 6.4 PVOutput — Priorität: **Mittel**

| **GitHub** | https://github.com/gruijter/org.pvoutput |

**Feature-Ideen:**
1. **Uploader** mit Power, Energy, Consumption, Voltage, Temperature
2. **Upload-Intervall-Trigger** zur API-Schonung
3. Kombination mit SMA/E3DC: externe Erfolgsmessung & Community-Vergleich

---

### 6.5 EcoFlow — Priorität: **Niedrig**

| **GitHub** | Geschlossen (Drenso) |

**Feature-Ideen:** `homeBattery`-Energy-Properties für PowerOcean; Fehler-/Ladezustands-Trigger. Paralleles Ökosystem, nicht E3DC-Konkurrent.

---

## 7. Feature-Matrix (GitHub-Apps mit Code-Zugang)

| Feature | E3DC | Sigenergy | SMA | Victron | biemond SE | PBTH | HomeWizard | go-e |
|---------|:----:|:---------:|:---:|:-------:|:----------:|:----:|:----------:|:----:|
| `homeBattery` | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — |
| `evcharger` + Energy | ✅ | ✅ | — | ✅ | — | — | — | teils |
| `meter_power` import/export | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dashboard-Widget | ✅ | ✅✅ | ✅ | — | — | — | ✅ | — |
| Timeline | ✅ | — | — | — | — | — | teils | — |
| Repair / Reconnect | — | — | ✅ | — | — | — | ✅ | — |
| Diagnose-Export | ✅ | — | — | — | — | — | — | — |
| Lade-Schedule | — | — | — | ✅ | ✅ | — | — | — |
| Dynamische Preise | — | — | — | ✅* | — | ✅✅ | ✅ | — |
| PV-Prognose | — | — | — | — | — | ✅ | ✅ | — |
| PVOutput | — | ✅ | — | — | — | — | — | — |
| Energy Summary | teils** | ✅ | ✅ | — | — | — | — | — |

\* Victron Dynamic ESS über VRM  
\** E3DC „Statistiken“-Driver + Widget, kein separates Summary-Gerät

---

## 8. Top-10 Feature-Empfehlungen für e3dc-4-homey (priorisiert)

| # | Feature | Inspiration | Priorität | Aufwand (grob) |
|---|---------|-------------|-----------|----------------|
| 1 | **Erweitertes Energy-Summary-Gerät** (PV, Netz, Akku, Verbrauch, Wallbox) | SMA, Sigenergy, Fronius PowerFlow | **Hoch** | Mittel |
| 2 | **Live-View Widget v2** (kompakt + Flow-Diagramm) | Sigenergy, SMA Widget | **Hoch** | Mittel |
| 3 | **PVOutput-Uploader** (optional pro HKW) | SMA, org.pvoutput | **Mittel** | Niedrig |
| 4 | **Repair-Flow** bei RSCP-Verbindungsverlust | ricott/sma.modbus | **Hoch** | Mittel |
| 5 | **Wallbox-Ladeplanung** (Zeitfenster + Preis-Flow-Beispiele) | Easee, Victron, Growatt | **Mittel** | Mittel |
| 6 | **Spotpreis-Beispiel-Flows** (Doku + PBTH/Tibber-Integration) | PBTH, Tibber | **Hoch** | Niedrig (Doku) |
| 7 | **Mehr Tages-Capabilities** (`meter_power.daily` auf HKW/Wallbox) | biemond/solaredge.modbus | **Mittel** | Niedrig |
| 8 | **EMS-Trigger für externe Apps** (z. B. „PV-Überschuss > X“, „Akku-SoC < Y“) | Ultimate EMS | **Hoch** | Niedrig |
| 9 | **Timeline: Batterie-Lade-/Entlade-Events, Netzlimit** | Victron Alarms, Easee | **Mittel** | Niedrig |
| 10 | **Insights-/Prognose-Hinweis** (Doku: PBTH Solar-Monitor mit E3DC-PV koppeln) | PBTH | **Mittel** | Niedrig |

---

## 9. Store-URL-Index (≥ 20 Energy-Apps)

| # | App | URL |
|---|-----|-----|
| 1 | E3DC – HKW | https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/ |
| 2 | Sigenergy | https://homey.app/de-de/app/com.sigenergy/Sigenergy/ |
| 3 | SMA Energy | https://homey.app/de-de/app/sma.modbus/SMA-Energy/ |
| 4 | Victron Energy | https://homey.app/de-de/app/com.victronenergy/Victron-Energy/ |
| 5 | SolarEdge + Growatt modbus | https://homey.app/de-de/app/solaredge.modbus/SolarEdge-+-Growatt-TCP-modbus/ |
| 6 | Ultimate EMS | https://homey.app/de-de/app/com.ultimate.ems/Ultimate-EMS/ |
| 7 | Power by the Hour | https://homey.app/de-de/app/com.gruijter.powerhour/ |
| 8 | HomeWizard | https://homey.app/de-de/app/com.homewizard/ |
| 9 | Tibber | https://homey.app/de-de/app/com.tibber/ |
| 10 | Frank Energie | https://homey.app/de-de/app/nl.frank-energie/ |
| 11 | go-e Charger | https://homey.app/de-de/app/com.go-e.charger/ |
| 12 | Easee Home | https://homey.app/de-de/app/no.easee/ |
| 13 | Tesla Car & Energy | https://homey.app/de-de/app/com.tesla.car/ |
| 14 | Teslemetry | https://homey.app/de-de/app/com.teslemetry/ |
| 15 | PVOutput | https://homey.app/de-de/app/org.pvoutput/ |
| 16 | Fronius | https://homey.app/de-de/app/com.thomashoussin.fronius/Fronius/ |
| 17 | Sungrow | https://homey.app/de-de/app/com.sungrowpower/Sungrow/ |
| 18 | Reflexion | https://homey.app/de-de/app/se.innomenta.reflexion/Reflexion/ |
| 19 | Enphase | https://homey.app/de-de/app/com.enphase/Enphase/ |
| 20 | EcoFlow | https://homey.app/de-de/app/com.ecoflow/ |
| 21 | Toon | https://homey.app/de-de/app/nl.eneco.toon/ |
| 22 | Tigo | https://homey.app/de-de/app/com.tigoenergy/ |
| 23 | Heating Controller | https://homey.app/de-de/app/no.almli.heatingcontroller/ |
| 24 | myNexBlue | https://homey.app/de-de/app/com.nexblue/ |

---

## 10. Fazit

**e3dc-4-homey** ist im Homey-Ökosystem bereits eines der **vollständigsten lokalen All-in-One-Integrationen** (HKW + `homeBattery` + Netz + `evcharger` + Timeline + Diagnose + Widget). Die stärksten offenen GitHub-Vorbilder für die nächste Ausbaustufe sind:

1. **ricott/sma.modbus** und **ricott/homey-com.sigenergy** — Energy Summary, Widgets, Repair, PVOutput  
2. **ricott/homey-com.victronenergy** — Schedules, ESS-Steuerung, Alarm-Flows  
3. **gruijter/com.gruijter.powerhour** — dynamische Tarife & PV-Prognose (als Partner-App, nicht im E3DC-Repo nachbauen)  
4. **biemond/solaredge.modbus** — Tiefe Modbus-Steuerung & Tagesenergie-Capabilities  

Geschlossene oder Meta-Apps (**Ultimate EMS**, **Reflexion**-Kern, **Easee** offiziell) sollten über ** dokumentierte Flow-Schnittstellen** angebunden werden, statt deren Logik zu duplizieren.

---

*Erstellt als Recherche-Basis für das e3dc-4-homey-Projekt. GitHub-Stand geprüft am 28.06.2026.*