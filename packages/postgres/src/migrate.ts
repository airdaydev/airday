import { DatabasePool } from 'slonik';

type MigrationFunc = (pool: DatabasePool) => void;

export class Migration {
  runCount: 0 = 0;
  pool: DatabasePool;
  migrations: MigrationFunc[] = [];
  constructor(pool: DatabasePool) {
    this.pool = pool;    
  }
  add(func: MigrationFunc) {
    this.migrations.push(func);
  }
  async run() {
    for (let func of this.migrations) {
      await func(this.pool);
      console.log(`Ran Slonik migration ${this.runCount}`)
      this.runCount++;
    }
  }
}

