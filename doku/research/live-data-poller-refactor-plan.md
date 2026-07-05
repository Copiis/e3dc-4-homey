# Live Data Poller Refactor Plan

## Goal
Extract polling logic from the monolithic `HomePowerStationDevice` to improve maintainability, enable better caching/debouncing, and reduce resource usage (CPU + RSCP calls).

## Current Problems
- `drivers/home-power-station/device.ts` (~1600 lines) mixes:
  - Polling / timing (autoSync, loopId)
  - Data fetching (sync + readLiveData calls)
  - Data processing (updateCapabilityValue, handle*, triggers)
  - Business logic (EMS schedules, wallbox, power modes, diagnostics)
- Polling is naive: every 30s a full readLiveData (which can do wallbox queries + multiple RSCP calls).
- No cache: repeated calls from different paths (timers, flows?) could hammer the device.
- Multiple independent timers across drivers (HPS, Wallbox, EnergySummary).

## Proposed Solution
Introduce a dedicated `LiveDataPoller`.

### New Class: `src/polling/live-data-poller.ts`

Responsibilities:
- Manage the polling interval / timer.
- Decide when to actually fetch (debounce + freshness cache).
- Perform the fetch via RscpApi (or injected fetcher).
- Notify listeners with fresh `LiveData`.
- Provide `forceFetch()` for explicit requests (e.g. from Flow cards or manual refresh).
- Expose last known data for quick access.

Key features:
- `start(intervalMs: number)`
- `stop()`
- `onData(listener: (data: LiveData) => void)`
- `forceFetch(): Promise<LiveData>`
- Internal cache: `lastData`, `lastFetchTimestamp`
- Debounce window (e.g. ignore fetches within 5s of last successful fetch unless forced).
- Optional: different poll rates for "critical" vs "full" data in future.

### Changes in `HomePowerStationDevice`

- Remove direct `autoSync()` / `loopId` management for live data.
- Inject / create `LiveDataPoller` in `onInit` / `doInit`.
- Move data processing logic into `private processLiveData(result: LiveData)` (extract from current sync().then).
- Keep `sync()` or rename to `fetchAndProcess` for backward compatibility if needed, but delegate to poller.
- Wallbox detection (`hasWallboxes`) can stay in device or move into poller (poller can accept a "includeWallboxes" flag).
- Other timers (EMS schedule checker, power mode refresh) stay for now (separate concern).

### Integration with RscpApi

- `RscpApi.readLiveData(...)` stays as the low-level fetcher.
- Poller wraps it and adds policy (caching, debounce, logging abstraction).
- Future: Poller could also coordinate battery data or other reads.

### Benefits
- Clearer separation of concerns.
- Easier to add smart caching (e.g. skip full wallbox read if no change).
- Easier to add adaptive polling (slower when idle, faster on user interaction).
- Foundation for future extraction of other managers (FlowCardManager, etc.).
- Reduces "hot path" churn in device.ts.

## Implementation Steps (incremental)

1. Create `src/polling/live-data-poller.ts` with basic structure + cache + debounce.
2. Add unit-testable interface (injectable fetcher).
3. Refactor `device.ts`:
   - Extract `processLiveData(result: LiveData)`
   - Wire poller in init
   - Replace `autoSync` + `sync` call with poller usage
4. Update `SYNC_INTERVAL` usage to live in the poller.
5. Build + local install + test on real hardware (check logs, no regression in live values).
6. Measure: compare RSCP call frequency before/after (if possible).
7. Later: extract more (WallboxManager, etc.) and add tests.

## Risks & Mitigations
- Breaking live data updates → thorough testing on device after each step.
- Timing changes → keep exact same 30s interval initially.
- Wallbox handling → keep the `hasWallboxes` logic identical at first.

## Open Questions
- Should poller be per-device or shared?
- Should we cache more than just LiveData (e.g. last battery data)?
- Debounce strategy: time-based or "last successful fetch age"?

