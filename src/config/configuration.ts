import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parse } from 'yaml';
import { AppConfig } from './app-config.type';

const DEFAULT_CONFIG_FILE = 'config/app.yaml';

export default (): AppConfig => {
  const configFile = process.env.CONFIG_FILE ?? DEFAULT_CONFIG_FILE;
  const configPath = isAbsolute(configFile)
    ? configFile
    : join(process.cwd(), configFile);
  const yamlConfig = parse(readFileSync(configPath, 'utf8')) as AppConfig;

  return {
    ...yamlConfig,
    app: {
      ...yamlConfig.app,
      // 允许部署环境通过 PORT 覆盖 YAML 中的本地默认端口。
      port: Number(process.env.PORT ?? yamlConfig.app.port),
    },
    mongo: {
      ...yamlConfig.mongo,
      // 允许 CI、生产环境或临时测试环境直接注入 MongoDB 连接串。
      uri: process.env.MONGO_URI ?? yamlConfig.mongo.uri,
    },
    redis: {
      ...yamlConfig.redis,
      // Redis 也统一使用 URI，便于本地、容器和云 Redis 使用同一种配置方式。
      uri: process.env.REDIS_URI ?? yamlConfig.redis.uri,
    },
    cmb: {
      ...yamlConfig.cmb,
      // 测试环境可通过环境变量覆盖第三方网关配置，方便 CI 与本地调试切换。
      baseUrl: process.env.CMB_BASE_URL ?? yamlConfig.cmb.baseUrl,
      uid: process.env.CMB_UID ?? yamlConfig.cmb.uid,
      privateKey: process.env.CMB_PRIVATE_KEY ?? yamlConfig.cmb.privateKey,
      publicKey: process.env.CMB_PUBLIC_KEY ?? yamlConfig.cmb.publicKey,
      symKey: process.env.CMB_SYM_KEY ?? yamlConfig.cmb.symKey,
      timeoutMs: Number(
        process.env.CMB_TIMEOUT_MS ?? yamlConfig.cmb.timeoutMs ?? 15000,
      ),
    },
    lark: {
      appId: process.env.LARK_APP_ID ?? yamlConfig.lark?.appId,
      appSecret: process.env.LARK_APP_SECRET ?? yamlConfig.lark?.appSecret,
      baseToken:
        process.env.LARK_BITABLE_BASE_TOKEN ??
        yamlConfig.lark?.baseToken ??
        'HFOwbMc0oaj2D5sHzQPcCeO7nob',
      tableId:
        process.env.LARK_BITABLE_TABLE_ID ??
        yamlConfig.lark?.tableId ??
        'tblYHrh9FhV2CO0A',
      bitableSyncEnabled:
        process.env.LARK_BITABLE_SYNC_ENABLED !== 'false' &&
        (yamlConfig.lark?.bitableSyncEnabled ?? true),
      batchSize: Number(
        process.env.LARK_BITABLE_BATCH_SIZE ??
          yamlConfig.lark?.batchSize ??
          200,
      ),
      accountNameMaxLength: Number(
        process.env.LARK_ACCOUNT_NAME_MAX_LENGTH ??
          yamlConfig.lark?.accountNameMaxLength ??
          50,
      ),
    },
  };
};
