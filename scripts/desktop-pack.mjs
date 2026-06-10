#!/usr/bin/env node
// =============================================================================
// Step D · 桌面打包资源总装(跨平台 —— 在每个目标平台各跑一次:本机 Mac / CI Win)
// 产出:
//   apps/desktop/resources/db/{seed.mjs, migrations/}     DB 引导资源
//   apps/desktop/resources/web/                           Next standalone + static + public(自包含)
//   apps/desktop/resources/runtime/                       bootstrap 脚本 + embedded-pg/pg 平铺 node_modules
//   apps/desktop/src-tauri/binaries/node-<triple>[.exe]   bundled node(tauri externalBin)
// 之后 `tauri build` 把上述 resources + externalBin 打进安装包。
//
// 前置:已 `pnpm --filter @ss/web build`(产 .next/standalone)。
// =============================================================================
import { execFileSync } from 'node:child_process';
import { build as esbuildBuild } from 'esbuild';
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps/desktop');
// 资源放 src-tauri 内 → tauri.conf 用相对 `resources/**/*`(避免 `../` 路径歧义)
const resDir = join(desktop, 'src-tauri/resources');
const log = (m) => console.log(`[pack] ${m}`);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

// 把目录树里的符号链接就地替换成其目标的【真文件副本】(深度优先)。
//   embedded-postgres 的 dylib 是指向安装目录的绝对符号链接,拷走/打包/安装后必断;
//   扁平化后整棵树无符号链接,任何后续拷贝都自包含安全。须在目标仍存在时调用。
function flattenSymlinks(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) {
      let real;
      try {
        real = realpathSync(p);
      } catch {
        continue; // 已断链,跳过
      }
      const st = statSync(real);
      rmSync(p, { force: true });
      if (st.isDirectory()) {
        cpSync(real, p, { recursive: true, dereference: true });
      } else {
        copyFileSync(real, p);
        chmodSync(p, st.mode);
      }
    } else if (e.isDirectory()) {
      flattenSymlinks(p);
    }
  }
}

// 把 .pnpm/<entry>/node_modules/ 下的【真实】包提升到 webRoot/node_modules/ 顶层(first-wins),
//   使 standalone 成 npm 式扁平、任意位置可解析。符号链接(= 别的包的依赖)跳过,各自经自己的
//   .pnpm entry 被提升一次。解决 Next standalone + pnpm 运行时一堆 Cannot find module。
function hoistPnpmFlat(webRoot) {
  const pnpmDir = join(webRoot, 'node_modules/.pnpm');
  const topNm = join(webRoot, 'node_modules');
  if (!existsSync(pnpmDir)) return 0;
  let n = 0;
  const hoistOne = (srcDir, destDir) => {
    if (existsSync(destDir)) return; // first-wins
    cpSync(srcDir, destDir, { recursive: true });
    n++;
  };
  for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nm = join(pnpmDir, entry.name, 'node_modules');
    if (!existsSync(nm)) continue;
    for (const e of readdirSync(nm, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue; // 依赖符号链接,跳过
      if (e.name.startsWith('@')) {
        const scopeDir = join(nm, e.name);
        for (const se of readdirSync(scopeDir, { withFileTypes: true })) {
          if (se.isSymbolicLink() || !se.isDirectory()) continue;
          hoistOne(join(scopeDir, se.name), join(topNm, e.name, se.name));
        }
      } else if (e.isDirectory()) {
        hoistOne(join(nm, e.name), join(topNm, e.name));
      }
    }
  }
  return n;
}

// ---- 0. 版本(与 root package.json 同步,避免漂移)----
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const EMBEDDED_PG_VER = rootPkg.devDependencies['embedded-postgres'];
const PG_VER = rootPkg.devDependencies['pg'];

// ---- 1. DB 资源(seed bundle + migrations)----
log('① DB 资源(seed bundle + migrations)');
sh(process.execPath, [join(root, 'scripts/build-desktop-resources.mjs')]);

// ---- 2. Web standalone 自包含(standalone + static + public)----
log('② Web standalone 自包含');
// 六八:桌面构建走独立 distDir(.next-desktop),与 dev server 的 .next 互不干扰
const standalone = join(root, 'apps/web/.next-desktop/standalone');
if (!existsSync(join(standalone, 'apps/web/server.js'))) {
  throw new Error('[pack] 缺 .next-desktop/standalone,请先 `SS_DESKTOP_BUILD=1 pnpm --filter @ss/web build`');
}
const webOut = join(resDir, 'web');
rmSync(webOut, { recursive: true, force: true });
cpSync(standalone, webOut, { recursive: true });
// Next standalone 不自动拷 static / public —— 必须补,否则页面无 CSS/JS
// (standalone server 按构建时 distDir 寻路 → 目标也是 .next-desktop/static)
cpSync(join(root, 'apps/web/.next-desktop/static'), join(webOut, 'apps/web/.next-desktop/static'), { recursive: true });
const pub = join(root, 'apps/web/public');
if (existsSync(pub)) cpSync(pub, join(webOut, 'apps/web/public'), { recursive: true });

