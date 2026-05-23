-- W5 P2:GenerationAttempt 加 (providerId, providerJobId) partial unique
--
-- 场景:
--   异步 video provider(Seedance 等)走 create → poll 模式,W5.5 BullMQ worker 接入后
--   webhook / poll retry 可能多次回写同 jobId。当前 router 直接 update by attemptId 没拦,
--   如果同 providerJobId 出现在两个 attempt 行,后写入的会覆盖前一个 → 历史丢失。
--
-- 修:
--   (providerId, providerJobId) WHERE providerJobId IS NOT NULL 唯一,
--   既支持 providerJobId 为空的 attempt(W3 LLM text 调用 / W4 image 同步调用),
--   又保证异步 provider 同 jobId 全局唯一。
--
-- 影响:
--   W5.4 当前 Mock attempts 已有 providerJobId 填充(`mock-${timestamp}-${random}`),
--   不会撞 unique。Seedance 真接入后,W5.5 worker 写回 SUCCESS 时如果 attempt 已经被
--   其他实例写过,P2002 抛出,worker 端补 catch 当幂等成功。

CREATE UNIQUE INDEX "generation_attempts_providerId_providerJobId_key"
ON "generation_attempts" ("providerId", "providerJobId")
WHERE "providerJobId" IS NOT NULL;
