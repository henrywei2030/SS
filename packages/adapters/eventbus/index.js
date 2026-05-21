/**
 * EventBus 工厂
 */
export * from './types.js';
export { InProcessEventBus } from './in-process.js';
import { InProcessEventBus } from './in-process.js';
let _instance = null;
export function getEventBus() {
    if (_instance)
        return _instance;
    const driver = (process.env.EVENT_BUS_DRIVER ?? 'in-process').toLowerCase();
    switch (driver) {
        case 'in-process':
            _instance = new InProcessEventBus();
            break;
        case 'nats':
            // Phase 2: NatsEventBus
            throw new Error('NATS EventBus not implemented yet (Phase 2)');
        default:
            throw new Error(`Unknown EVENT_BUS_DRIVER: ${driver}`);
    }
    return _instance;
}
export function resetEventBus() {
    if (_instance)
        void _instance.close();
    _instance = null;
}
//# sourceMappingURL=index.js.map