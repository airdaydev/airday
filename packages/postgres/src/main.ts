import { Workspace } from './workspace';
import { config } from './config';
import { Migration } from './migrate';
import { connectionOptsFromConfig, Pool } from './slonik';

async function main() {
  const connectionOpts = connectionOptsFromConfig(config);
  const pool = await Pool(connectionOpts);
  const migration = new Migration(pool);
  migration.add(Workspace);
  migration.run();
};

main().catch((err) => console.log(err));
