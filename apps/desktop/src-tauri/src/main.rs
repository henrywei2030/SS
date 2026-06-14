// StarsAlign Studio Desktop · Tauri 2 entry
//
// Phase 2 Step C/D:Tauri 壳 = sidecar 宿主。
//   启动时拉起 node sidecar(desktop-server.mjs:bootstrap 内嵌 pg + 跑 web),轮询 :3000
//   健康,就绪后把窗口从 splash 跳到本地 web;退出时给 sidecar 进程组发 SIGTERM →
//   desktop-server.mjs 优雅停 web + 内嵌 pg(见 ADR-35)。
//
//   dev(tauri dev,debug 构建)  : 系统 node 跑仓库源脚本 scripts/desktop-server.mjs(WEB_MODE=dev)
//   打包(tauri build,release)  : bundled node(externalBin,exe 同级)跑资源里的 runtime/desktop-server.mjs
//                                  (WEB_MODE=standalone + 资源路径 env);DB/web/runtime 走 bundle.resources。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;

/// 持有 node sidecar 子进程句柄,供退出时停止。
struct Sidecar(Mutex<Option<Child>>);

// 端口:dev 跟 `next dev -p 3000` 一致;打包用冷门端口 47900,避开常见 dev 端口(3000/5173/8080…)冲突。
const WEB_HOST: &str = "localhost";
#[cfg(debug_assertions)]
const WEB_PORT: u16 = 3000;
#[cfg(not(debug_assertions))]
const WEB_PORT: u16 = 47900;
// 用 &'static str 常量(而非 format!),兼容 eval 的 &str / Into<String> 两种签名
#[cfg(debug_assertions)]
const REDIRECT_JS: &str = "window.location.replace('http://localhost:3000')";
#[cfg(not(debug_assertions))]
const REDIRECT_JS: &str = "window.location.replace('http://localhost:47900')";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(180);

/// 数据目录下的 logs 路径(与 desktop-bootstrap.mjs getDesktopPaths 对齐)。
/// 优先 SS_DESKTOP_DATA_DIR 覆盖;否则 Windows 用 %APPDATA%\StarsAlign Studio\logs。
/// (非 Windows 无 APPDATA → None,退回通用提示;桌面打包卡屏问题聚焦 Windows。)
fn logs_dir() -> Option<std::path::PathBuf> {
    if let Ok(dir) = std::env::var("SS_DESKTOP_DATA_DIR") {
        return Some(std::path::PathBuf::from(dir).join("logs"));
    }
    let appdata = std::env::var("APPDATA").ok()?;
    Some(
        std::path::PathBuf::from(appdata)
            .join("StarsAlign Studio")
            .join("logs"),
    )
}

/// 启动失败时给 splash 的提示 JS:优先读 last-error.txt 显示真实错误(node sidecar 写),
/// 读不到再退回通用超时文案。serde_json 安全转义,避免错误文本里的引号/换行破坏 JS。
fn failure_hint_js() -> String {
    let detail = logs_dir()
        .map(|d| d.join("last-error.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.chars().take(800).collect::<String>())
        .unwrap_or_default();
    let msg = if detail.trim().is_empty() {
        "本地服务启动超时。请退出重试;若反复失败,日志见 %APPDATA%\\StarsAlign Studio\\logs\\desktop.log"
            .to_string()
    } else {
        format!(
            "启动失败:\n{}\n\n完整日志:%APPDATA%\\StarsAlign Studio\\logs\\desktop.log",
            detail.trim()
        )
    };
    let json = serde_json::to_string(&msg).unwrap_or_else(|_| "\"启动失败\"".to_string());
    format!(
        "var h=document.querySelector('.hint');if(h){{h.style.whiteSpace='pre-wrap';h.style.maxWidth='82%';h.style.fontSize='12px';h.style.lineHeight='1.5';h.textContent={};}}",
        json
    )
}

/// dev:仓库根 = 编译期 manifest 目录(.../apps/desktop/src-tauri)上溯三级。
#[cfg(debug_assertions)]
fn workspace_root() -> std::path::PathBuf {
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest.join("../../..").canonicalize().unwrap_or(manifest)
}

/// Unix 下把子进程放进独立进程组(pgid = 子进程 pid),退出时 kill(-pgid) 整组通知。
fn set_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let _ = cmd;
}

/// ★ 去掉 Windows 扩展长度前缀 \\?\ —— Tauri 的 current_exe()/resource_dir() 在 Windows 常返回带
/// 此前缀的 verbatim 路径;当脚本/参数传给 node 时,node 解析不了 \\?\ → 把 'C:' 当成一段去 lstat
/// → EISDIR → sidecar 启动即崩 → 永久卡 splash(2026-06-14 安装实测,sidecar.out.log 捕获)。
/// 这是卡 splash 的【最前置真根因】,挡在 chmod/stdio 之前,故此前一直没暴露。
fn strip_unc(p: std::path::PathBuf) -> std::path::PathBuf {
    match p.to_str() {
        Some(s) if s.starts_with(r"\\?\") => std::path::PathBuf::from(&s[4..]),
        _ => p,
    }
}

/// 拉起 node sidecar(desktop-server.mjs)。
fn spawn_sidecar(app: &tauri::AppHandle) -> std::io::Result<Child> {
    let _ = app;

    #[cfg(debug_assertions)]
    {
        // dev:系统 node 跑仓库源脚本
        let root = workspace_root();
        let mut cmd = Command::new("node");
        cmd.arg("scripts/desktop-server.mjs")
            .current_dir(&root)
            .env("SS_DESKTOP_WEB_MODE", "dev");
        set_process_group(&mut cmd);
        cmd.spawn()
    }

    #[cfg(not(debug_assertions))]
    {
        // 打包:bundled node(externalBin,exe 同级)跑资源里的 desktop-server.mjs
        let exe = std::env::current_exe()?;
        let exe_dir = exe.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::Other, "无法定位 exe 目录")
        })?;
        let node = strip_unc(exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" }));
        let res = strip_unc(
            app.path()
                .resource_dir()
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
                .join("resources"),
        );
        let mut cmd = Command::new(&node);
        cmd.arg(res.join("runtime/desktop-server.mjs"))
            .current_dir(&res)
            .env("SS_DESKTOP_PACKAGED", "1")
            .env("SS_DESKTOP_WEB_MODE", "standalone")
            .env("SS_DESKTOP_STANDALONE_DIR", res.join("web"))
            .env("SS_DESKTOP_MIGRATIONS_DIR", res.join("db/migrations"))
            .env("SS_DESKTOP_SEED_JS", res.join("db/seed.mjs"))
            .env("PORT", WEB_PORT.to_string()); // 打包态 web 端口(与 REDIRECT_JS / 健康检查一致)
        // ★ GUI(windows_subsystem="windows")无控制台 → spawn 的 node 继承的是【无效 stdio 句柄】,
        //   node 在 libuv 初始化 stdio 时就崩(还没执行任何 JS)→ 无数据目录/无日志/无 last-error,
        //   表现为永久卡 splash(2026-06-14 安装实测:手动跑好、GUI 拉起即死)。给它有效句柄:
        //   stdin=null,stdout/stderr → sidecar.out.log(治崩 + 兜底捕获 node 自身启动/崩溃输出)。
        cmd.stdin(std::process::Stdio::null());
        if let Some(dir) = logs_dir() {
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("sidecar.out.log"))
            {
                if let Ok(f2) = f.try_clone() {
                    cmd.stdout(std::process::Stdio::from(f));
                    cmd.stderr(std::process::Stdio::from(f2));
                }
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        set_process_group(&mut cmd);
        cmd.spawn()
    }
}

/// 试连 web 端口(localhost 可能解析 127.0.0.1 和/或 ::1,任一通即就绪)。
fn web_port_open() -> bool {
    if let Ok(addrs) = (WEB_HOST, WEB_PORT).to_socket_addrs() {
        for addr in addrs {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok() {
                return true;
            }
        }
    }
    false
}

/// 读 sidecar 写的启动进度(boot-progress.json:{pct,label}),供 splash 实时显示。
fn read_boot_progress() -> Option<(u64, String)> {
    let p = logs_dir()?.join("boot-progress.json");
    let s = std::fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&s).ok()?;
    let pct = v.get("pct")?.as_u64()?;
    let label = v.get("label")?.as_str()?.to_string();
    Some((pct, label))
}

