import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@ss/api',
    '@ss/core',
    '@ss/db',
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
   * 服务端外部包 — 不进 webpack bundle,运行时从 node_modules require。
   * 桌面化:instrumentation 拉入 @ss/core/video-generation → @ss/db(pg)→ pg 可选原生 `pg-native`
   *   解析失败致 500。这些都是服务端 Node 包(含原生/动态 require),本就该外部化;
   *   对默认档同样正确(standalone build 会 trace 进产物 node_modules)。
   */
  serverExternalPackages: ['pg', '@prisma/client', '@prisma/adapter-pg', 'bullmq', 'ioredis'],

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
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config.resolve as any).extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },

  /**
   * Turbopack 等价配置（next dev 默认使用 Webpack；如未来切 turbo 也兼容）
   */
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    resolveAlias: {},
  },
};

export default withNextIntl(nextConfig);
