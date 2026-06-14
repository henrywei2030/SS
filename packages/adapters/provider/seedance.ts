/**
 * Seedance Provider (火山引擎 Doubao Seedance)
 * — Phase 1 唯一接入的视频模型 —
 *
 * 文档参考: https://www.volcengine.com/docs/82379/ (ARK API)
 * 模型 ID: 'doubao-seedance-1-0-pro' / 'doubao-seedance-1-0-pro-fast' (示例)
 * 实际使用时根据 .env 配置的 SEEDANCE_DEFAULT_MODEL / SEEDANCE_FAST_MODEL 切换
 *
 * 调用模式：异步任务（创建 → 轮询）
 */
import { Agent, request } from 'undici';

import { ProviderError, asRecord, asString, asNumber } from '@ss/shared';

// 2026-05-27 audit r15 P0:Seedance 专属 undici Agent
// 用户反馈根因:worker POST moyu /v1/video/generations 默认 connect timeout 10s 不够 →
// moyu 收到 POST 并返了 task_id,但我们 worker 因 10s timeout 标 FAILED → task_id 丢失,
// moyu 端继续异步生成完视频,我们前端永远看不到。
//
// 必须用专属 Agent(不依赖 openai-compat.ts 的 global dispatcher,worker 可能先调 Seedance 后调 Text)
// Connect 60s + body/headers 180s,覆盖 moyu 偶发网络抖动 / TLS 慢握手 / 中转排队
const seedanceDispatcher = new Agent({
  connect: { timeout: 60_000 }, // TCP connect 60s(默认 10s 不够,moyu 偶发抖动)
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 16,
  pipelining: 1,
  bodyTimeout: 180_000, // 3 分钟 body 接收
  headersTimeout: 180_000, // 3 分钟 headers 接收(POST create + GET query 都用)
  allowH2: false, // undici v8 默认开 H2,中转站按 HTTP/1.1 调优 → 显式关
});

import { BaseProvider } from './base.js';
import type {
  CallContext,
  IVideoProvider,
  ProviderInfo,
  VideoRequest,
  VideoResult,
} from './types.js';

export interface SeedanceConfig {
  apiUrl: string;        // e.g. https://ark.cn-beijing.volces.com/api/v3
  apiKey: string;
  defaultModel: string;  // SEEDANCE_DEFAULT_MODEL
  fastModel?: string;    // SEEDANCE_FAST_MODEL
  /** 默认 max_duration（秒），Storyboard 合并阈值用 */
  maxDuration: number;
  /** 单价 CNY/秒 */
  unitPriceCny: number;
  /** 异步任务轮询间隔 ms */
  pollIntervalMs?: number;
  /** 轮询超时 ms */
  pollTimeoutMs?: number;
  /**
   * Endpoint 风格:
   * - 'ark'  (默认) = Volcengine ARK 原生 path /contents/generations/tasks,body 用 content+parameters 结构
   * - 'relay' = OpenAI 兼容中转站 path /video/generations,body 用简化结构 { model, prompt, duration, ratio }
   *
   * 加这个的原因(2026-05-24 第 21 轮 audit):多数 OpenAI 兼容中转站透传 Seedance 但改了 endpoint path + body 结构。
   * 同一个 SeedanceProvider 类支持两个 backend,避免代码重复。
   */
  endpointStyle?: 'ark' | 'relay';
}

/**
 * 2026-05-27 audit r15 用户反馈根因:
 *   Seedance 2.0 真实 query response 跟 1.x ARK 完全不同(docs §15),
 *   嵌套两层 data + 状态值大写(SUCCESS/IN_PROGRESS/FAILURE/NOT_START)。
 *   原代码假设 status='succeeded' + content.video_url 直接 → 永远不命中 → poll 超时 → mark FAILED
 *   但 moyu 端真生成了视频(用户后台能看到),只是我们 DB 没拿到。
 *
 * Seedance 2.0 (moyu relay) 结构:
 *   { code:'success', data:{ task_id, status:'SUCCESS', progress:'100%', data:{ content:{ video_url }, duration, framespersecond, error } } }
 *
 * Seedance 1.x (ARK 老接口) 结构:
 *   { id, status:'succeeded', content:{ video_url, cover_url, duration, fps, width, height } }
 *
 * parseQueryResponse 规范化两种格式 → 统一 {kind, videoUrl, durationS, ...}
 */
