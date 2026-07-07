module.exports = {
  apps: [
    {
      name: 'dingstock-finance',
      cwd: '/root/dingstock/dingstock-finance',
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        // 生产环境默认读取服务器上的配置文件；也可以通过 .env.production 覆盖具体变量。
        CONFIG_FILE: 'config/app.production.yaml',
      },
      error_file: '/root/dingstock/dingstock-finance/logs/pm2-error.log',
      out_file: '/root/dingstock/dingstock-finance/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
