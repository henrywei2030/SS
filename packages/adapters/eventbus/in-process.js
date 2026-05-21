/**
 * 进程内 EventBus — Phase 1 默认
 * 基于 EventEmitter，零依赖
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
export class InProcessEventBus {
    id = 'in-process';
    emitter = new EventEmitter();
    constructor() {
        // 允许较多监听器（多模块订阅同一 topic）
        this.emitter.setMaxListeners(50);
    }
    async publish(topic, payload, opts = {}) {
        const meta = {
            topic,
            publishedAt: new Date(),
            publisherId: opts.publisherId,
            eventId: randomUUID(),
        };
        this.emitter.emit(topic, payload, meta);
    }
    subscribe(topic, handler) {
        const wrapped = (payload, meta) => {
            Promise.resolve(handler(payload, meta)).catch((e) => {
                console.error(`[eventbus] handler error on ${topic}:`, e);
            });
        };
        this.emitter.on(topic, wrapped);
        return {
            topic,
            unsubscribe: () => this.emitter.off(topic, wrapped),
        };
    }
    once(topic, handler) {
        const wrapped = (payload, meta) => {
            Promise.resolve(handler(payload, meta)).catch((e) => {
                console.error(`[eventbus] once handler error on ${topic}:`, e);
            });
        };
        this.emitter.once(topic, wrapped);
        return {
            topic,
            unsubscribe: () => this.emitter.off(topic, wrapped),
        };
    }
    async close() {
        this.emitter.removeAllListeners();
    }
}
//# sourceMappingURL=in-process.js.map