interface NormalizedQuery {
  kind: 'pending' | 'success' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
  durationS?: number;
  width?: number;
  height?: number;
  fps?: number;
  errorMsg?: string;
  rawResponse: unknown;
}

export class SeedanceProvider extends BaseProvider implements IVideoProvider {
  readonly info: ProviderInfo;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly endpointStyle: 'ark' | 'relay';

  constructor(private readonly cfg: SeedanceConfig) {
    super();
    this.info = {
      id: cfg.defaultModel,
      // F5a:relay 档已泛化为通用中转站视频适配器(kling/wan 等同走),名字带上真实模型
      displayName:
        cfg.endpointStyle === 'relay'
          ? `${cfg.defaultModel} via 中转站 (视频)`
          : 'Seedance（视频）',
      kind: 'video',
      unitName: 'second',
      defaultUnitPriceCny: cfg.unitPriceCny,
      maxDuration: cfg.maxDuration,
      maxConcurrent: 5,
    };
    this.pollIntervalMs = cfg.pollIntervalMs ?? 5000;
    // 2026-05-27 audit r15:Seedance 2.0 标准版生成 5-8 分钟(docs §15),5min 超时永远不够
    // 提到 15min 留足余量(2.0 fast 3-4 分钟、2.0 std 5-8 分钟)
    this.pollTimeoutMs = cfg.pollTimeoutMs ?? 15 * 60 * 1000;
    this.endpointStyle = cfg.endpointStyle ?? 'ark';
  }

  /**
   * 2026-05-27 audit r15:适配 Seedance 2.0 query response 嵌套结构 + 兼容 1.x ARK 格式
   * 用户用 moyu relay → 2.0 协议(data.data.content.video_url + 大写 status)
   */
  private parseQueryResponse(raw: unknown): NormalizedQuery {
    const root = asRecord(raw);
    if (!root) return { kind: 'pending', rawResponse: raw };

    // 二十九收工 S8:`as Record` heavy 重写,用 asRecord/asString/asNumber type guard
    // 优先尝试 Seedance 2.0 (moyu relay) 嵌套结构
    const lvl1 = asRecord(root.data);
    const lvl1Status = lvl1 ? asString(lvl1.status) : null;
    if (lvl1 && lvl1Status) {
      const upper = lvl1Status.toUpperCase();
      const inner = asRecord(lvl1.data) ?? {};
      const content = asRecord(inner.content);
      const innerErr = asRecord(inner.error);
      if (upper === 'SUCCESS') {
        // 七二 M5 真打实测:moyu 对 wan/happyhorse 等用「通用任务信封」,结果不在
        //   content.video_url 而在 inner.data[](wan: [{url}])或 inner.output 里;
        //   保险丝:status=SUCCESS 但已知路径全空时,整棵 lvl1 深扫第一个 .mp4 直链
        //   (wan 甚至把成片 URL 塞在 fail_reason 字段 — moyu 信封怪癖,深扫天然兜住)。
        const arr = Array.isArray(inner.data) ? inner.data : null;
        const firstItem = arr ? asRecord(arr[0]) : null;
        const output = asRecord(inner.output);
        const videoUrl =
          asString(content?.video_url) ??
          asString(firstItem?.url) ??
          asString(output?.video_url) ??
          asString(output?.url) ??
          findFirstMp4Url(lvl1) ??
          undefined;
        // 七二第九波:通用信封成功路径补抽真实 width/height(此前只有 1.x ARK 平铺路径抽,
        //   happyhorse/wan 系恒 undefined → 无法回读真实尺寸自检横竖屏错配)。各家位置不一,
        //   按 content / inner / data[0] / output 逐层尽力取;缺失仍 undefined,纯增字段不改终态。
        const dimSrc = [content, inner, firstItem, output];
        const pickNum = (key: string): number | undefined => {
          for (const src of dimSrc) {
            const v = asNumber(src?.[key]);
            if (v !== null && v !== undefined) return v;
          }
          return undefined;
        };
        return {
          kind: 'success',
          videoUrl,
          durationS: asNumber(inner.duration) ?? undefined,
          width: pickNum('width'),
          height: pickNum('height'),
          fps: asNumber(inner.framespersecond) ?? undefined,
          rawResponse: raw,
        };
      }
      if (upper === 'FAILURE' || upper === 'FAILED' || upper === 'CANCELLED') {
        const failReason = asString(lvl1.fail_reason) ?? '';
        const innerMsg = asString(innerErr?.message) ?? '';
        return {
          kind: 'failed',
          errorMsg: innerMsg || failReason || `Task ${upper}`,
          rawResponse: raw,
        };
      }
      // NOT_START / IN_PROGRESS / 其他 → pending
      return { kind: 'pending', rawResponse: raw };
    }
    // Seedance 1.x ARK 格式:平铺 status + content
    const rootStatus = asString(root.status);
    if (rootStatus) {
      const s = rootStatus.toLowerCase();
      if (s === 'succeeded' || s === 'success') {
        const content = asRecord(root.content);
        return {
          kind: 'success',
          videoUrl: asString(content?.video_url) ?? undefined,
          thumbnailUrl: asString(content?.cover_url) ?? undefined,
          durationS: asNumber(content?.duration) ?? undefined,
          width: asNumber(content?.width) ?? undefined,
          height: asNumber(content?.height) ?? undefined,
          fps: asNumber(content?.fps) ?? undefined,
          rawResponse: raw,
        };
      }
      if (s === 'failed' || s === 'cancelled' || s === 'failure') {
        const err = asRecord(root.error);
        return {
          kind: 'failed',
          errorMsg: asString(err?.message) ?? `Task ${s}`,
          rawResponse: raw,
        };
      }
      return { kind: 'pending', rawResponse: raw };
    }
    // 完全不识别 — 视为 pending,继续 poll(防误把临时网络故障当 success)
    return { kind: 'pending', rawResponse: raw };
  }

