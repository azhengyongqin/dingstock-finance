# GitHub Actions + PM2 部署说明

## 1. GitHub Secrets

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions -> New repository secret` 中添加：

| Secret | 示例值 | 说明 |
| --- | --- | --- |
| `ECS_HOST` | `8.137.151.95` | 阿里云 ECS 公网 IP |
| `ECS_USERNAME` | `root` | SSH 用户名 |
| `ECS_SSH_PRIVATE_KEY` | `-----BEGIN RSA PRIVATE KEY-----...` | SSH 私钥全文 |
| `ECS_SSH_PORT` | `22` | SSH 端口，不填时 workflow 默认使用 `22` |
| `FEISHU_BOT_WEBHOOK_URL` | `https://open.feishu.cn/open-apis/bot/v2/hook/...` | 飞书机器人 Webhook，用于发送部署结果通知 |
| `APP_CONFIG_YAML` | `app:\n  port: 3000\n...` | 可选。生产环境 `config/app.production.yaml` 全文 |
| `PRODUCTION_ENV` | `POSTGRES_URI=postgresql://...` | 可选。生产环境变量，每行一个 |

成功标志：Secrets 页面能看到这些名称，但看不到明文值。

可以直接参考 [config/app.production.example.yaml](../config/app.production.example.yaml)，复制全文到 `APP_CONFIG_YAML` 后替换占位符。

## 2. ECS 服务器准备

首次部署前，SSH 登录服务器并确认基础环境：

```bash
node -v
npm -v
corepack --version
```

如果没有 Node.js，先安装 Node.js 22 LTS 或更高版本。PM2 不需要提前安装，workflow 会在服务器上自动安装。

成功标志：`node -v` 能输出 `v22.x.x` 或更高版本。

## 3. 触发部署

推送到 `main` 分支会自动执行：

1. 安装依赖
2. 校验 Prisma schema
3. ESLint 检查
4. Jest 单元测试
5. NestJS 构建
6. 上传代码到 `/root/dingstock/dingstock-finance`
7. 在 ECS 上安装依赖、执行 Prisma migration、构建并通过 PM2 重载

成功标志：GitHub Actions 中 `CI/CD` workflow 的 `CI` 和 `Deploy to Aliyun ECS` 都显示绿色。

## 4. 服务器上验证

部署成功后，在 ECS 上执行：

```bash
cd /root/dingstock/dingstock-finance
pm2 status dingstock-finance
pm2 logs dingstock-finance --lines 100
```

成功标志：`pm2 status` 中 `dingstock-finance` 状态为 `online`，日志中没有启动错误。

## 5. 配置文件优先级

PM2 默认设置 `CONFIG_FILE=config/app.production.yaml`。如果设置了 `PRODUCTION_ENV`，workflow 会在 PM2 启动前加载 `.env.production`，其中的变量可以覆盖 YAML 配置，例如：

```bash
PORT=3000
POSTGRES_URI=postgresql://user:password@host:5432/db
POSTGRES_SYNCHRONIZE=false
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
```

成功标志：修改 Secret 后重新运行 workflow，ECS 上的应用使用最新配置启动。
