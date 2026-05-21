import type { EventBus, EventHandler, Subscription } from './types.js';
export declare class InProcessEventBus implements EventBus {
    readonly id = "in-process";
    private readonly emitter;
    constructor();
    publish<T>(topic: string, payload: T, opts?: {
        publisherId?: string;
    }): Promise<void>;
    subscribe<T>(topic: string, handler: EventHandler<T>): Subscription;
    once<T>(topic: string, handler: EventHandler<T>): Subscription;
    close(): Promise<void>;
}
//# sourceMappingURL=in-process.d.ts.map