/// 把进度更新成 splash 的 JS(进度条宽度 + 阶段文案)。serde_json 转义,防文案破坏 JS。
fn progress_eval_js(pct: u64, label: &str) -> String {
    let json = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        "var f=document.getElementById('bar-fill');if(f)f.style.width='{}%';var h=document.querySelector('.hint');if(h)h.textContent={};",
        pct.min(100),
        json
    )
}

/// 停止 sidecar:先给进程组发 SIGTERM(优雅停 web + 内嵌 pg),留时间后强杀兜底。
fn stop_sidecar(app: &tauri::AppHandle) {
    let Some(mut child) = app.state::<Sidecar>().0.lock().unwrap().take() else {
        return;
    };
    let pid = child.id();
    eprintln!("[desktop] 停止 sidecar(pid {pid})…");

    #[cfg(unix)]
    unsafe {
        // 负号 = 整个进程组;desktop-server.mjs 收到 SIGTERM 后优雅停 web + pg
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        // Windows 无 SIGTERM:树杀整条进程链(node + web + pg),防孤儿(pg 崩溃安全可恢复)
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }

    // 给优雅退出留时间(~3s),超时强杀兜底
    for _ in 0..20 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn main() {
    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            // 1) 拉起 node sidecar
            match spawn_sidecar(app.handle()) {
                Ok(child) => {
                    *app.state::<Sidecar>().0.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("[desktop] 拉起 sidecar 失败:{e}");
                    // sidecar 没起来 → JS 侧不会写日志,这里兜底写 last-error 供超时分支回显
                    if let Some(dir) = logs_dir() {
                        let _ = std::fs::create_dir_all(&dir);
                        let _ = std::fs::write(
                            dir.join("last-error.txt"),
                            format!(
                                "拉起 node sidecar 失败:{e}\n(通常是 bundled node.exe 缺失/损坏,或被杀软拦截)"
                            ),
                        );
                    }
                }
            }

            // 2) 后台轮询:实时把启动进度推到 splash(进度条 + 阶段文案);web 就绪→跳转;超时→回显真实错误
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let start = Instant::now();
                let mut last_key = String::new();
                loop {
                    if web_port_open() {
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.eval(REDIRECT_JS);
                        }
                        break;
                    }
                    // 进度变化才 eval(避免每 500ms 重复注入)
                    if let Some((pct, label)) = read_boot_progress() {
                        let key = format!("{pct}|{label}");
                        if key != last_key {
                            last_key = key;
                            if let Some(win) = handle.get_webview_window("main") {
                                let _ = win.eval(progress_eval_js(pct, &label).as_str());
                            }
                        }
                    }
                    if start.elapsed() > HEALTH_TIMEOUT {
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.eval(failure_hint_js().as_str());
                        }
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                stop_sidecar(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                stop_sidecar(app_handle);
            }
        });
}
