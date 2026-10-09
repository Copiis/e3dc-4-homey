import {RunListener} from '../run-listener';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';
import {flowText} from './wallbox-flow-result';

export class ExportDiagnosticReportActionCard implements RunListener {
    run(args: { device?: HomePowerStation }, _state: unknown): Promise<{ 'diagnostic report': string }> {
        return new Promise((resolve, reject) => {
            const hps = args.device;
            if (!hps || typeof hps.buildDiagnosticReport !== 'function') {
                reject(flowText(hps, 'messages.invalid-hps-device', 'Invalid home power station device'));
                return;
            }
            hps.buildDiagnosticReport()
                .then(report => resolve({ 'diagnostic report': report }))
                .catch(reason => reject(formatError(reason)));
        });
    }
}