import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

// 桌面打包专用开关(desktop-pack / CI 设 SS_DESKTOP_BUILD=1):
//   把 @ss/db 移出 transpilePackages、放进 serverExternalPackages —— 运行时 require 预编译好的
//   @ss/db JS(由 desktop-pack 用 esbuild 编译后放进 standalone node_modules)。
//   原因:Next/SWC 编译生成的 Prisma client 会搞坏查询构建器(打包态 findFirst 报空 detail
//   Invalid invocation);而 esbuild 编译的同款 client(seed 已验证)正常。默认档(dev/docker)
//   不开此开关 → @ss/db 仍走 transpile,行为完全不变。
const isDesktopBuild = process.env.SS_DESKTOP_BUILD === '1';

// 六八:桌面构建走独立 distDir — `next build` 与 `next dev` 共用 .next 会互踩
// (打包期间用户正在用 dev server 时页面直接报错)。隔离后打包随时可跑,互不影响。
// desktop-pack.mjs 读 standalone 的路径同步用 .next-desktop。

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 桌面构建独立产物目录(见上注),dev 仍用默认 .next
  ...(isDesktopBuild ? { distDir: '.next-desktop' } : {}),
  transpilePackages: [
    '@ss/api',
    '@ss/core',
    ...(isDesktopBuild ? [] : ['@ss/db']),
    '@ss/shared',
    '@ss/i18n',
    '@ss/adapters',
  ],
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
    // r8 性能优化:tree-shake 大型 icon / utility 库
    // lucide-react 默认全量打包 ~600KB,优化后只引导入的 icon ~5KB/个
    // 实测首屏 JS bundle 减 250-400KB
    // 二十九收工 S2:加 recharts(story-compass.tsx 用,~300KB 全量包,tree-shake 后只引导入图表)
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', 'date-fns', 'recharts'],
  },
  // r8 性能优化:每个 lucide-react icon 改 named tree-shake import
  // import { ClapperboardIcon } from 'lucide-react' → lucide-react/dist/esm/icons/clapperboard
  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}',
      preventFullImport: true,
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  output: 'standalone',

  /**
   * 桌面打包:monorepo + pnpm 下,nft 默认从 apps/web 追踪 → 漏掉经 .pnpm 符号链接的
   * Next 内部依赖(如 styled-jsx)→ standalone 缺包,装到 .app(无上层 node_modules)即
   * `Cannot find module 'styled-jsx'`。把追踪根设为仓库根 → 完整纳入 workspace/.pnpm 依赖,
   * standalone 真自包含。
   */
  outputFileTracingRoot: path.join(__dirname, '../../'),

  /**
   * 服务端外部包 — 不进 webpack bundle,运行时从 node_modules require。
   * 桌面化:instrumentation 拉入 @ss/core/video-generation → @ss/db(pg)→ pg 可选原生 `pg-native`
   *   解析失败致 500。这些都是服务端 Node 包(含原生/动态 require),本就该外部化;
   *   对默认档同样正确(standalone build 会 trace 进产物 node_modules)。
   */
  serverExternalPackages: [
    'pg',
    '@prisma/client',
    '@prisma/adapter-pg',
    'bullmq',
    'ioredis',
    // M0 ffmpeg 封装(@ss/core/media):index.js 用 __dirname 定位平台二进制,
    // 进 bundle 会路径漂移 → 必须外部化。桌面 .app 若 trace 不带二进制,用 SS_FFMPEG_PATH 兜底(M1 验证)
    'ffmpeg-static',
    'ffprobe-static',
    // TTS-B 本地 TTS(@ss/core/voice):.node 原生二进制 webpack 嚼不动(Module parse failed),
    // 与 pg 同款问题 → 外部化;sentencepiece-js 带 wasm 一并外置
    'onnxruntime-node',
    'sentencepiece-js',
    // 桌面构建:@ss/db 外置,运行时 require desktop-pack 用 esbuild 预编译的 JS(绕开 Next 编译 Prisma client)
    ...(isDesktopBuild ? ['@ss/db'] : []),
  ],

  /**
   * 第 13 轮 audit:基础 security headers
   * - X-Frame-Options: 防 clickjacking(iframe 嵌入)
   * - X-Content-Type-Options: 防浏览器 MIME 嗅探
   * - Referrer-Policy: 跨站跳转时不泄漏完整 URL
   * - Permissions-Policy: 默认拒绝 camera/mic/geolocation 权限请求
   * CSP / HSTS 复杂度高 + 跟 Next.js 内联脚本冲突,留 Phase 2 生产部署时单独定制
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },

  /**
   * Webpack 解析配置 — 修复 Next.js 15 + ESM `.js` 扩展名导入
   *
   * 源码中写 `import x from './foo.js'` 是 NodeNext / ESM 规范写法，
   * 但 Webpack 默认按字面找 .js 文件。这里让它在解析 .js 时也尝试 .ts/.tsx，
   * 使所有 @ss/* workspace 包能在 Next.js 直接 transpile 使用。
   */
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config.resolve as any).extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    // TTS-B:onnxruntime-node 的 .node 原生绑定经 instrumentation→in-process-worker 链
    // 被 webpack 嚼(serverExternalPackages 在该编译图未生效,实测)→ 手动 externals 兜底
    // M3b(六八):ffmpeg-static/ffprobe-static 同款 — chainTailFrame 在 tRPC route 里调 extractFrame,
    // __dirname 定位的二进制路径被打进 vendor-chunks(实测 "ffmpeg 二进制不存在 .next/...")→ 一并兜底
    if (isServer) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (config.externals as any[]).push(
        'onnxruntime-node',
        'sentencepiece-js',
        'ffmpeg-static',
        'ffprobe-static',
      );
    }
    return config;
  },

  /**
   * Turbopack 配置（next dev 默认仍用 Webpack）
   *
   * ⚠️ 2026-06-14 实测:`next dev --turbopack` 当前**跑不起来**,勿切默认。
   *   instrumentation hook 加载即崩:`Module not found: Can't resolve './weights.js'`
   *   (packages/core/voice/index.ts)、`Cannot find module './timeline.js'`。
   *   根因:@ss/core 等 workspace 包用 NodeNext 风格 `.js` 扩展名相对导入(源文件实为 `.ts`)。
   *   Webpack 靠上面的 `extensionAlias: {'.js':['.ts','.tsx',...]}` 把 `.js` 重写到 `.ts`;
   *   而 Turbopack 的 `resolveExtensions` **只对无扩展名导入生效**,无 `extensionAlias` 等价能力,
   *   故所有显式 `.js` 导入解析失败。且这是 @ss/core 消费层的**全仓**问题,非单点。
   *   解锁路径(三选一,均非小改):① Turbopack 支持 extensionAlias(上游 feature,待);
   *   ② @ss/core 相对导入去掉 `.js` 扩展名;③ @ss/core 预编译成 `.js` 产物后被消费。
   *   在此之前 dev 保持 Webpack。
   */
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    resolveAlias: {},
  },
};

export default withNextIntl(nextConfig);
