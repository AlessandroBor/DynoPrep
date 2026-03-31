use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Emitter;
// DynoPrep v1.0.0

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let file_menu = SubmenuBuilder::new(app, "File")
                .text("open", "Open CSV\tCtrl+O")
                .text("close_file", "Close File\tCtrl+W")
                .separator()
                .text("export", "Export CSV\tCtrl+S")
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .text("tab_data", "Data Tab\tCtrl+1")
                .text("tab_throttle", "Throttle Tab\tCtrl+2")
                .separator()
                .text("zoom_reset", "Reset Zoom\tCtrl+0")
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("about", "About DynoPrep")
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "open" => { let _ = app_handle.emit("menu-action", "open"); }
                    "close_file" => { let _ = app_handle.emit("menu-action", "close"); }
                    "export" => { let _ = app_handle.emit("menu-action", "export"); }
                    "tab_data" => { let _ = app_handle.emit("menu-action", "tab-data"); }
                    "tab_throttle" => { let _ = app_handle.emit("menu-action", "tab-throttle"); }
                    "zoom_reset" => { let _ = app_handle.emit("menu-action", "zoom-reset"); }
                    "about" => { let _ = app_handle.emit("menu-action", "about"); }
                    _ => {}
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
