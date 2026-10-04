import {describe, it} from 'node:test';
import assert from 'node:assert';
import {SummaryType} from '../src/model/summary.config';
import {SUMMARY_CAPABILITY_ORDER} from '../src/utils/capability-order';
import {
  HOUSE_WITHOUT_WALLBOX_CAPABILITY,
  counterDeltaKwh,
  houseWithoutWallboxFromSeries,
  houseWithoutWallboxKwh,
  insightResolutionForSummary,
  meterAtOrBefore,
  parseInsightSeries,
  summaryPeriodBounds,
  wallboxBelongsToStation,
  wallboxPeriodKwh,
} from '../src/utils/house-without-wallbox';

describe('house consumption without wallbox', () => {
  it('sits beside the existing house-consumption statistic', () => {
    const index = SUMMARY_CAPABILITY_ORDER.indexOf('measure_house_consumption_summary');
    assert.ok(index >= 0);
    assert.strictEqual(SUMMARY_CAPABILITY_ORDER[index + 1], HOUSE_WITHOUT_WALLBOX_CAPABILITY);
  });

  it('uses the local calendar day and a 24h span', () => {
    const now = new Date('2026-10-04T12:00:00+02:00');
    const yesterday = summaryPeriodBounds(SummaryType.YESTERDAY, 'Europe/Berlin', now);
    assert.strictEqual(yesterday.start.toISOString(), '2026-10-02T22:00:00.000Z');
    assert.strictEqual(yesterday.end.toISOString(), '2026-10-03T22:00:00.000Z');
    assert.strictEqual(yesterday.open, false);

    const today = summaryPeriodBounds(SummaryType.TODAY, 'Europe/Berlin', now);
    assert.strictEqual(today.start.toISOString(), '2026-10-03T22:00:00.000Z');
    assert.strictEqual(today.open, true);
  });

  it('maps each statistics period to an insight resolution that covers it', () => {
    assert.strictEqual(insightResolutionForSummary(SummaryType.YESTERDAY), 'yesterday');
    assert.strictEqual(insightResolutionForSummary(SummaryType.TODAY), 'today');
    assert.strictEqual(insightResolutionForSummary(SummaryType.CURRENT_MONTH), 'thisMonth');
    assert.strictEqual(insightResolutionForSummary(SummaryType.LAST_MONTH), 'lastMonth');
    assert.strictEqual(insightResolutionForSummary(SummaryType.CURRENT_YEAR), 'thisYear');
    assert.strictEqual(insightResolutionForSummary(SummaryType.LAST_YEAR), 'lastYear');
  });

  it('subtracts yesterday wallbox delta from the history total', () => {
    const bounds = summaryPeriodBounds(
      SummaryType.YESTERDAY,
      'Europe/Berlin',
      new Date('2026-10-04T12:00:00+02:00'),
    );
    const series = {
      stepMs: 300_000,
      samples: [
        {t: Date.parse('2026-10-02T22:00:00.000Z'), v: 340.707},
        {t: Date.parse('2026-10-03T21:55:00.000Z'), v: 353.096},
      ],
    };
    const wallbox = wallboxPeriodKwh(series, bounds, Date.parse('2026-10-04T12:00:00+02:00'));
    assert.ok(wallbox != null);
    assert.ok(Math.abs(wallbox - 12.389) < 0.001);
    const house = houseWithoutWallboxKwh(23.788, wallbox!);
    assert.ok(house != null);
    assert.ok(Math.abs(house - 11.399) < 0.001);
  });

  it('uses the live meter as the end of an open period', () => {
    const bounds = summaryPeriodBounds(
      SummaryType.TODAY,
      'Europe/Berlin',
      new Date('2026-10-04T12:00:00+02:00'),
    );
    const wallbox = wallboxPeriodKwh(
      {
        stepMs: 300_000,
        liveKwh: 355.5,
        samples: [{t: Date.parse('2026-10-03T22:00:00.000Z'), v: 353.096}],
      },
      bounds,
      Date.parse('2026-10-04T12:00:00+02:00'),
    );
    assert.ok(wallbox != null);
    assert.ok(Math.abs(wallbox - 2.404) < 0.001);
  });

  it('does not invent a delta when the series misses the period start', () => {
    const samples = [{t: Date.parse('2026-10-03T22:00:00.000Z'), v: 353}];
    assert.strictEqual(meterAtOrBefore(samples, Date.parse('2026-10-02T22:00:00.000Z'), 300_000), null);
  });

  it('rejects a counter that went backwards', () => {
    assert.strictEqual(counterDeltaKwh(10, 3), null);
    assert.strictEqual(counterDeltaKwh(10, 9.99), 0);
  });

  it('keeps the total when no wallbox is paired and sums several wallboxes', () => {
    const bounds = summaryPeriodBounds(
      SummaryType.YESTERDAY,
      'Europe/Berlin',
      new Date('2026-10-04T12:00:00+02:00'),
    );
    const nowMs = Date.parse('2026-10-04T12:00:00+02:00');
    assert.strictEqual(houseWithoutWallboxFromSeries(23.788, [], bounds, nowMs), 23.788);

    const one = {
      stepMs: 300_000,
      samples: [
        {t: bounds.start.getTime(), v: 1},
        {t: bounds.end.getTime(), v: 4},
      ],
    };
    const two = {
      stepMs: 300_000,
      samples: [
        {t: bounds.start.getTime(), v: 10},
        {t: bounds.end.getTime(), v: 12.5},
      ],
    };
    const house = houseWithoutWallboxFromSeries(23.788, [one, two], bounds, nowMs);
    assert.ok(house != null);
    assert.ok(Math.abs(house - 18.288) < 0.001);
  });

  it('matches a wallbox by store station or by its pairing id', () => {
    const stationId = 'rscp-device-192.168.188.32-1';
    assert.strictEqual(wallboxBelongsToStation({id: 'x', stationId}, stationId), true);
    assert.strictEqual(wallboxBelongsToStation({
      id: '',
      dataId: 'wb-' + stationId + '-0',
    }, stationId), true);
    assert.strictEqual(wallboxBelongsToStation({
      id: '',
      dataId: 'wb-other-station-0',
      stationId: 'other-station',
    }, stationId), false);
  });

  it('parses insight values and skips null points', () => {
    const series = parseInsightSeries({
      step: 300000,
      values: [
        {t: '2026-10-02T22:00:00.000Z', v: 1},
        {t: '2026-10-02T22:05:00.000Z', v: null},
        {t: '2026-10-02T22:10:00.000Z', v: 2},
      ],
    });
    assert.ok(series);
    assert.strictEqual(series!.samples.length, 2);
    assert.strictEqual(series!.stepMs, 300000);
  });
});
