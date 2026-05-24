# @ss/desktop · Tauri 桌面端

> W7 收尾(2026-05-24)— 配置骨架就绪,Phase 1.5 完成 Rust toolchain setup 后即可 `pnpm tauri:dev` 真编译。

## 用途

把 Next.js 应用(`apps/web`)包装成 macOS / Windows / Linux 原生桌面应用,目标用户:
- 离线场景(高铁 / 飞机 / 内网)
- 本地 GPU 加速(直接调本机 ComfyUI / SD WebUI 而非云端)
- 数据合规(完全本地存储,不走网络)

Phase 1 Web 优先,Phase 2 桌面端 + Web 双轨。

## 快速启动(Phase 1.5 时执行)

```powershell
# 1. 装 Rust toolchain(macOS/Linux 用 rustup,Windows 用 rustup-init.exe)
# https://www.rust-lang.org/tools/install

# 2. 装系统依赖(Tauri docs)
# - Windows: Microsoft Edge WebView2(Win11 内置) + Visual Studio Build Tools
# - macOS: Xcode CLI(xcode-select --install)
# - Linux: webkit2gtk + librsvg + 等

# 3. 装 Tauri CLI
pnpm install   # 根目录,自动装 @tauri-apps/cli@2

# 4. 起 Next.js 后台
cd ../..
pnpm dev   # apps/web @ :3000

# 5. 起 Tauri dev(新终端,会启动 native 窗口加载 :3000)
pnpm worker:dev  # 后台 worker(W5.5 异步抽卡)
cd apps/desktop
pnpm tauri:dev

# 6. 生产编译
pnpm tauri:build
# 产物在 src-tauri/target/release/bundle/
#   - Windows: msi / nsis 安装包
#   - macOS: dmg / app
#   - Linux: deb / appimage
```

## 结构

```
apps/desktop/
├── package.json           # @tauri-apps/cli 依赖
├── README.md              # 本文
└── src-tauri/
    ├── Cargo.toml         # Rust 依赖(tauri 2 + serde 等)
    ├── tauri.conf.json    # Tauri 配置(指向 apps/web,窗口尺寸等)
    ├── build.rs           # Tauri build hook
    └── src/
        └── main.rs        # Rust entry(启动 webview)
```

## Phase 1.5 收尾事项

- [ ] Rust toolchain 装好 + `pnpm tauri:dev` 跑通
- [ ] Icon 生成(`pnpm tauri:icon ./icon.png`)
- [ ] 自动更新通道(GitHub Releases / 自建)
- [ ] 代码签名(macOS notarization + Windows EV 证书)
- [ ] CI/CD 跑跨平台 build(GitHub Actions matrix)
- [ ] 本地 GPU 调用(Phase 2 接 ComfyUI sidecar)

## 设计决策

- **不嵌入 Next.js dev server**:Tauri 配置指向已运行的 `:3000`(开发期)或 `apps/web` build 产物(生产期),让 Web 工程独立维护
- **不接 Tauri command(Rust API)**:Phase 1 桌面端跟 Web 功能完全等同,Phase 2 真接本地 GPU / 文件系统时再开 Rust 命令
- **跟 BullMQ worker 关系**:桌面端用户不一定起 worker(可以连远端 worker via Redis)— Phase 2 决策
