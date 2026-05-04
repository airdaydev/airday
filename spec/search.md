# Search

Sprint 1 search is a **local, client-side, plaintext index** over the already-decrypted account doc. Its first consumer is the web command palette (`cmd/ctrl+f`). The server does not participate.

## Goals

- Instant search over items and lists in the active account.
- Works offline.
- Updates incrementally from the same domain event stream that drives UI state.
- Small and simple enough to ship in sprint 1 without introducing a storage engine or external dependency.

## Non-goals

- Server-side search.
- Cross-account search.
- Full-text ranking sophistication.
- Typo-tolerant / fuzzy search.
- Substring search over arbitrary middles of words.
- Shared persisted index format across web / CLI in sprint 1.

## Placement

The search index lives on the **client**, beside the local projection of the doc.

- The server cannot read op contents or run a doc, so it cannot own search. See `spec/architecture.md`.
- The index must not live inside the palette component itself; the palette is a query/view surface, not the source of truth.
- The index should be built and maintained at the same boundary that already consumes `AppEvent`s and mirrors them into client state.

For the current web app this means:

- Build the initial index after boot, from the synthetic initial `AppEvent` burst or from the fully materialized local state.
- Apply incremental index updates from the same `AppEvent` dispatcher path used for state updates.

Future clients may implement the same contract in their own host language, or we may later move the implementation into `core/` if identical ranking behavior across clients becomes important.

## Source data

Index these doc entities:

- `Item`
- `ListMeta`

For `Item`, index:

- `text` with highest weight
- `notes` with lower weight
- current list name with lower weight, so `work` can match an item living in the Work list

For `ListMeta`, index:

- `name`

Do **not** index:

- encrypted blobs
- op payloads
- timestamps as searchable text
- ids as searchable text in sprint 1

## Indexed document shape

Implementations may choose concrete language-native containers, but the logical shape is:

```ts
type SearchIndex = {
  docsById: Map<string, SearchDoc>;
  postings: Map<string, Set<string>>;
};

type SearchDoc = {
  id: string;
  kind: "item" | "list";
  title: string;
  body: string;
  listId?: string;
  status?: "live" | "done" | "binned";
  updatedAt?: number;
  tokens: string[];
};
```

Notes:

- `docsById` is the canonical indexed representation per entity.
- `postings` is the inverted index: token -> matching doc ids.
- `tokens` must be stored on each `SearchDoc` so updates can remove stale postings before re-inserting the new token set.
- `updatedAt` is for ranking only; it is not part of tokenization.
- `status` is for ranking / filtering only; it is not part of tokenization.

## Normalization

Sprint 1 normalization rules:

- Unicode normalize (`NFKC` if available in the host)
- lowercase
- trim surrounding whitespace
- split on whitespace and punctuation
- drop empty tokens
- de-duplicate tokens within a single doc

Do not stem, lemmatize, or remove stop words in sprint 1.

Examples:

- `"Buy groceries"` -> `["buy", "groceries"]`
- `"PR #142"` -> `["pr", "142"]`
- `"Q3 roadmap"` -> `["q3", "roadmap"]`

## Query semantics

Given user input:

1. Normalize and tokenize the query.
2. Every complete query token except possibly the final token is an **exact token match**.
3. The final token is:
   - exact-match if the query ends at a token boundary, or
   - prefix-match if the user is still typing and the token is partial.

In practice, the command palette should treat the last token as prefix-match.

Example:

- Query `"buy gro"` matches `"Buy groceries"`
- Query `"pho"` matches `"Read Phoenix spec"`
- Query `"off"` does not need to match `"team offsite"` by arbitrary substring; it matches because `offsite` has the prefix `off`

Document inclusion rule:

- A result must satisfy every query token.
- Multi-token queries use AND semantics, not OR semantics.

## Ranking

Sprint 1 ranking is heuristic and local. Keep it deterministic and simple.

Suggested precedence:

1. Exact title/name token hits
2. Prefix title/name hits
3. Notes hits
4. List-name context hits on items
5. `live` items before `done`, `done` before `binned`
6. More recently updated items before older items
7. Stable tie-breaker by id

