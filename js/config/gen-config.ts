#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(configDir));
const templatesDir = join(configDir, "templates");

type ProfileName = "dev" | "deploy";

interface RenderFile {
  template: string;
  output: string;
}

interface Profile {
  defaultSecretsFile: string;
  files: RenderFile[];
  buildEnv: (secrets: Record<string, string>) => Record<string, string | undefined>;
}

const profiles: Record<ProfileName, Profile> = {
  dev: {
    defaultSecretsFile: ".env",
    files: [
      { template: "server.dev.toml.tpl", output: "local/server.toml" },
      { template: "process-compose.dev.yaml.tpl", output: "local/process-compose.yaml" },
    ],
    buildEnv: buildDevEnv,
  },
  deploy: {
    defaultSecretsFile: ".env",
    files: [
      { template: "Caddyfile.deploy.tpl", output: "deploy/rendered/Caddyfile" },
      { template: "server.deploy.toml.tpl", output: "deploy/rendered/server.toml" },
    ],
    buildEnv: buildDeployEnv,
  },
};

if (import.meta.main) {
  const profileArg = (Bun.argv[2] as ProfileName | undefined) ?? "dev";
  const secretsArg = Bun.argv[3];
  await run(profileArg, secretsArg);
}

export async function run(profileName: ProfileName, secretsPathArg?: string) {
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown profile: ${profileName}`);
  }

  const secretsFile = secretsPathArg
    ? resolve(process.cwd(), secretsPathArg)
    : join(configDir, profile.defaultSecretsFile);
  const secrets = await parseEnvFile(secretsFile);
  const env = profile.buildEnv(secrets);

  for (const file of profile.files) {
    const inputPath = join(templatesDir, file.template);
    const absoluteOutputPath = join(repoRoot, file.output);
    const template = await Bun.file(inputPath).text();
    const rendered = renderTemplate(template, env);
    mkdirSync(dirname(absoluteOutputPath), { recursive: true });
    await Bun.write(absoluteOutputPath, rendered);
    console.log(`generated ${file.output}`);
  }
}

function renderTemplate(
  template: string,
  env: Record<string, string | undefined>,
): string {
  let output = template;

  const ifEnvPattern = /{{-?\s*if\s+env\s+"([^"]+)"\s*}}([\s\S]*?){{-?\s*end\s*}}/g;
  for (;;) {
    const next = output.replace(ifEnvPattern, (_match, key: string, body: string) =>
      env[key] ? body : "",
    );
    if (next === output) break;
    output = next;
  }

  output = output.replace(/{{-?\s*mustEnv\s+"([^"]+)"\s*}}/g, (_match, key: string) => {
    const value = env[key];
    if (!value) {
      throw new Error(`Missing required variable: ${key}`);
    }
    return value;
  });

  output = output.replace(
    /{{-?\s*env\s+"([^"]+)"\s*}}/g,
    (_match, key: string) => env[key] || "",
  );
  return output;
}

async function parseEnvFile(path: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await Bun.file(path).text();
  } catch {
    // Missing .env is fine for dev — every key has a default in
    // buildDevEnv. Deploy validates required keys via mustEnv and will
    // throw later if anything is missing.
    return {};
  }

  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function buildDevEnv(secrets: Record<string, string>) {
  const env: Record<string, string | undefined> = { ...Bun.env, ...secrets };
  env.AIRDAY_BIND = env.AIRDAY_BIND || "127.0.0.1:8000";
  env.AIRDAY_LOG_LEVEL = env.AIRDAY_LOG_LEVEL || "info";
  env.AIRDAY_SECURE_COOKIES = env.AIRDAY_SECURE_COOKIES || "false";
  // Split bind into host/port so process-compose readiness probes can
  // target them individually.
  const colon = env.AIRDAY_BIND.lastIndexOf(":");
  if (colon < 0) throw new Error(`AIRDAY_BIND must be host:port, got ${env.AIRDAY_BIND}`);
  env.AIRDAY_HOST = env.AIRDAY_BIND.slice(0, colon);
  env.AIRDAY_PORT = env.AIRDAY_BIND.slice(colon + 1);
  // Pin the dev DB inside the gitignored `local/` dir so all dev
  // artifacts live next to each other and `bun run wipe` has a
  // hardcoded, repo-scoped target. Resolved relative to the server's
  // cwd, which is the repo root under `bun run server`.
  env.AIRDAY_DB_PATH = env.AIRDAY_DB_PATH || "local/airday.sqlite";
  return env;
}

function buildDeployEnv(secrets: Record<string, string>) {
  const env: Record<string, string | undefined> = { ...Bun.env, ...secrets };

  // Loopback only — Caddy reverse-proxies the public hostname.
  env.AIRDAY_BIND = env.AIRDAY_BIND || "127.0.0.1:8000";
  env.AIRDAY_DB_PATH = env.AIRDAY_DB_PATH || "/var/lib/airday/airday.sqlite";
  env.AIRDAY_LOG_LEVEL = env.AIRDAY_LOG_LEVEL || "info";
  env.AIRDAY_SECURE_COOKIES = env.AIRDAY_SECURE_COOKIES || "true";

  for (const key of ["AIRDAY_HOST", "CADDY_EMAIL"]) {
    if (!env[key]) throw new Error(`Missing required variable: ${key}`);
  }

  return env;
}
