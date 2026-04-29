 2. status.pending_changes is a bool, not a count. Walking Loro VV diff for an exact
  count is sprint-2 polish.
  3. Snapshot orchestration not implemented. Wire types exist
  (PushSnapshot/PullSnapshot/SnapshotRequest/Snapshot); WS handler ignores them with a
  warning. Server-side compaction is gated on this.
