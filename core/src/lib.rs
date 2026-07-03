//! Airday core: encryption + Loro CRDT engine + sync logic.

pub mod crypto;
pub mod doc;
pub mod events;
pub mod storage;
pub mod sync;

pub use crypto::*;
pub use doc::{
    Doc, DocError, ExportItem, ExportList, ExportSettings, ImportSummary, ItemView, JsonExport,
    LIST_MAIN, LIST_MAIN_NAME, ListView, SettingsView,
};
pub use events::AppEvent;
pub use storage::{
    BootState, ClientOpId, DocId, LocalOpRow, LocalSeq, LocalStorage, MemStorage, OutboxRow,
    RemoteOpRow, ReplayRow, ServerSeq, SnapshotCutoff, SnapshotRow, StorageError,
};
pub use sync::{EngineOptions, Event, SyncEngine};
