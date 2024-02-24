import { createPool } from 'slonik';

interface ConnectionConfig {
  host: string;
  database: string;
  user: string;
  password: string;
}

export const connectionOptsFromConfig = (birdiConfig: Record<string, any>): ConnectionConfig => ({
  host: birdiConfig.SQL_HOST,
  database: birdiConfig.SQL_DB_NAME,
  user: birdiConfig.SQL_USER,
  password: birdiConfig.SQL_PASSWORD,
});

export const buildConnectionString = (config: ConnectionConfig) =>
  `postgresql://${config.user}:${config.password}@${config.host}/${config.database}`;

export const Pool = (config: ConnectionConfig) => {
  const connectionString = buildConnectionString(config);
  return createPool(connectionString);
};
