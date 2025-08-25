// build.rs
use specta::ts::{ExportConfig, export};
use std::{fs, path::PathBuf};

// Bring the types into this build script’s scope.
// If your crate is `mycrate`, do `use mycrate::ids::*;`
use crate::ids::{ItemFieldId, ListFieldId, SyncObjectType};

fn main() {
    // If build.rs can't `use crate::...`, put the types in a small shared crate,
    // or enable `build-dependencies` access with a path dep in your workspace.

    let out = PathBuf::from("bindings/ids.ts");
    fs::create_dir_all(out.parent().unwrap()).unwrap();

    let mut buf = String::new();
    let cfg = ExportConfig::default(); // TS enums by default for fieldless Rust enums
    export::<ItemFieldId>(&mut buf, cfg).unwrap();
    export::<ListFieldId>(&mut buf, cfg).unwrap();
    export::<SyncObjectType>(&mut buf, cfg).unwrap();

    // Optional: also emit a zero-runtime `const` map for ergonomic imports on the TS side.
    buf.push_str(
        r#"
// Zero-runtime const maps (handy for tree-shaking); types stay aligned with Specta output.
export const ItemFieldIdNum = { ItemText: 0 } as const;
export const ListFieldIdNum = { ListName: 256, ListDescription: 257 } as const;
export const SyncObjectTypeNum = { Item: 0, Container: 1 } as const;

export type ItemFieldIdNum = typeof ItemFieldIdNum[keyof typeof ItemFieldIdNum];
export type ListFieldIdNum = typeof ListFieldIdNum[keyof typeof ListFieldIdNum];
export type SyncObjectTypeNum = typeof SyncObjectTypeNum[keyof typeof SyncObjectTypeNum];
"#,
    );

    fs::write(out, buf).unwrap();

    println!("cargo:rerun-if-changed=src/ids.rs");
}
