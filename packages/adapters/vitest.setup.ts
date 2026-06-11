/**
 * Vitest setup — dummy DATABASE_URL 让 @ss/db 的 prisma client init 不抛。
 *
 * H0:openai-compat-embedding.test.ts 实例化 OpenAICompatEmbeddingProvider
 * (extends BaseProvider → import '@ss/db' 顶层 createPrisma())。
 * 测试只跑纯函数(解析/估价),不实际 connect — dummy URL 让 init 通过即可。
 * 模式同 packages/core/vitest.setup.ts(三十六收工 R2 Phase D)。
 */
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