  /** create task endpoint path(根据 endpointStyle 切换) */
  private get createTaskPath(): string {
    return this.endpointStyle === 'relay' ? '/video/generations' : '/contents/generations/tasks';
  }

  private queryTaskPath(taskId: string): string {
    return this.endpointStyle === 'relay'
      ? `/video/generations/${taskId}`
      : `/contents/generations/tasks/${taskId}`;
  }

  /** 构造 create task body — 根据 endpointStyle + modelId 切分
   *
   *  Seedance 2.0 / 2.0-fast(对照 moyu docs §15):metadata.content 数组结构
   *    { model, prompt:"占位", metadata: { content:[{type:"text",text:...}, ...], duration, resolution, ratio, generate_audio } }
   *  Seedance 1.x relay(老协议):平铺 { model, prompt, duration, ratio, image }
   *  Volcengine ARK 原生(endpointStyle='ark'):content + parameters
   */
  private buildCreateBody(req: VideoRequest, modelId: string): Record<string, unknown> {
    if (this.endpointStyle === 'relay') {
      // 用 modelId 区分 Seedance 2.0(metadata 结构)vs 1.x(简化结构)
      const isSeedance2 = modelId.includes('seedance-2-');
      if (isSeedance2) {
        // 2026-05-27 audit r13:Seedance 2.0 正确协议(对照 moyu docs §15)
        // 顶层 prompt 必须非空但实际 prompt 来自 metadata.content;media role 必须显式
        const content: Array<Record<string, unknown>> = [
          { type: 'text', text: req.prompt },
        ];
        // 首帧 / 尾帧 / 参考图 — 三种 role 互斥(docs §15 image Role 说明)
        if (req.firstFrameUrl) {
          content.push({
            type: 'image_url',
            image_url: { url: req.firstFrameUrl },
            role: 'first_frame',
          });
        }
        if (req.lastFrameUrl) {
          content.push({
            type: 'image_url',
            image_url: { url: req.lastFrameUrl },
            role: 'last_frame',
          });
        }
        // refImageUrls 当 reference_image(若用户未传 firstFrame,first 张当首帧也可,但优先 reference)
        if (req.refImageUrls?.length && !req.firstFrameUrl && !req.lastFrameUrl) {
          for (const url of req.refImageUrls) {
            content.push({
              type: 'image_url',
              image_url: { url },
              role: 'reference_image',
            });
          }
        }
        // 2026-05-27 audit r13:refAudioUrls(role:reference_audio)— 角色配音 binding
        // docs §15:不可单独输入音频,应至少有 1 个参考视频或图片
        // r14 修正:之前 `content.length > 1` 不等于含 media(可能只是多条 text),严格检查 image_url/video_url 类型
        const hasMediaInContent = content.some(
          (c) => c.type === 'image_url' || c.type === 'video_url',
        );
        if (req.refAudioUrls?.length && hasMediaInContent) {
          for (const url of req.refAudioUrls) {
            content.push({
              type: 'audio_url',
              audio_url: { url },
              role: 'reference_audio',
            });
          }
        }
        // Seedance 2.0 duration 范围 4-15 整数(docs §15)
        const duration = clamp(
          Math.round(req.durationS),
          4,
          Math.min(this.cfg.maxDuration, 15),
        );
        const extra = asRecord(req.extra) ?? {};
        const metadata: Record<string, unknown> = {
          content,
          duration,
          ratio: req.aspectRatio,
          // Seedance 2.0 只支持 480p/720p(docs §15)— 用户传 1080p 时降到 720p
          resolution:
            extra.resolution === '480p' || extra.resolution === '720p'
              ? extra.resolution
              : '720p',
        };
        // generate_audio 默认 true(docs §15) — 用户显式传 false 才关
        if (extra.generateAudio !== undefined) {
          metadata.generate_audio = Boolean(extra.generateAudio);
        }
        // tools(web_search 联网搜索增强)— 仅文生视频且无参考媒体时
        if (extra.webSearchEnabled === true && content.length === 1) {
          metadata.tools = [{ type: 'web_search' }];
        }
        return {
          model: modelId,
          prompt: '占位', // 平台校验非空,实际 prompt 在 metadata.content
          metadata,
        };
      }
      // Seedance 1.x relay (旧协议,docs §14):中转站 /v1/video/generations 简化结构
      // 七二第九波(尺寸 bug 根因):比例字段按家族双写别名 —— Seedance 系中转站惯例用顶层
      //   `ratio`(moyu docs §3.4),但 happyhorse / wan 等走 OpenAI 兼容中转站,标准比例
      //   字段是顶层 `aspect_ratio`(下划线;DashScope 原生则是 parameters.ratio)。此前只发
      //   `ratio` → happyhorse R2V 端不识别 → 静默回落默认 16:9(用户设 9:16 却出横屏的根因)。
      //   同值双写无冲突(中转站忽略不认的别名),一次覆盖 seedance / happyhorse / wan 三套命名。
      // 七二第九波:maxDuration 有限性自卫 —— happyhorse 等 catalog 无 maxDuration 时,
      //   构造链虽有 `?? 15` 兜底,但此处不依赖隐式跨文件契约,直接守 NaN(否则 duration:NaN
      //   → JSON.stringify 成 null → moyu InvalidParameter)。
      const maxDur = Number.isFinite(this.cfg.maxDuration) ? this.cfg.maxDuration : 15;
      const body: Record<string, unknown> = {
        model: modelId,
        prompt: req.prompt,
        duration: clamp(req.durationS, 1, maxDur),
        ratio: req.aspectRatio,
        aspect_ratio: req.aspectRatio,
      };
      // images 数组(happyhorse/wan r2v 等):文档(happyhorse r2v)写「HTTP/HTTPS 或 base64」,
      //   这里的 base64 = 裸 base64 串(无 data:<mime>;base64, 前缀)。我们的生成图存成 data: URL,
      //   直接塞进去 moyu 会把它【当 URL 去下载】→ data: 下不动 → 卡 47-120s → ECONNRESET(实测)。
      //   故对 data: URL 剥前缀转裸 base64,http(s) 公网 URL 原样保留。
      //   (seedance-2.0 走 image_url 内联格式、不经本分支,base64 直接可用,不受影响。)
      if (req.refImageUrls?.length) {
        body.images = req.refImageUrls.map((u) =>
          /^data:/i.test(u) ? u.slice(u.indexOf(',') + 1) : u,
        );
      }
      if (req.firstFrameUrl) body.first_frame_image = req.firstFrameUrl;
      if (req.lastFrameUrl) body.last_frame_image = req.lastFrameUrl;
      if (req.seed !== undefined) body.seed = req.seed;
      // 1.x 不支持 extra params 的 metadata 透传,只 merge whitelisted
      return body;
    }
    // ark 原生协议(content + parameters 结构)
    return {
      model: modelId,
      content: [
        ...(req.refImageUrls?.map((url) => ({ type: 'image_url', image_url: { url } })) ?? []),
        { type: 'text', text: req.prompt },
      ],
      parameters: {
        duration: clamp(req.durationS, 1, this.cfg.maxDuration),
        aspect_ratio: req.aspectRatio,
        ...(req.seed !== undefined && { seed: req.seed }),
        ...(req.firstFrameUrl && { first_frame_image: req.firstFrameUrl }),
        ...(req.lastFrameUrl && { last_frame_image: req.lastFrameUrl }),
        ...(req.complianceIds?.length && { compliance_ids: req.complianceIds }),
        ...req.extra,
      },
    };
  }

