import { EmsSchedule } from '../../model/home-power-station';
import { IHpsDevice } from '../../types/hps-device';
import { getScheduleId, parseDateTime, isInWindow } from '../../utils/ems-schedule-utils';

/**
 * EmsScheduleScheduler
 *
 * Zuständig für Timer-Management:
 * - Planung zukünftiger Starts (scheduledPlanTimers)
 * - Periodischer Checker-Interval (emsScheduleCheckId)
 * - Aufräumen von Timern
 *
 * Entkoppelt von Store/Validator/Executor.
 * Wird vom EmsScheduleManager orchestriert.
 */
export class EmsScheduleScheduler {
  private emsScheduleCheckId: NodeJS.Timeout | null = null;
  private scheduledPlanTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly device: IHpsDevice,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
    private readonly onCheck: () => void,
    private readonly onActivatePlan: (s: EmsSchedule, id: string) => Promise<void>
  ) {}

  startChecker() {
    if (this.emsScheduleCheckId) {
      clearInterval(this.emsScheduleCheckId);
    }
    this.clearPlanTimers();
    this.emsScheduleCheckId = this.device.homey.setInterval(() => this.onCheck(), 30 * 1000);
    setTimeout(() => this.onCheck(), 5000);
  }

  /**
   * Plant Timer für zukünftige Plan-Starts.
   */
  scheduleFutureStarts(schedules: EmsSchedule[]) {
    this.clearPlanTimers();
    const nowTs = Date.now();

    for (const s of schedules) {
      if (!s.start || !s.mode) continue;
      const startTs = (typeof s.startTs === 'number') ? s.startTs : parseDateTime(s.start);
      if (isNaN(startTs) || startTs <= nowTs) continue;

      const id = getScheduleId(s);
      const delay = startTs - nowTs;
      this.logger.log(`[Ladeplan] scheduling timer for plan ${id} in ${delay}ms`);
      this.device.recordAnalysisEvent('info', `[Ladeplan] scheduling timer for ${id} delay=${delay}ms`);

      const timer = setTimeout(() => {
        this.activateIfNeeded(s, id);
        this.scheduledPlanTimers.delete(id);
      }, delay);
      this.scheduledPlanTimers.set(id, timer);
    }
  }

  private async activateIfNeeded(s: EmsSchedule, id: string) {
    await this.onActivatePlan(s, id);
  }

  clearPlanTimers() {
    this.scheduledPlanTimers.forEach((t: NodeJS.Timeout) => clearTimeout(t));
    this.scheduledPlanTimers.clear();
  }

  clearAllTimers() {
    if (this.emsScheduleCheckId) {
      clearInterval(this.emsScheduleCheckId);
      this.emsScheduleCheckId = null;
    }
    this.clearPlanTimers();
  }

  stop() {
    this.clearAllTimers();
  }
}
