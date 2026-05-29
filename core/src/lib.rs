//! Airday core: encryption + Loro CRDT engine + sync logic.

pub mod crypto;
pub mod doc;
pub mod events;
pub mod storage;
pub mod sync;

pub use crypto::*;
pub use doc::{
    Doc, DocError, ExportItem, ExportList, ExportSettings, ImportSummary, ItemView, JsonExport,
    ListView, SettingsView, LIST_MAIN, LIST_MAIN_NAME,
};
pub use events::AppEvent;
pub use storage::{
    BootState, ClientOpId, DocId, LocalOpRow, LocalSeq, LocalStorage, MemStorage, NoopStorage,
    OutboxRow, RemoteOpRow, ReplayRow, ServerSeq, SnapshotRow, StorageError,
};
pub use sync::{EngineOptions, Event, SyncEngine};
