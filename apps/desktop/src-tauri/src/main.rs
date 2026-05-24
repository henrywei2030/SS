// StarsAlign Studio Desktop · Tauri 2 entry
//
// Phase 1.5 实施:加 Rust 命令(本地 GPU sidecar / 文件系统 / 自动更新等)
// Phase 1 现状:纯 webview wrapper,功能 = Web 版

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
