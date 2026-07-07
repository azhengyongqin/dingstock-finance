import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { defineConfig } from 'prisma/config';
import { parse } from 'yaml';

function readPostgresUri() {
  if (process.env.POSTGRES_URI) {
    return process.env.POSTGRES_URI;
  }

  const configFile = process.env.CONFIG_FILE ?? 'config/app.yaml';
  const configPath = isAbsolute(configFile)
    ? configFile
    : join(process.cwd(), configFile);
  const yamlConfig = parse(readFileSync(configPath, 'utf8')) as {
    postgres?: { uri?: string };
  };

  return yamlConfig.postgres?.uri ?? '';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Prisma 7 将连接串放到 config；这里复用应用 YAML，并允许环境变量覆盖。
    url: readPostgresUri(),
  },
});
