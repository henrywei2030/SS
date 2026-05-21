/**
 * 进程内 EventBus — Phase 1 默认
 * 基于 EventEmitter，零依赖
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type { EventBus, EventHandler, EventMeta, Subscription } from './types.js';

export class InProcessEventBus implements EventBus {
  readonly id = 'in-process';
  private readonly emitter = new EventEmitter();

  constructor() {
    // 允许较多监听器（多模块订阅同一 topic）
    this.emitter.setMaxListeners(50);
  }

  async publish<T>(topic: string, payload: T, opts: { publisherId?: string } = {}): Promise<void> {
    const meta: EventMeta = {
      topic,
      publishedAt: new Date(),
      publisherId: opts.publisherId,
      eventId: randomUUID(),
    };
    this.emitter.emit(topic, payload, meta);
  }

  subscribe<T>(topic: string, handler: EventHandler<T>): Subscription {
    const wrapped = (payload: T, meta: EventMeta): void => {
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

  once<T>(topic: string, handler: EventHandler<T>): Subscription {
    const wrapped = (payload: T, meta: EventMeta): void => {
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

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}