  /** 从 create task 响应中抽 task_id(兼容中转站的 task_id 和 ark 的 id) */
  private extractTaskId(json: Record<string, unknown>): string {
    // 全盘审查 #11:部分中转站(one-api 衍生)返数字 task_id,asString 只接受 string 会返 ''
    //   → 误判 Missing task_id 抛错。改为兼容 string|number(对齐 relay-asset.ts 的 String(id))
    const tid = json.task_id ?? json.id;
    return typeof tid === 'string' || typeof tid === 'number' ? String(tid) : '';
  }

  estimateCost(req: VideoRequest): number {
    return req.durationS * this.cfg.unitPriceCny;
  }

  async generate(req: VideoRequest, ctx: CallContext): Promise<VideoResult> {
    const modelId = req.model ?? this.cfg.defaultModel;

    // 七二第六波(内部诊断实证):reference/image-to-video 模型(r2v/i2v)必须带参考媒体 —
    //   缺了别白提交一个 moyu 必拒的任务。happyhorse-1.0-r2v 缺参考图实测报
    //   InvalidParameter "Field required: input.media"(任务已建、计费,体验差)。
    //   带参考图则正常出片(e00c96a9 真打 SUCCESS)。这里前置硬门给清晰指引。
    const needsRefMedia = /(?:^|[-_/])(?:r2v|i2v)(?:$|[-_/])/.test(modelId.toLowerCase());
    const hasRefMedia =
      (req.refImageUrls?.length ?? 0) > 0 || !!req.firstFrameUrl || !!req.lastFrameUrl;
    if (needsRefMedia && !hasRefMedia) {
      throw new ProviderError(
        this.info.id,
        `模型 ${modelId} 为「${modelId.toLowerCase().includes('r2v') ? 'R2V 参考生视频' : 'I2V 图生视频'}」,必须至少提供一张中转站可用的参考图,但本次 0 张 — 参考图存在本机 localhost 存储(中转站够不到、已过滤;生成图的 base64 是可用的,请确认本组关联了形象图),或改用文生视频(t2v)模型。`,
      );
    }

    const estimated = this.estimateCost(req);

    // 预算护栏
    await this.checkBudget(ctx.projectId, estimated);

    // 构造 task 请求 body(根据 endpointStyle 切换 ark / relay)
    const taskBody = this.buildCreateBody(req, modelId);

    let providerJobId: string;
    try {
      const { statusCode, body } = await request(`${this.cfg.apiUrl}${this.createTaskPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(taskBody),
        dispatcher: seedanceDispatcher, // 2026-05-27 r15:60s connect + 180s body/headers,防 moyu 抖动
      });
      const text = await body.text();
      if (statusCode >= 400) {
        throw new ProviderError(this.info.id, `Create task failed (${statusCode}): ${text.slice(0, 200)}`);
      }
      const json = JSON.parse(text) as Record<string, unknown>;
      providerJobId = this.extractTaskId(json);
      if (!providerJobId) {
        throw new ProviderError(this.info.id, `Missing task_id in create response: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'video.generate',
        inputUnits: 0,
        outputUnits: 0,
        unitPriceCny: this.cfg.unitPriceCny,
        success: false,
      });
      this.wrapCallError(e);
    }

