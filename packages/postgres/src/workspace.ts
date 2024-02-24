import { DatabasePool, sql } from 'slonik';

export const Workspace = (pool: DatabasePool) => {
  const query = sql.unsafe`
  CREATE TABLE workspace (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  );`;
  return pool.query(query);
}
