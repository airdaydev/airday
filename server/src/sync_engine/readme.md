## Airday sync engine concerns
This is the to be extracted sync_engine. It is to be paired with the ../rust/sync_macros & sync_transport crate.

AnySyncObject is the common external interface. SyncAttrs<T> related methods will be the basis used for generic methods, to be procmac'd. Container & Item should be reduced to a model.rs file, with procmacros only.
