## Project Overview & Architecture
This is Airday, a local-first tasks & calendar application. We are currently working on the data layer only, so we can ignore the UI components for now.

The flatbuffer definition is the source of truth for sync communication over websockets. There is also a slim HTTP api handling auth, user creation etc.

The goal of this repo is to have a community edition backed by sqlite and a SaaS edition initially backed by Postgresql.

This is a close to zero-knowledge e2ee server. Each SyncOp has an encrypted payload containing CRDTs as well as some metadata. I have a basic outline of a sync engine - mostly missing the actual E2EE implementation & further authenticity/integrity checks, as well as front-end prototypes. I am currently deciding which CRDTs to use to encode each object type & their attributes.

App domain-specific objects are materialised on the client, the type determined by their obj_kind (transparent field on db).

## Key commands
- `bun run db`: Resets the database
- `bun run fb`: Compiles flatbuffers
- `bun run test`: Runs ALL tests in the repo
- `cargo test --manifest-path ./server/Cargo.toml <TEST NAME> -- --nocapture 2>&1`: Run a particular test within server
- `bun run test-core`: Tests entire JS core, automatically resets DB & runs server with in-mem sqlite against it
- `bun run serverd`: Runs server in background, resetting DB
- `bun run jaeger`: Runs dev jaeger in background
- `bun --cwd js/core test test/sync.spec.ts`: This tests the sync engine e2e

## Important file locations and conventions
- Flatbuffer definitions: './flatbuffers/proto.fbs'
- JS Client Core: './js/core'
- Server: './server'
- Sqlite db schema: './sqlite/migrations/000_dev.sql'
- Sync tests compiled to be run in playwright: 'js/core/src/test/browser.ts'

## Dependencies and setup instructions
Everything should be setup, but all setup commands are above if required.
