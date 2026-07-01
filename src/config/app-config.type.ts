export interface AppConfig {
  app: {
    port: number;
  };
  mongo: {
    uri: string;
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
}
