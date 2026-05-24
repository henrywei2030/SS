/**
 * 进程内 EventBus — Phase 1 默认
 * 基于 EventEmitter，零依赖
 *
 * 第 19 轮 audit 加强(2026-05-24):
 *   - publish/subscribe 加 dev-mode trace log,让 dev 看见跨模块事件流动
 *   - 跟 trpc requestId 一起,组成"前端 → tRPC → EventBus → 订阅方"完整追溯链
 *   - 模块解耦体现:订阅方只看 topic 名 + payload type,不直接 import 发布方代码
 *
 * Phase 2 切 NATS 时:
 *   - 加 zod schema runtime parse(对所有 EVENTS 注册 schema)
 *   - 接 OTel trace + Distributed Tracing(EventMeta 加 traceId/spanId)
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type { EventBus, EventHandler, EventMeta, Subscription } from './types.js';

const TRACE_ENABLED = process.env.NODE_ENV !== 'production' || process.env.SS_EVENTBUS_TRACE === '1';

export class InProcessEventBus implements EventBus {
  readonly id = 'in-process';
  private readonly emitter = new EventEmitter();
  /** 跨模块订阅统计(dev 看模块解耦健康度) */
  private readonly subscriberCountByTopic = new Map<string, number>();

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
    if (TRACE_ENABLED) {
      const subs = this.subscriberCountByTopic.get(topic) ?? 0;
      // 仅打 topic + eventId + publisherId + 订阅方数,不打 payload(防 leak + 防刷屏)
      console.log(
        `[eventbus] publish topic=${topic} eventId=${meta.eventId} from=${opts.publisherId ?? '-'} subscribers=${subs}`,
      );
    }
    this.emitter.emit(topic, payload, meta);
  }

  subscribe<T>(topic: string, handler: EventHandler<T>): Subscription {
    const wrapped = (payload: T, meta: EventMeta): void => {
      Promise.resolve(handler(payload, meta)).catch((e) => {
        console.error(`[eventbus] handler error on ${topic} eventId=${meta.eventId}:`, e);
      });
    };
    this.emitter.on(topic, wrapped);
    this.subscriberCountByTopic.set(topic, (this.subscriberCountByTopic.get(topic) ?? 0) + 1);
    if (TRACE_ENABLED) {
      console.log(`[eventbus] subscribe topic=${topic} (total subscribers=${this.subscriberCountByTopic.get(topic)})`);
    }
    return {
      topic,
      unsubscribe: () => {
        this.emitter.off(topic, wrapped);
        const next = (this.subscriberCountByTopic.get(topic) ?? 1) - 1;
        if (next <= 0) {
          this.subscriberCountByTopic.delete(topic);
        } else {
          this.subscriberCountByTopic.set(topic, next);
        }
      },
    };
  }

  once<T>(topic: string, handler: EventHandler<T>): Subscription {
    const wrapped = (payload: T, meta: EventMeta): void => {
      Promise.resolve(handler(payload, meta)).catch((e) => {
        console.error(`[eventbus] once handler error on ${topic} eventId=${meta.eventId}:`, e);
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
    this.subscriberCountByTopic.clear();
  }
}