This is intentionally not BM25/Tf-Idf territory. The corpus is small and the UX target is command-palette relevance, not document retrieval science.

## Update model

The index must be maintained incrementally from domain events.

Required behaviors by event kind:

- `ItemAdded`: build a new indexed doc and insert postings
- `ItemRemoved`: remove doc and its postings
- `ItemTextChanged`: rebuild that item's token set
- `ItemNotesChanged`: rebuild that item's token set
- `ItemStatusChanged`: update rank/filter metadata only
- `ItemListChanged`: rebuild that item's token set because list-name context may have changed
- `ListAdded`: add the list doc
- `ListRemoved`: remove the list doc; rebuild any item docs that referenced that list name as context
- `ListRenamed`: rebuild the list doc; rebuild any item docs whose `listId` references that list
- `ItemMoved` / `ListMoved`: no token change; ordering changes are irrelevant to the index

Implementations may do targeted updates or opportunistic small rebuilds, but they must preserve correctness.

## Build timing

The initial build point is:

- after the local doc is loaded and materialized in memory
- before the palette begins querying

Do not lazily build the index on first palette open. That couples search latency to a UI interaction and guarantees a first-open hitch.

Do not rebuild the entire index after every mutation. The event stream already gives the minimal invalidation surface.

## Persistence

Sprint 1 default: **do not persist a separate search index**.

Reasons:

- the local doc is already persisted
- corpus size is small
- index rebuild on startup is acceptable at sprint-1 scale
- avoiding a second local artifact keeps migration / invalidation logic out of scope

If startup cost later becomes measurable, a client may add a persisted sidecar index. If so:

- it is strictly a cache derived from the doc
- it must be safe to delete at any time
- stale or failed loads must fall back to full local rebuild

## Security / privacy

The index contains plaintext derived from decrypted local state.

- It must never be sent to the server.
- It must never be included in protocol messages.
- Browser implementations should treat it as in-memory only unless a later spec explicitly allows persisted search caches.

This is not a new trust boundary; any client capable of rendering the decrypted doc already holds the same plaintext in memory.

## Performance envelope

Sprint 1 data limits from `spec/data-model.md` are small enough for an in-memory inverted index.

Acceptable characteristics:

- initial build proportional to number of local items + lists
- per-event update proportional to tokens touched by that event
- query latency roughly proportional to query tokens plus candidate set size

Do not introduce heavyweight search libraries unless measurement proves the simple index insufficient.

Trees are optional future optimizations:

- trie / radix tree for faster prefix token lookup
- fuzzy index structures if typo tolerance becomes a product requirement

Start with `Map`/`Set`-style inverted index structures first.

## Client contract

The palette/query surface should consume a narrow interface, e.g.:

```ts
type SearchResult = {
  id: string;
  kind: "item" | "list";
  title: string;
  body?: string;
  listId?: string;
  status?: "live" | "done" | "binned";
  score: number;
};

interface SearchEngine {
  rebuild(state: WorkspaceState): void;
  apply(event: AppEvent): void;
  query(input: string, limit?: number): SearchResult[];
}
```

The exact API may differ by client, but the separation is load-bearing:

- mutation/update path is distinct from query path
- palette UI depends on `query(...)`, not on the index internals

## Testing

Minimum test coverage for sprint 1:

1. tokenization / normalization examples
2. add -> query returns result
3. text edit removes stale tokens and adds new ones
4. notes edit affects matches at lower rank than title matches
5. list rename updates both the list result and item context matches
6. delete removes result from queries
7. multi-token AND queries
8. last-token prefix queries
9. ranking preference: live over done over binned when textual match is otherwise equal

Where feasible, use the same event stream the app uses rather than bespoke test-only mutation paths.

## Open questions

- Whether item `notes` should appear in the palette result preview in sprint 1, or only participate in matching.
- Whether built-in list labels should be indexed by their rendered names even when one is not represented as a normal `ListMeta` row.
- Whether CLI should expose `airday find <query>` in sprint 1 or defer search to the web UI first.
