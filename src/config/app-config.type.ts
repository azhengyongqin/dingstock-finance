export interface AppConfig {
  app: {
    port: number;
  };
  postgres: {
    uri: string;
    synchronize: boolean;
  };
  redis: {
    uri: string;
  };
  cmb: {
    baseUrl: string;
    uid: string;
    publicKey: string;
    privateKey: string;
    symKey: string;
    timeoutMs: number;
  };
  lark: {
    appId: string;
    appSecret: string;
    baseToken: string;
    tableId: string;
    bitableSyncEnabled: boolean;
    batchSize: number;
    accountNameMaxLength: number;
  };
}
