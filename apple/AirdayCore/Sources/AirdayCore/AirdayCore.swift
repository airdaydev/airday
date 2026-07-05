// Thin, hand-written convenience layer over the uniffi-generated API
// (`Generated/airday_ffi.swift`). Deliberately minimal — no abstraction
// layer yet; just the ergonomics the generated records don't provide.
//
// The generated symbols (`AirdayStore`, `ItemView`, `ListView`,
// `generateDek()`, `AirdayError`) are already `public` and re-exported
// as part of this module.

import Foundation

public extension ItemView {
    /// An item is done iff it carries a `doneAt` timestamp. `done` and
    /// `binned` are orthogonal (see spec/data-model.md).
    var isDone: Bool { doneAt != nil }

    /// An item is binned iff it carries a `binnedAt` timestamp.
    var isBinned: Bool { binnedAt != nil }
}
