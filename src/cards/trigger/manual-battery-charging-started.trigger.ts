import {Logger} from '../../internal-api/logger';
import {Device, FlowCardTriggerDevice} from 'homey';
import {TriggerCard} from '../trigger-card';
import {formatError} from '../../utils/error-utils';

export class ManualBatteryChargingStartedTrigger implements TriggerCard<number | undefined>{

    constructor(
        private device: Device,
        private card: FlowCardTriggerDevice,
        private logger: Logger) {
    }

    trigger(input: number | undefined): void {
        // Note: currently no tokens are defined for this trigger card in compose.
        // The charged energy value is logged but not forwarded (matching existing behavior).
        this.logger.log('ManualBatteryChargingStartedTrigger: Triggering card')
        this.card.trigger(this.device)
            .then(value => {
                this.logger.error('Calling trigger card ManualBatteryChargingStartedTrigger success')
            })
            .catch(reason => {
                this.logger.error('Calling trigger card ManualBatteryChargingStartedTrigger failed')
                this.logger.error(formatError(reason))
            })
    }
}
