/**
 * 共用 Zod schemas — 所有跨模块复用的输入/输出形状统一在此
 *
 * 命名规范：
 *   - 输入：xxxSchema, type XxxInput = z.infer<typeof xxxSchema>
 *   - 请求：xxxRequestSchema
 *   - 结果：xxxResultSchema
 */
export * from './project.js';
// 7 遍检查清死代码:episode/shot/asset/generation/compliance/voice/team schema 全废弃
//   (路由层改为内联 z.object 后零消费;同名 Input 类型由各 router/core 另行定义)→ 已删文件。
//   只 project.js 仍活(aspectRatioSchema / create·updateProjectSchema)。
