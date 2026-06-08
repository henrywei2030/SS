/**
 * 视频生成进度推送总线 — worker `publish` → SSE `subscribe`(抽象 ADR-25 M6 的 Redis pub/sub)。
 *
 * `PROGRESS_BUS_DRIVER` 开关:
 *   - `redis`(默认):跨进程。worker 与 web 分进程(云端/团队/现有 dev 档)用。
 *   - `in-process`:单进程(桌面档:worker 合进 web 进程),EventEmitter,无 Redis 依赖。
 *
 * ⚠️ `in-process` 仅在「publish 与 subscribe 在同一进程」时有效(即配合 `QUEUE_DRIVER=in-process`、
 *    worker 合进 web 进程)。多进程部署必须用 `redis`。
 *
 * 投递给订阅者的都是**已校验**的 VideoGenProgressEvent:redis 档在跨进程边界做 Zod parse;
 * in-process 档对象本就类型安全,直接投递。
 */
import { EventEmitter } from 'node:events';

import { createRedisSubscriber, getPrimaryRedis } from './redis.js';
import {
  videoGenChannel,
  VideoGenProgressEventSchema,
  type VideoGenProgressEvent,
} from './types.js';

export interface ProgressSubscription {
  unsubscribe(): Promise<void>;
}

export interface ProgressBus {
  publish(attemptId: string, event: VideoGenProgressEvent): Promise<void>;
  subscribe(
    attemptId: string,
    onEvent: (event: VideoGenProgressEvent) => void,
  ): Promise<ProgressSubscription>;
}

// ---- in-process(EventEmitter,桌面单进程档)----
class InProcessProgressBus implements ProgressBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // 同一 attempt 可能被多个 SSE 连接订阅,放宽监听器上限防 MaxListeners warning
    this.emitter.setMaxListeners(0);
  }

  publish(attemptId: string, event: VideoGenProgressEvent): Promise<void> {
    this.emitter.emit(attemptId, event);
    return Promise.resolve();
  }

  subscribe(
    attemptId: string,
    onEvent: (event: VideoGenProgressEvent) => void,
  ): Promise<ProgressSubscription> {
    const listener = (event: VideoGenProgressEvent): void => onEvent(event);
    this.emitter.on(attemptId, listener);
    return Promise.resolve({
      unsubscribe: () => {
        this.emitter.off(attemptId, listener);
        return Promise.resolve();
      },
    });
  }
}

// ---- redis(跨进程,沿用 ADR-25 M6)----
class RedisProgressBus implements ProgressBus {
  async publish(attemptId: string, event: VideoGenProgressEvent): Promise<void> {
    await getPrimaryRedis().publish(videoGenChannel(attemptId), JSON.stringify(event));
  }

  subscribe(
    attemptId: string,
    onEvent: (event: VideoGenProgressEvent) => void,
  ): Promise<ProgressSubscription> {
    const channel = videoGenChannel(attemptId);
    const subscriber = createRedisSubscriber(`progress:${attemptId}`);
    const onMessage = (ch: string, msg: string): void => {
      if (ch !== channel) return;
      try {
        // 跨进程边界:Zod runtime validate(防协议漂移 / 畸形 payload 崩前端 UI)
        onEvent(VideoGenProgressEventSchema.parse(JSON.parse(msg)));
      } catch (err) {
        console.error(
          `[progress-bus] parse/validate failed for ${channel}:`,
          err instanceof Error ? err.message : err,
        );
      }
    };
    subscriber.on('message', onMessage);
    return subscriber.subscribe(channel).then(() => ({
      unsubscribe: async () => {
        subscriber.off('message', onMessage);
        await subscriber
          .unsubscribe(channel)
          .catch((e) => console.warn(`[progress-bus] unsubscribe ${channel} failed:`, e));
        await subscriber
          .quit()
          .catch((e) => console.warn(`[progress-bus] subscriber quit failed:`, e));
      },
    }));
  }
}

let _instance: ProgressBus | null = null;

export function getProgressBus(): ProgressBus {
  if (_instance) return _instance;
  const driver = (process.env.PROGRESS_BUS_DRIVER ?? 'redis').toLowerCase();
  switch (driver) {
    case 'redis':
      _instance = new RedisProgressBus();
      break;
    case 'in-process':
      _instance = new InProcessProgressBus();
      break;
    default:
      throw new Error(`Unknown PROGRESS_BUS_DRIVER: ${driver}`);
  }
  return _instance;
}

/** 测试用:重置单例 */
export function resetProgressBus(): void {
  _instance = null;
}
