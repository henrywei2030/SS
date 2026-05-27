# R2 设计文档 · `aigc.generateVideo` mutation 拆解

> 状态:**待拍板**(三十二收工 design)
> 工作量预估:**4-6h**(含 unit test 补全)
> 风险:**中-高**(改动经济链路:prepay/refund,任何错都涉及资金)

---

## 1. 现状

**位置**:`packages/api/src/routers/aigc.ts:generateVideo` mutation(约 line 1075-1700)

| 维度 | 数字 |
|---|---|
| 单 mutation 行数 | **~626** |
| 累积 patch | **3041 行 + 12 commits** |
| 责任 | lock / stale 恢复 / prepay / budget / compile / 队列入推 / SSE token / fail placeholder |

**核心痛点**:
1. 单 mutation 626 行,无法单测(全 tRPC ctx 依赖)
2. **6 个独立职责糊一起**:`pg_advisory_xact_lock` / stale sweep + refund / budget check / inflight check / prepay ledger / queue push
3. 测试只能用 e2e curl(慢 + 不稳),没 unit test 覆盖
4. 改任何一处都可能动到经济链路,W4-W7 已踩坑(P2002 unique / advisory lock race / refund 重写)

---

## 2. 拆解方案

### 目标:把"业务逻辑"从"router 协调"分离

```
packages/core/video-generation/  ← 新建包内目录
├── lock.ts              // pg_advisory_xact_lock + 释放
├── stale-sweep.ts       // 扫 RUNNING > 10min,标 FAILED + refund(已在 aigc.ts:1175,搬过来)
├── budget-check.ts      // dailyBudget / project budget 检查
├── inflight-check.ts    // 同 group QUEUED/RUNNING 拒重入
├── prepay.ts            // create placeholder attempt + PREPAY ledger entry
├── refund.ts            // 标 FAILED + 写 REFUND(idempotent;复用于 stale-sweep + 编译失败)
├── compile.ts           // compileShotGroupVideoPrompt 包装 + binding 读
├── enqueue.ts           // BullMQ push + SSE token 签发
└── index.ts             // re-export
```

router 层 `aigc.generateVideo` 改成"协调器",只跑 ~50 行:
```ts
generateVideo: protectedProcedure
  .input(...)
  .mutation(async ({ ctx, input }) => {
    const grp = await loadGroup(ctx, input.shotGroupId);
    const ucx = { userId: ctx.user.id, projectId: grp.projectId, episodeId: grp.episodeId };

    return ctx.prisma.$transaction(async (tx) => {
      await acquireAigcVideoLock(tx, grp.id);
      await sweepStaleRunning(tx, grp.id, ucx);  // 含 refund
      await checkBudget(tx, ucx, capabilities.unitPriceCny);
      await checkInflight(tx, grp.id);
      const compiled = await compileVideoPrompt(tx, grp, input);
      const { attempt, prepayEntryId } = await createPrepay(tx, ucx, compiled);
      const sseToken = await enqueueVideoJob(attempt.id, compiled);
      return { attemptId: attempt.id, sseToken };
    });
  })
```

### 每个模块的边界

**`lock.ts`**:`acquireAigcVideoLock(tx, groupId)` — 单函数,封装 `pg_advisory_xact_lock(hashtext('aigc_video:' || groupId)::bigint)`

**`stale-sweep.ts`**:`sweepStaleRunning(tx, groupId, ucx)` — 已有逻辑(aigc.ts:1175-1230 + worker/index.ts:30-100)搬这里,**单一真相源**;两个调用点(aigc.generateVideo + worker boot)都引用

**`refund.ts`**:`refundPrepay(tx, attemptId, ucx, reason)` — idempotent(查 REFUND 是否已存在),从 stale-sweep / compile-fail / batch-rollback 三处复用

**`compile.ts`**:接 `(tx, shotGroup, input)`,内部读 binding(loadSystemSettings)+ compileShotGroupVideoPrompt;失败抛 `CompileError`(自定义 Error class)

**`enqueue.ts`**:接 `attemptId + compiledJob`,push BullMQ + 签 SSE token;失败抛 `EnqueueError`,触发上层 `refundPrepay`

### 测试覆盖

每个模块独立 unit test(用 Prisma mock 或 testcontainer):
- `lock.test.ts`:模拟并发,verify lock 真互斥
- `stale-sweep.test.ts`:塞假 stale → run → assert refund ledger
- `budget-check.test.ts`:预算用尽场景
- `refund.test.ts`:idempotent verify(重复 refund 不重写)
- `enqueue.test.ts`:BullMQ mock 验证 payload

**目标:从 0 unit test → 20+ unit tests 覆盖核心经济链路。**

---

## 3. 实施步骤

### Phase A:抽出但不改 router(零行为变化)
1. 建 `packages/core/video-generation/` + 各文件骨架(`function xxx(tx, ...) { throw "not impl" }`)
2. **逐个模块**搬代码(从 aigc.ts 复制片段过去),old code 暂保留
3. 每模块加 1-2 个 unit test

### Phase B:router 切换调用
4. `aigc.generateVideo` 改用新模块(原 626 行 → ~50 行)
5. 删 aigc.ts 内被搬走的代码块
6. typecheck + tests + curl 真打 e2e(login → generateVideo → SSE 看 SUCCESS)

### Phase C:worker 也用新模块
7. `apps/workers/video-gen/src/index.ts` stale sweep 改用 `sweepStaleRunning` 共享逻辑(去重复实现)
8. typecheck + 重启 worker 测 stale 场景

### Phase D:补 unit test
9. 各模块测试覆盖 ≥ 80% 行
10. test 总数从 95 → 115+(20 个新)

---

## 4. 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| 经济链路 bug(refund 重复 / 漏退) | 高 | 每模块独立 unit test,assert ledger entry 唯一 |
| 事务边界拆错(锁释放 vs ledger 写顺序) | 中 | 强制所有 mutation 在同一 `$transaction` 内,各模块接 `tx` 而非 prisma |
| Phase A 期间双份代码(老 + 新) | 低 | 时间窗短(几小时),不让代码 land main 直到 Phase B 完 |
| BullMQ payload 兼容性 | 低 | enqueue.ts 抽出后 payload schema 不变,worker 端不动 |

---

## 5. 验收标准

- [ ] `aigc.generateVideo` mutation 主体 ≤ 80 行
- [ ] `packages/core/video-generation/` 8 个文件,各 < 200 行
- [ ] typecheck 16/16
- [ ] tests **115+**(原 95 + 20 新 unit)
- [ ] curl 真打 generateVideo 全链路 SUCCESS
- [ ] worker 重启 stale sweep 退款 ledger 正确

---

## 6. 不在范围

- Provider adapter 重构(seedance/openai-compat 各自独立,不动)
- BullMQ 队列协议改造(payload schema 不动)
- SSE protocol 改造(已 work)
- 数据库 schema 改动(经济模型已稳定)

---

## 7. 决策点(待用户拍)

- **Q1**: `packages/core/video-generation/` vs `packages/api/src/services/video-generation/` — 放 core 还是 api?
  - **建议**:core(可被 worker 复用,api 只是其中一个 caller)
- **Q2**:是否同步抽 `aigc.generateImage`(类似单 mutation 模式)?
  - **建议**:不,先做 video(行数最大、累积 patch 最多);image 留下次
- **Q3**:Phase A 期间 main 是否冻结 aigc.ts 改动?
  - **建议**:否,但 Phase A 限 1 天内完成,减少 rebase 冲突