// Next standalone + pnpm 通用修补:.pnpm 里的包没 hoist 到可解析层,装到 .app(无上层
//   node_modules + tauri 解引用符号链接)后,运行时 require 一堆包(styled-jsx / @swc/helpers …)
//   解析不到。把 .pnpm 里每个【真实】包提升到 web/node_modules 顶层(扁平,first-wins),
//   standalone 变成 npm 式可解析 —— 一次解决全部,不动开发环境。
const hoisted = hoistPnpmFlat(webOut);
log(`  ✓ hoist .pnpm → node_modules 顶层(扁平化 ${hoisted} 个包,修 Next standalone + pnpm 解析)`);

// serverExternalPackages 里 Next 经 subpath import 漏 trace 的包(@prisma/client 被生成的 client
//   以 `@prisma/client/runtime/client` 子路径 import,Next 在 monorepo 下没 trace 进 standalone →
//   运行时查询构建器全崩)。从仓库 .pnpm 直接定位真实包目录,补进 standalone 顶层(pg 已被 trace)。
const repoPnpm = join(root, 'node_modules/.pnpm');
const findRepoPkg = (scopePkg) => {
  const prefix = scopePkg.replace('/', '+') + '@';
  const entry = readdirSync(repoPnpm).find((d) => d.startsWith(prefix));
  return entry ? join(repoPnpm, entry, 'node_modules', scopePkg) : null;
};
// 六八:补包升级为**依赖闭包 BFS** — serverExternalPackages/webpack externals 的包
//   (prisma 系 + TTS 的 onnxruntime-node/sentencepiece-js + ffmpeg 系)全都不被 Next trace,
//   且 onnxruntime-node 还有 adm-zip/global-agent 等二级依赖,只补顶层包运行时照样崩。
//   实测六八第一版 dmg 四包全缺 → 新机 TTS/成片合成直接 "Cannot find module"。
const EXTERNAL_PKGS = [
  '@prisma/client',
  '@prisma/adapter-pg',
  // TTS-B 本地声线(onnxruntime 原生 .node + sentencepiece wasm)
  'onnxruntime-node',
  'sentencepiece-js',
  // M0 ffmpeg 封装(平台二进制,M1 成片/M3 抽帧/声线规范化都依赖)
  'ffmpeg-static',
  'ffprobe-static',
];
{
  const queue = [...EXTERNAL_PKGS];
  const seen = new Set();
  let copied = 0;
  while (queue.length > 0) {
    const pkg = queue.shift();
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const dest = join(webOut, 'node_modules', pkg);
    const src = findRepoPkg(pkg);
    if (!src || !existsSync(src)) {
      if (EXTERNAL_PKGS.includes(pkg)) log(`  ⚠ 仓库 .pnpm 未找到 ${pkg}`);
      continue;
    }
    if (!existsSync(dest)) {
      cpSync(src, dest, { recursive: true, dereference: true });
      copied += 1;
    }
    // BFS 传递依赖(只看 dependencies,dev/peer 不进运行时)
    try {
      const pj = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
      for (const dep of Object.keys(pj.dependencies ?? {})) queue.push(dep);
    } catch {
      /* 无 package.json/解析失败跳过 */
    }
  }
  log(`  ✓ 补 externals 依赖闭包 → standalone(${copied} 个包,含 prisma/onnxruntime/ffmpeg 系)`);
}

// 六八:平台裁剪 — ffprobe-static(335M)/onnxruntime-node(254M)自带全平台二进制,
//   .app 是单平台产物,只留当前平台(裁掉 ~550M raw,dmg 瘦回 ~280M)。
//   两包结构同为 <binRoot>/<platform>/<arch>/...(onnx 多一层 napi-vX)。
{
  const keepPlat = process.platform; // darwin
  const keepArch = process.arch; // arm64
  const prunePlatArch = (binRoot, label) => {
    if (!existsSync(binRoot)) return;
    for (const plat of readdirSync(binRoot)) {
      const platDir = join(binRoot, plat);
      if (plat !== keepPlat) {
        rmSync(platDir, { recursive: true, force: true });
        continue;
      }
      for (const arch of readdirSync(platDir)) {
        if (arch !== keepArch) {
          rmSync(join(platDir, arch), { recursive: true, force: true });
        }
      }
    }
    log(`  ✓ 裁剪 ${label} 至 ${keepPlat}/${keepArch}`);
  };
  prunePlatArch(join(webOut, 'node_modules/ffprobe-static/bin'), 'ffprobe-static');
  const ortBin = join(webOut, 'node_modules/onnxruntime-node/bin');
  if (existsSync(ortBin)) {
    for (const napi of readdirSync(ortBin)) {
      prunePlatArch(join(ortBin, napi), `onnxruntime-node/${napi}`);
    }
  }
}

