/**
 * EventBus 工厂
 */
export * from './types.js';
export { InProcessEventBus } from './in-process.js';

import type { EventBus } from './types.js';
import { InProcessEventBus } from './in-process.js';

let _instance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (_instance) return _instance;
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

export function resetEventBus(): void {
  if (_instance) void _instance.close();
  _instance = null;
}
