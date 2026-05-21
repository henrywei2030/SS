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
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  output: 'standalone',

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