    // L5(七二):task_id 一拿到先回调持久化 — 进程死在下面轮询里时,重入方可续轮询同一
    // 任务而非重建(双任务双结算实测 ¥7.2/只)。best-effort:持久化失败不阻塞生成。
    if (ctx.onVideoTaskCreated) {
      try {
        await ctx.onVideoTaskCreated(providerJobId);
      } catch (e) {
        console.warn(
          `[${this.info.id}] onVideoTaskCreated 回调失败(忽略,task=${providerJobId}):`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 轮询任务完成(2026-05-27 audit r15:用 parseQueryResponse 规范化 2.0 嵌套 + 大写状态)
    const deadline = Date.now() + this.pollTimeoutMs;
    let lastQuery: NormalizedQuery | undefined;
    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      try {
        lastQuery = await this.queryTask(providerJobId);
      } catch (e) {
        await this.recordLedger({
          ctx,
          providerId: modelId,
          modelId,
          action: 'video.generate',
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: this.cfg.unitPriceCny,
          success: false,
        });
        this.wrapCallError(e);
      }

      if (lastQuery.kind === 'success') break;
      if (lastQuery.kind === 'failed') {
        await this.recordLedger({
          ctx,
          providerId: modelId,
          modelId,
          action: 'video.generate',
          inputUnits: 0,
          outputUnits: 0,
          unitPriceCny: this.cfg.unitPriceCny,
          success: false,
        });
        throw new ProviderError(
          this.info.id,
          lastQuery.errorMsg ?? 'Task failed',
        );
      }
    }

    if (!lastQuery || lastQuery.kind !== 'success' || !lastQuery.videoUrl) {
      await this.recordLedger({
        ctx,
        providerId: modelId,
        modelId,
        action: 'video.generate',
        inputUnits: 0,
        outputUnits: 0,
        unitPriceCny: this.cfg.unitPriceCny,
        success: false,
      });
      throw new ProviderError(
        this.info.id,
        `Task timeout (${Math.round(this.pollTimeoutMs / 60000)}min) — Seedance 任务超过预期未完成,可能 moyu 端拥塞或 task 卡死`,
      );
    }

    const actualDuration = lastQuery.durationS ?? req.durationS;
    const costCny = actualDuration * this.cfg.unitPriceCny;

    await this.recordLedger({
      ctx,
      providerId: modelId,
      modelId,
      action: 'video.generate',
      inputUnits: req.durationS,
      outputUnits: actualDuration,
      unitPriceCny: this.cfg.unitPriceCny,
      success: true,
    });

    return {
      videoUrl: lastQuery.videoUrl,
      thumbnailUrl: lastQuery.thumbnailUrl,
      durationS: actualDuration,
      width: lastQuery.width,
      height: lastQuery.height,
      fps: lastQuery.fps,
      providerJobId,
      costCny,
      rawResponse: lastQuery.rawResponse,
    };
  }

  async poll(providerJobId: string): Promise<VideoResult | { status: 'pending' }> {
    const q = await this.queryTask(providerJobId);
    if (q.kind === 'pending') return { status: 'pending' };
    if (q.kind === 'failed' || !q.videoUrl) {
      throw new ProviderError(this.info.id, q.errorMsg ?? 'Task failed');
    }
    const dur = q.durationS ?? 0;
    return {
      videoUrl: q.videoUrl,
      thumbnailUrl: q.thumbnailUrl,
      durationS: dur,
      width: q.width,
      height: q.height,
      fps: q.fps,
      providerJobId,
      costCny: dur * this.cfg.unitPriceCny,
      rawResponse: q.rawResponse,
    };
  }

  private async queryTask(taskId: string): Promise<NormalizedQuery> {
    const { statusCode, body } = await request(
      `${this.cfg.apiUrl}${this.queryTaskPath(taskId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        dispatcher: seedanceDispatcher, // 2026-05-27 r15:复用 keep-alive Agent + 长 timeout
      },
    );
    const text = await body.text();
    if (statusCode >= 400) {
      throw new ProviderError(this.info.id, `Query task failed (${statusCode}): ${text.slice(0, 200)}`);
    }
    const raw = JSON.parse(text) as unknown;
    return this.parseQueryResponse(raw);
  }
}

/** 七二 M5:深扫对象树找第一个 .mp4 直链(moyu 通用信封各家结果位置不一的保险丝;
 * 仅在 status=SUCCESS 分支调用,不会把错误文案里的链接误当成片 — 失败分支根本不进来) */
function findFirstMp4Url(node: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof node === 'string') {
    return /^https?:\/\/\S+\.mp4(\?|$)/i.test(node) ? node : null;
  }
  if (Array.isArray(node)) {
    for (const it of node) {
      const hit = findFirstMp4Url(it, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const rec = asRecord(node);
  if (!rec) return null;
  for (const v of Object.values(rec)) {
    const hit = findFirstMp4Url(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
