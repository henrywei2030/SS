/**
 * EventBus — 事件总线抽象
 *
 * Phase 1: 进程内 EventEmitter（同进程足够）
 * Phase 2: NATS JetStream（多 worker 实例时切换）
 */
export type EventHandler<T = unknown> = (payload: T, meta: EventMeta) => Promise<void> | void;
export interface EventMeta {
    topic: string;
    publishedAt: Date;
    publisherId?: string;
    /** 用于幂等 / 去重 */
    eventId: string;
}
export interface Subscription {
    topic: string;
    unsubscribe: () => void;
}
export interface EventBus {
    readonly id: string;
    publish<T>(topic: string, payload: T, opts?: {
        publisherId?: string;
    }): Promise<void>;
    subscribe<T>(topic: string, handler: EventHandler<T>): Subscription;
    /** 一次性订阅 */
    once<T>(topic: string, handler: EventHandler<T>): Subscription;
    /** 关闭并清理 */
    close(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map