/**
 * PG advisory 事务锁 — 共享 helper(12 维深审 P3:收敛 11 处裸 SQL 单一真相源)
 *
 * 必须在 `$transaction` 内调用 — `pg_advisory_xact_lock` 随事务 commit/rollback 自动释放;
 * 在 implicit transaction(单条 raw)里调用会立即释放,串行化失效(七轮 audit A1 教训)。
 *
 * namespace 即互斥域:同 namespace + 同 id 的并发事务串行。
 * ⚠️ 改 namespace 字面量 = 改互斥域,会破坏既有互斥(如 aigc-prompt 与 aigc-bindings
 *   共用 'aigc_match'),所有调用点集中列在 LockNamespace 里防漂移。
 *
 * core 层的 acquireAigcVideoLock('aigc_video')/process-job('attempt_refund')保持自有实现
 * (core 不依赖 api),namespace 不在此表也不冲突。
 */

/** 全部 api 层互斥域(按字母序)。新增锁请在此登记。 */
export type LockNamespace =
  | 'aigc_match' // 资产↔生成段绑定/自动匹配(aigc-prompt + aigc-bindings 共域)
  | 'asset_confirm' // 资产候选确认(asset-candidates)
  | 'episode_lock' // episode 软锁抢占(episode-lock util)
  | 'episode_publish' // 分镜发布(storyboard-generate)
  | 'episode_render' // 整集成片发起防重入(compose · M1)
  | 'insp_draft' // 灵感草稿展开(inspiration)
  | 'script_version' // 剧本版本写入(script-upload)
  | 'storyboard_group'; // 分镜组合并/拆分(storyboard-group + aigc-groups)

type TxWithRaw = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

/** 在当前事务内抢 `namespace:id` 的 advisory 锁(阻塞等待,事务结束自动释放)。 */
export async function acquireTxAdvisoryLock(
  tx: TxWithRaw,
  namespace: LockNamespace,
  id: string,
): Promise<void> {
  // namespace 是闭集字面量、id 走参数绑定 — 无注入面
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext('${namespace}:' || $1)::bigint)`,
    id,
  );
}
