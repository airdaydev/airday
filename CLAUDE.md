## Project Overview & Architecture
This is Airday, a local-first tasks & calendar application. We are currently working on the data layer only, so we can ignore the UI components for now.

The flatbuffer definition is the source of truth for sync communication over websockets. There is also a slim HTTP api handling auth, user creation etc.

The goal of this repo is to have a community edition backed by sqlite and a SaaS edition backed by Postgresql.

I am moving this repo from a CAS server to an (almost) zero-knowledge e2ee server. Each SyncOp has an encrypted payload defining a map of LWW-Registers of various registers. In this way it is forward/back-compat. Snapshots are to be created by clients in a not yet determined means.

App domain-specific objects are materialised on the client, the type determined by their obj_kind.

I will also, later, implement text CRDTs

## Key commands
- `pnpm run db`: Resets the database
- `pnpm run fb`: Compiles flatbuffers
- `pnpm run test`: Runs ALL tests in the repo
- `pnpm run test-core`: Tests entire JS core, automatically resets DB & runs server with in-mem sqlite against it
- `pnpm run serverd`: Runs server in background, resetting DB
- `pnpm run jaeger`: Runs dev jaeger in background
- `pnpm --dir js/core test test/sync.spec.ts`: This tests the sync engine e2e

## Important file locations and conventions
- Flatbuffer definitions: './flatbuffers/proto.fbs'
- JS Client Core: './js/core'
- Server: './server'
- Sqlite db schema: './sqlite/migrations/000_dev.sql'
- Sync tests compiled to be run in playwright: 'js/core/src/test/browser.ts'

## Dependencies and setup instructions
Everything is setup
