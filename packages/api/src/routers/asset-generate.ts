/**
 * Asset Router · 生成组(profile 字段 / 资产文本 / 图像 / compilePrompt / listImageProviders)
 *
 * P2(ADR-31):从 asset.ts(god 路由)按组拆出的 sibling。纯搬运,无行为变化。
 * helper / schema / 常量见 ./asset-shared.ts;在 asset.ts 里 spread 回 assetRouter。
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { compileAssetPrompt } from "@ss/core/asset";
import { getImageProvider, getTextProvider } from "@ss/adapters/provider";
import { getStorageAdapter } from "@ss/adapters/storage";
import { getEventBus } from "@ss/adapters/eventbus";
import { asRecord, EVENTS, sanitizeErrorMsg, billingCycle } from "@ss/shared";
import { protectedProcedure } from "../trpc.js";
import { logOperation } from "../middleware/audit.js";
import { loadSystemSettings } from "../utils/system-bindings.js";
import { runTextGenerationAttempt } from "../utils/generation-attempt.js";
import { loadAssetWithAccess, loadProjectFullScript, SlotSchema } from "./asset-shared.js";

export const generateProcedures = {
  // ---- AI 生成档案字段(2026-06 P1:图2「AI 生成」按钮后端;返回草案不直接入库,前端编辑后再 update)----
  generateProfileField: protectedProcedure
    .meta({
      agentTool: {
        description: '基于已有人物信息 AI 生成某档案字段草案(mbti/personalityTags/monologue/lifeNodes)',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct'],
        costEstimateCny: 0.01,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        assetId: z.string().cuid(),
        field: z.enum(['mbti', 'personalityTags', 'monologue', 'lifeNodes']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const settings = await loadSystemSettings(ctx.prisma, ['binding.asset.breakdown.modelId']);
      const modelId = settings['binding.asset.breakdown.modelId'];
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产设定 AI 生成未配置 LLM — 去 /admin/bindings 配 binding.asset.breakdown.modelId',
        });
      }
      const provider = await getTextProvider(modelId);
      const known = [
        `姓名:${asset.name}`,
        asset.gender ? `性别:${asset.gender}` : null,
        asset.age != null ? `年龄:${asset.age}` : null,
        asset.characterRole ? `角色定位:${asset.characterRole}` : null,
        asset.description ? `外观/描述:${asset.description}` : null,
        asset.personalityTags.length ? `性格标签:${asset.personalityTags.join('、')}` : null,
        asset.mbti ? `MBTI:${asset.mbti}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const FIELD_SPEC: Record<typeof input.field, { task: string; json: boolean }> = {
        mbti: { task: '推断该角色最可能的 MBTI 类型,只输出 4 个大写字母(如 INTJ),不要解释。', json: false },
        monologue: { task: '写一句体现该角色内核的第一人称独白,≤40 字,只输出独白本身。', json: false },
        personalityTags: { task: '生成 3-5 个性格标签。严格输出 JSON:{"tags":["标签1","标签2"]}', json: true },
        lifeNodes: {
          task: '生成 3-5 个人生关键节点(按时间排序)。严格输出 JSON:{"lifeNodes":[{"year":"2076","title":"出生","desc":"≤80字"}]}',
          json: true,
        },
      };
      const spec = FIELD_SPEC[input.field];

      // 五六收工:补 GenerationAttempt 审计行(对齐 asset.breakdown 的 TEXT 链路)。
      //   原本调 LLM 不留 attempt,BaseProvider 写的 ledger 行 attemptId 为空、无法回溯。
      //   建 attempt + 传 attemptId 让 ledger 关联;不传 skipLedger(保持原计费,纯增审计)。
      // P3-A:状态机走 runTextGenerationAttempt(create RUNNING / SUCCESS / 软失败 FAILED 统一,有单测锁)。
      return runTextGenerationAttempt(
        ctx,
        {
          projectId: asset.projectId,
          assetId: asset.id,
          modelId,
          inputJson: { kind: 'asset.generateProfileField', field: input.field },
          failPrefix: 'AI 生成失败',
          wrapError: (e, sanitized) => {
            // 对齐 breakdown:errMsg 入库 + throw 前脱敏(防真接 Provider 泄漏 URL/token)
            console.error('[asset.generateProfileField] LLM failed (raw):', e);
            return new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: sanitized || 'AI 生成失败',
              cause: e,
            });
          },
        },
        async (attemptId) => {
          const result = await provider.generate(
            {
              system: '你是资深编剧 / 人物设定师。基于已知人物信息补全指定字段。严格只输出要求的内容,不要解释。',
              prompt: `【已知人物信息】\n${known}\n\n【任务】${spec.task}`,
              // 五六-2:放宽到 4000 给 thinking 模型(如 gemini-3-flash)留推理预算 —— 实测小 maxTokens
              //   会被 thinking token 耗尽返空文本;非 thinking 模型产短字段会提前停,cap 大不浪费
              maxTokens: 4000,
              temperature: 0.85,
              ...(spec.json ? { jsonSchema: {} } : {}),
            },
            { userId: ctx.user.id, projectId: asset.projectId, assetId: asset.id, attemptId },
          );

          // json 字段解析失败(result.json == null)记 FAILED,但仍返回让前端拿 warning 重试
          const parseFailed = spec.json && result.json == null;

          let value: unknown;
          if (input.field === 'mbti' || input.field === 'monologue') {
            value = result.text.trim().replace(/^["'「」]+|["'「」]+$/g, '');
          } else if (input.field === 'personalityTags') {
            const obj = asRecord(result.json);
            value = Array.isArray(obj?.tags)
              ? obj.tags.filter((t): t is string => typeof t === 'string').slice(0, 10)
              : [];
          } else {
            const obj = asRecord(result.json);
            const arr = Array.isArray(obj?.lifeNodes) ? obj.lifeNodes : [];
            value = arr
              .map((n) => {
                const r = asRecord(n);
                if (!r) return null;
                return {
                  year: typeof r.year === 'string' ? r.year : String(r.year ?? ''),
                  title: typeof r.title === 'string' ? r.title : '',
                  desc: typeof r.desc === 'string' ? r.desc : '',
                };
              })
              .filter((n): n is { year: string; title: string; desc: string } => n !== null);
          }
          return {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCny: result.costCny,
            // 软失败:attempt.errorMsg='AI 输出解析失败';但返回给前端的 warning 带「请重试」
            warning: parseFailed ? 'AI 输出解析失败' : undefined,
            value: {
              field: input.field,
              value,
              warning: parseFailed ? 'AI 输出解析失败,请重试' : undefined,
            },
          };
        },
      );
    }),


  /**
   * 五六-2:定点(重)生成某资产的某段设定(description 形象/场景/道具描述 · prompt 生图词 · bio 人物小传)。
   * 用「完整剧本」+「该资产已知设定」做上下文,支撑前端每段的「AI 重新生成」。建 attempt 审计。
   */
  generateAssetText: protectedProcedure
    .meta({
      agentTool: {
        description: '基于完整剧本 + 已知设定,(重)生成资产的 description/prompt/bio',
        sideEffects: ['extern.api:TextProvider', 'cost.deduct', 'db.create:GenerationAttempt'],
        costEstimateCny: 0.05,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        assetId: z.string().cuid(),
        field: z.enum(['description', 'prompt', 'bio']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      if (input.field === 'bio' && asset.type !== 'CHARACTER') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '人物小传仅人物资产适用' });
      }
      const settings = await loadSystemSettings(ctx.prisma, ['binding.asset.breakdown.modelId']);
      const modelId = settings['binding.asset.breakdown.modelId'];
      if (!modelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '资产设定 AI 生成未配置 LLM — 去 /admin/bindings 配 binding.asset.breakdown.modelId',
        });
      }
      const provider = await getTextProvider(modelId);
      const { text: scriptText } = await loadProjectFullScript(ctx, asset.projectId, 40_000);

      const typeLabel = asset.type === 'CHARACTER' ? '人物' : asset.type === 'SCENE' ? '场景' : '道具';
      const known = [
        `姓名/名称:${asset.name}`,
        asset.characterRole ? `角色定位:${asset.characterRole}` : null,
        asset.gender ? `性别:${asset.gender}` : null,
        asset.age != null ? `年龄:${asset.age}` : null,
        asset.description ? `现有外形/描述:${asset.description}` : null,
        asset.bio ? `现有小传:${asset.bio}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const FIELD_TASK: Record<typeof input.field, string> = {
        description:
          asset.type === 'CHARACTER'
            ? '人物形象设定(120-200字:脸型/五官/眼神 + 体型身高 + 发型发色 + 典型服饰款式材质配饰 + 标志特征/气质,稳定视觉锚,利于生图一致)'
            : asset.type === 'SCENE'
              ? '场景设定描述(120-200字:空间结构 + 陈设布局 + 材质色调 + 时段天气 + 光影方向质感 + 氛围情绪,尽量完善利于生图)'
              : '道具设定描述(80-150字:外形尺寸 + 材质工艺 + 年代磨损使用痕迹 + 颜色纹理 + 戏剧功能与象征)',
        prompt: '生图提示词(把视觉设定浓缩为可直接送图像模型的 spec,不含镜头/构图/机位词)',
        bio: '人物小传(200-400字:出身家世 + 核心动机/欲望/创伤 + 贯穿全剧人物弧光 + 与主要人物关系,基于剧本合理推演)',
      };

      // P3-A:状态机走 runTextGenerationAttempt(create RUNNING / SUCCESS 统一,有单测锁)。
      return runTextGenerationAttempt(
        ctx,
        {
          projectId: asset.projectId,
          assetId: asset.id,
          modelId,
          inputJson: { kind: 'asset.generateAssetText', field: input.field },
          failPrefix: 'AI 生成失败',
          wrapError: (e, sanitized) => {
            console.error('[asset.generateAssetText] LLM failed (raw):', e);
            return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: sanitized || 'AI 生成失败', cause: e });
          },
        },
        async (attemptId) => {
          const result = await provider.generate(
            {
              system:
                '你是顶级影视制作设计 + 编剧。基于【完整剧本】和【已知设定】(重新)生成指定字段。严格只输出该字段正文,不要解释 / markdown / 字段名前缀。',
              prompt: `【完整剧本】\n${scriptText || '(暂无剧本,仅据已知设定专业发挥)'}\n\n【该${typeLabel}已知设定】\n${known}\n\n【任务】为「${asset.name}」生成${FIELD_TASK[input.field]}。`,
              // 五六-2:放宽到 4000 给 thinking 模型留推理预算(同 generateProfileField)
              maxTokens: 4000,
              temperature: 0.5,
            },
            { userId: ctx.user.id, projectId: asset.projectId, assetId: asset.id, attemptId },
          );
          return {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCny: result.costCny,
            value: { field: input.field, value: result.text.trim() },
          };
        },
      );
    }),


  /**
   * 列出所有 active IMAGE Provider — 五六收工:美术工坊视觉生成器图片模型下拉
   *
   * 对齐 aigc.listVideoProviders 模式。原 GenerationPanel hardcode 3 个占位模型
   * (nano-banana-pro / gpt-image-2 / seedance-2.0),与真实 ProviderConfig 脱节。
   * 改读真实配置:默认空 = 用 binding.asset.image.providerId,用户可切换后传 input.modelId 覆盖。
   */
  listImageProviders: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.providerConfig.findMany({
      where: { kind: 'IMAGE', isActive: true },
      orderBy: [{ providerId: 'asc' }],
      select: { providerId: true, displayName: true },
    });
    return rows;
  }),


  /**
   * 编译资产 prompt — 给前端"预览最终送图像模型的完整 prompt"用
   * 不调 LLM,纯函数计算,可频繁调
   */
  compilePrompt: protectedProcedure
    .input(
      z.object({
        assetId: z.string().cuid(),
        slot: SlotSchema.optional(),
        extraInstruction: z.string().max(500).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);
      const style = asset.styleId
        ? await ctx.prisma.styleProfile.findUnique({ where: { id: asset.styleId } })
        : null;
      // 项目默认风格
      const project = !style
        ? await ctx.prisma.project.findUnique({
            where: { id: asset.projectId },
            include: { style: true },
          })
        : null;
      const effectiveStyle = style ?? project?.style ?? null;

      return compileAssetPrompt({
        asset: {
          type: asset.type as 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE',
          name: asset.name,
          description: asset.description,
          prompt: asset.prompt,
          archetypeKey: asset.archetypeKey,
        },
        style: effectiveStyle,
        slot: input.slot,
        extraInstruction: input.extraInstruction,
      });
    }),


  /**
   * [W4-MM mock 实现] 图像生成 — 留 W4-MM.6 接真实 ImageProvider
   *
   * 当前行为:
   *   1. 用 compileAssetPrompt 拼接最终 prompt(展示在 GenerationAttempt.inputJson)
   *   2. 创建 GenerationAttempt(action=IMAGE,candidateForSlot=slot,status=SUCCESS)
   *   3. 创建占位 MediaItem(storageKey 用 placeholder://,前端展示占位图)
   *   4. 不真扣费(unitPrice=0)
   *
   * W4-MM.6 替换:把占位换成真实 ImageProvider.generate() + MinIO 上传 + storageKey
   */
  generateImage: protectedProcedure
    // 第 19 轮 audit / ADR-27:扣费 + 调外部 Provider,Mastra agent 调用需 budget 决策
    .meta({
      agentTool: {
        description: '为资产某槽位(portrait / threeView 等)抽卡生成参考图,调 NanoBanana/GPT-Image/豆包',
        sideEffects: [
          'extern.api:ImageProvider',
          'cost.deduct',
          'db.create:GenerationAttempt',
          'db.create:MediaItem',
          'db.create:CostLedgerEntry',
        ],
        costEstimateCny: 0.5,
        requireConfirm: false,
      },
    })
    .input(
      z.object({
        assetId: z.string().cuid(),
        slot: SlotSchema,
        count: z.number().int().min(1).max(4).default(1),
        modelId: z.string().max(100).optional(),
        aspectRatio: z.string().max(20).optional(),
        sizePx: z.string().max(20).optional(),
        extraInstruction: z.string().max(500).optional(),
        // 五七-3:图生图参考图(mediaId)+ 强度 + 负面词
        refImageIds: z.array(z.string().cuid()).max(16).optional(),
        strength: z.number().min(0).max(1).optional(),
        extraNegative: z.array(z.string().max(50)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetWithAccess(ctx, input.assetId);

      // 项目风格
      const project = await ctx.prisma.project.findUnique({
        where: { id: asset.projectId },
        include: { style: true },
      });

      // 读 binding(三十二收工 S3 followup:helper batch)
      const imgSettings = await loadSystemSettings(ctx.prisma, [
        'binding.asset.image.providerId',
        'binding.asset.panorama.providerId',
      ]);
      // 二十收工后用户反馈:不 hardcode 默认 provider,binding 空时显式拒绝(input.modelId 优先,测试调试用)
      const providerId =
        input.modelId ??
        (input.slot === 'panorama'
          ? imgSettings['binding.asset.panorama.providerId'] ?? ''
          : imgSettings['binding.asset.image.providerId'] ?? '');
      if (!providerId) {
        const bindingKey = input.slot === 'panorama'
          ? 'binding.asset.panorama.providerId'
          : 'binding.asset.image.providerId';
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `资产${input.slot === 'panorama' ? '全景图' : '图像'}生成未配置 Image Provider — 请去 /admin/bindings 选择 ${bindingKey}(或在调用时传 input.modelId 显式指定)`,
        });
      }

      const compiled = compileAssetPrompt({
        asset: {
          type: asset.type as 'CHARACTER' | 'SCENE' | 'PROP' | 'STYLE_REFERENCE',
          name: asset.name,
          description: asset.description,
          prompt: asset.prompt,
          archetypeKey: asset.archetypeKey,
        },
        style: project?.style ?? null,
        slot: input.slot,
        extraInstruction: input.extraInstruction,
        extraNegative: input.extraNegative,
      });

      const aspectRatio =
        input.aspectRatio ??
        (input.slot === 'portrait'
          ? '9:16'
          : input.slot === 'three_view'
            ? '16:9'
            : input.slot === 'panorama'
              ? '2:1'
              : '1:1');

      // 五七-3:解析参考图 mediaId → 可 fetch 的 http URL(给图生图 /images/edits;adapter 会 fetch bytes)
      let refImageUrls: string[] | undefined;
      if (input.refImageIds && input.refImageIds.length > 0) {
        const refMedias = await ctx.prisma.mediaItem.findMany({
          where: { id: { in: input.refImageIds }, deletedAt: null },
          select: { storageKey: true, cdnUrl: true },
        });
        const storage = getStorageAdapter();
        const urls: string[] = [];
        for (const m of refMedias) {
          if (m.cdnUrl) {
            urls.push(m.cdnUrl);
          } else if (m.storageKey.startsWith('external://')) {
            urls.push(m.storageKey.replace(/^external:\/\//, ''));
          } else if (m.storageKey.startsWith('placeholder://')) {
            // mock 占位图无法 fetch,跳过
          } else {
            try {
              urls.push(await storage.getSignedUrl(m.storageKey, 3600));
            } catch {
              /* sign 失败跳过该参考图 */
            }
          }
        }
        refImageUrls = urls.length > 0 ? urls : undefined;
      }

      // 调 ImageProvider(W4-MM.6 真接入,当前 MockImageProvider 走 picsum.photos)
      const startedAt = new Date();
      let imageResult;
      try {
        const provider = await getImageProvider(providerId);
        imageResult = await provider.generate(
          {
            prompt: compiled.positive,
            count: input.count,
            aspectRatio,
            mode: input.slot === 'three_view' ? 'three_view' : input.slot === 'panorama' ? 'panorama_360' : 'standard',
            // 五八-fix:不要把 input.modelId(= providerId,带 moyu- 前缀)当 model 名发给中转站!
            //   providerId 只用于上面 getImageProvider() 选配置;真实模型名由该配置 defaultModel 提供
            //   (adapter:req.model ?? cfg.defaultModel)。原来误传 providerId → moyu 找不到模型 → 无可用渠道(从没到引擎)。
            refImageUrls,
            ...(input.strength != null ? { extra: { strength: input.strength } } : {}),
          },
          {
            userId: ctx.user.id,
            projectId: asset.projectId,
            assetId: asset.id,
            // W1-W5 audit P1 followup:防 ImageProvider 内置 ledger + router 双写。
            // 真接 NanoBanana / GPT Image 时这条防 cost 翻倍。router 用真实
            // imageResult.imageUrls.length 算 outputUnits + realUnitPriceCny。
            skipLedger: true,
          },
        );
      } catch (e) {
        // W1-W5 audit P0(B2):失败路径也必须留 attempt + ledger 行,
        // 否则抽卡率(成功 / (成功+失败))分母会缺,Phase 2 ROI 监控失真
        const failedAt = new Date();
        // 第 18 轮 audit P1:errMsg 入库 + throw 前脱敏(防真接 Provider 后泄漏 URL/token)
        // 原始 e 通过 TRPCError.cause 透传,服务端日志仍可见
        console.error('[asset.generateImage] provider failed (raw):', e);
        const errMsg = sanitizeErrorMsg(e);
        const failedAttempt = await ctx.prisma.generationAttempt.create({
          data: {
            projectId: asset.projectId,
            assetId: asset.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'IMAGE',
            candidateForSlot: input.slot,
            inputJson: {
              prompt: compiled.positive,
              negative: compiled.negative,
              aspectRatio,
              sizePx: input.sizePx,
              count: input.count,
            },
            outputMediaIds: [],
            inputUnits: 0,
            outputUnits: 0,
            unitPriceCny: '0',
            costCny: '0',
            status: 'FAILED',
            errorMsg: errMsg,
            startedAt,
            finishedAt: failedAt,
            durationMs: failedAt.getTime() - startedAt.getTime(),
            createdBy: ctx.user.id,
          },
        });
        await ctx.prisma.costLedgerEntry.create({
          data: {
            userId: ctx.user.id,
            projectId: asset.projectId,
            assetId: asset.id,
            attemptId: failedAttempt.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'image.generate',
            inputUnits: 0,
            outputUnits: 0,
            unitPriceCny: '0',
            costCny: '0',
            success: false,
            billingCycle: billingCycle(),
          },
        });

        await logOperation(ctx, 'asset.generateImage.failed', 'asset', asset.id, null, {
          error: errMsg,
          providerId,
          slot: input.slot,
          projectId: asset.projectId,
          attemptId: failedAttempt.id,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `图像生成失败: ${errMsg}`,
          cause: e, // W7 audit R9
        });
      }
      const finishedAt = new Date();

      // W1-W5 audit P0(B3):从 imageResult 反推真单价,不再硬编码 '0',
      // Phase 2 真 ImageProvider 接入后对账才不会全错
      const realUnitPriceCny =
        imageResult.imageUrls.length > 0
          ? (imageResult.costCny / imageResult.imageUrls.length).toFixed(6)
          : '0';

      // 三类写入(MediaItem×N + GenerationAttempt + CostLedgerEntry)用同一事务
      // 任一失败回滚全部 — 防出现"图片入库但没账单"或"账单但找不到图"
      const safeName = asset.name
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .slice(0, 40);
      const { mediaIds, attempt } = await ctx.prisma.$transaction(async (tx) => {
        const createdMedias = await Promise.all(
          imageResult.imageUrls.map((url, i) =>
            tx.mediaItem.create({
              data: {
                projectId: asset.projectId,
                scope: 'PROJECT',
                kind: 'IMAGE',
                filename: `${safeName}-${input.slot}-${startedAt.getTime()}-${i}.png`,
                mimeType: 'image/png',
                sizeBytes:
                  imageResult.width && imageResult.height
                    ? Math.round(imageResult.width * imageResult.height * 0.5)
                    : 0,
                storageKey: url.startsWith('http')
                  ? `placeholder://external?u=${encodeURIComponent(url)}`
                  : url,
                cdnUrl: url,
                meta: {
                  slot: input.slot,
                  prompt: compiled.positive,
                  negative: compiled.negative,
                  width: imageResult.width,
                  height: imageResult.height,
                  providerId,
                  modelId: input.modelId ?? providerId,
                },
                aspectRatio,
                viewKind: input.slot,
                source: 'AIGC',
                sourceRef: asset.id,
              },
            }),
          ),
        );
        const ids = createdMedias.map((m) => m.id);
        const attemptRow = await tx.generationAttempt.create({
          data: {
            projectId: asset.projectId,
            assetId: asset.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'IMAGE',
            candidateForSlot: input.slot,
            inputJson: {
              prompt: compiled.positive,
              negative: compiled.negative,
              aspectRatio,
              sizePx: input.sizePx,
              count: input.count,
              parts: compiled.parts,
            },
            outputMediaId: ids[0],
            outputMediaIds: ids,
            inputUnits: 0,
            outputUnits: imageResult.imageUrls.length,
            unitPriceCny: realUnitPriceCny,
            costCny: imageResult.costCny.toFixed(4),
            status: 'SUCCESS',
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            createdBy: ctx.user.id,
          },
        });
        // Cost Ledger 同事务双写,失败回滚 attempt + medias
        await tx.costLedgerEntry.create({
          data: {
            userId: ctx.user.id,
            projectId: asset.projectId,
            assetId: asset.id,
            attemptId: attemptRow.id,
            providerId,
            modelId: input.modelId ?? providerId,
            action: 'image.generate',
            inputUnits: 0,
            outputUnits: imageResult.imageUrls.length,
            unitPriceCny: realUnitPriceCny,
            costCny: imageResult.costCny.toFixed(4),
            success: true,
            billingCycle: billingCycle(),
          },
        });
        return { mediaIds: ids, attempt: attemptRow };
      });

      await logOperation(ctx, 'asset.generateImage', 'asset', asset.id, null, {
        slot: input.slot,
        count: imageResult.imageUrls.length,
        providerId,
        aspectRatio,
        cost: imageResult.costCny,
        projectId: asset.projectId,
      });

      // 第 19 轮 audit P1:真 publish ASSET_GENERATED(events.ts 定义但 router 漏调)
      // 每个 mediaId 推一条,订阅方按 mediaItemId 跟踪
      for (const mediaId of mediaIds) {
        await getEventBus()
          .publish(
            EVENTS.ASSET_GENERATED,
            { assetId: asset.id, version: 0, mediaItemId: mediaId },
            { publisherId: 'asset.generateImage' },
          )
          .catch((err) => {
            console.error('[asset.generateImage] eventbus publish failed:', err);
          });
      }

      // 为 UI 方便,返回 candidates 数组(每张图对应一个伪 attempt — 实际 1 个 attempt 多图)
      const candidates = mediaIds.map((mediaId) => ({
        mediaId,
        attemptId: attempt.id,
      }));

      return {
        candidates,
        providerId,
        aspectRatio,
        compiledPrompt: compiled,
        cost: imageResult.costCny,
      };
    }),

};
