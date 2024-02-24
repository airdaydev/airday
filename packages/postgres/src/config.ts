import { loadToml, validateConfig } from 'toml-config';

const rawConfig = loadToml(import.meta.url, '../config.yaml');

interface Config {
  // SQL
  SQL_PORT: number
  SQL_HOST: string
  SQL_DB_NAME: string
  SQL_USER: string
  SQL_PASSWORD?: string
}

export const config = validateConfig<Config>({
  SQL_PORT: { type: 'number' },
  SQL_HOST: { type: 'string' },
  SQL_DB_NAME: { type: 'string' },
  SQL_USER: { type: 'string' },
  SQL_PASSWORD: { type: 'string', required: false },
}, rawConfig);