// 预编译 @ss/db(含生成的 Prisma client)→ JS,放进 standalone node_modules/@ss/db。
//   配合 next.config 的 SS_DESKTOP_BUILD 把 @ss/db 外置 → 运行时 require 这份 esbuild 编译的 client
//   (seed 已验证能跑),绕开 Next/SWC 编译生成的 Prisma client 导致的查询构建器损坏(findFirst 空 detail)。
const dbPkgOut = join(webOut, 'node_modules/@ss/db');
rmSync(dbPkgOut, { recursive: true, force: true });
mkdirSync(dbPkgOut, { recursive: true });
const dbBanner = {
  js: "import { createRequire as __ssCr } from 'module'; const require = __ssCr(import.meta.url);",
};
for (const [entry, out] of [
  ['index.ts', 'index.mjs'],
  ['client.ts', 'client.mjs'],
  ['enums.ts', 'enums.mjs'],
]) {
  await esbuildBuild({
    entryPoints: [join(root, 'packages/db/src', entry)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: join(dbPkgOut, out),
    external: ['pg-native', 'cloudflare:sockets'],
    banner: dbBanner,
    logLevel: 'warning',
  });
}
writeFileSync(
  join(dbPkgOut, 'package.json'),
  JSON.stringify(
    {
      name: '@ss/db',
      version: '0.1.0',
      type: 'module',
      exports: { '.': './index.mjs', './client': './client.mjs', './enums': './enums.mjs' },
    },
    null,
    2,
  ),
);
log('  ✓ 预编译 @ss/db(esbuild)→ standalone(绕开 Next 编译 Prisma client)');
log('  ✓ standalone + static + public');

// ---- 3. Runtime(bootstrap 脚本 + 平铺 node_modules:embedded-pg + pg)----
// ESM 不读 NODE_PATH → 脚本与 node_modules 同级放在 runtime/,import 自然解析。
log('③ Runtime(npm install embedded-postgres + pg → 平铺 node_modules)');
const runtimeOut = join(resDir, 'runtime');
rmSync(runtimeOut, { recursive: true, force: true });
mkdirSync(runtimeOut, { recursive: true });
const tmpPrefix = join(resDir, '.npm-tmp');
rmSync(tmpPrefix, { recursive: true, force: true });
mkdirSync(tmpPrefix, { recursive: true });
writeFileSync(join(tmpPrefix, 'package.json'), JSON.stringify({ name: 'ss-desktop-runtime', private: true }));
// npm(随 node 自带)默认装 optional 平台包 + 跑 postinstall(pg 二进制 hydrate),比 pnpm 省心
sh(
  'npm',
  [
    'install',
    '--no-audit',
    '--no-fund',
    '--prefix',
    tmpPrefix,
    `embedded-postgres@${EMBEDDED_PG_VER}`,
    `pg@${PG_VER}`,
  ],
  { shell: process.platform === 'win32' }, // Windows 上 npm 是 npm.cmd,execFileSync 需 shell
);
// 先在 tmpPrefix(符号链接目标仍存在)就地扁平化,再普通拷贝 → runtimeOut 全是真文件。
flattenSymlinks(join(tmpPrefix, 'node_modules'));
cpSync(join(tmpPrefix, 'node_modules'), join(runtimeOut, 'node_modules'), { recursive: true });
rmSync(tmpPrefix, { recursive: true, force: true });
copyFileSync(join(root, 'scripts/desktop-bootstrap.mjs'), join(runtimeOut, 'desktop-bootstrap.mjs'));
copyFileSync(join(root, 'scripts/desktop-server.mjs'), join(runtimeOut, 'desktop-server.mjs'));
log('  ✓ runtime(node_modules + bootstrap 脚本)');

// ---- 4. Node 二进制(tauri externalBin,名字带 target triple)----
log('④ Node 二进制(externalBin)');
const triple = execFileSync('rustc', ['-Vv'], { shell: process.platform === 'win32' })
  .toString()
  .match(/host:\s*(\S+)/)[1];
const binDir = join(desktop, 'src-tauri/binaries');
mkdirSync(binDir, { recursive: true });
const ext = process.platform === 'win32' ? '.exe' : '';
const dest = join(binDir, `node-${triple}${ext}`);
copyFileSync(process.execPath, dest); // process.execPath = 当前 node,跨平台
chmodSync(dest, 0o755);
log(`  ✓ node-${triple}${ext}`);

log('✅ 打包资源总装完成。下一步:cd apps/desktop && pnpm exec tauri build');
