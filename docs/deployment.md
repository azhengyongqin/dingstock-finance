# GitHub Actions + PM2 部署说明

## 1. 部署架构

由于 ECS 设置了 IP 白名单，GitHub Hosted Runner 无法稳定 SSH 到 ECS。本项目采用：

1. `CI` job：运行在 GitHub Hosted Runner，负责安装依赖、Prisma 校验、lint、test、build
2. `Deploy on Aliyun ECS` job：运行在 ECS 自建 GitHub Actions Runner，直接在服务器本机部署
3. `Notify Feishu` job：运行在 GitHub Hosted Runner，负责发送成功或失败通知

成功标志：GitHub Actions 页面里能看到 `CI`、`Deploy on Aliyun ECS`、`Notify Feishu` 三个 job。

## 2. GitHub Variables 和 Secrets

workflow 对以下配置的读取顺序是：先读取 `Secrets`，读取不到再读取 `Variables`。

在 `Settings -> Secrets and variables -> Actions -> Variables -> New repository variable` 中可以添加：

| Variable | 示例值 | 说明 |
| --- | --- | --- |
| `FEISHU_BOT_WEBHOOK_URL` | `https://open.feishu.cn/open-apis/bot/v2/hook/...` | 飞书机器人 Webhook，用于发送部署结果通知 |
| `APP_CONFIG_YAML` | `app:\n  port: 3000\n...` | 可选。生产环境 `config/app.production.yaml` 全文 |

成功标志：Variables 页面能看到这些名称和值。

注意：Variables 是明文可见的。`APP_CONFIG_YAML` 和 `FEISHU_BOT_WEBHOOK_URL` 如果包含密钥或 webhook，更建议放在 Secrets；只有 Secrets 没配置时才会使用 Variables。

在 `Settings -> Secrets and variables -> Actions -> Secrets -> New repository secret` 中可以添加：

| Secret | 示例值 | 说明 |
| --- | --- | --- |
| `FEISHU_BOT_WEBHOOK_URL` | `https://open.feishu.cn/open-apis/bot/v2/hook/...` | 可选。优先级高于同名 Variable |
| `APP_CONFIG_YAML` | `app:\n  port: 3000\n...` | 可选。优先级高于同名 Variable |
| `PRODUCTION_ENV` | `POSTGRES_URI=postgresql://...` | 可选。生产环境变量，每行一个 |

成功标志：Secrets 页面能看到这些名称，但看不到明文值。

可以直接参考 [config/app.production.example.yaml](../config/app.production.example.yaml)，复制全文到 `APP_CONFIG_YAML` 后替换占位符。

## 3. 在 ECS 安装自建 Runner

在 GitHub 仓库页面进入：

```text
Settings -> Actions -> Runners -> New self-hosted runner
```

选择：

```text
Linux
x64
```

GitHub 会给出一组安装命令。SSH 登录 ECS 后，建议安装到：

```bash
mkdir -p /root/actions-runner/dingstock-finance
cd /root/actions-runner/dingstock-finance
```

然后按 GitHub 页面给出的命令下载、解压、配置 runner。由于部署目录是 `/root/dingstock/dingstock-finance`，如果 runner 以 `root` 用户运行，需要先设置：

```bash
export RUNNER_ALLOW_RUNASROOT=1
```

配置时注意：

1. `runner group` 不是 runner 名字，普通仓库直接回车使用 `Default`
2. runner 名字用 `--name` 指定
3. workflow 匹配的是 label，必须包含 `dingstock-finance`

推荐使用非交互命令注册：

```bash
./config.sh \
  --url https://github.com/azhengyongqin/dingstock-finance \
  --token GitHub页面生成的新token \
  --runnergroup Default \
  --name dingstock-finance-ecs \
  --labels dingstock-finance \
  --unattended
```

关键 label：

```text
dingstock-finance
```

成功标志：GitHub 的 Runners 页面显示该 runner 状态为 `Idle`，并且 labels 包含：

```text
self-hosted
linux
dingstock-finance
```

## 4. 把 Runner 设置为开机自启

在 runner 目录执行：

```bash
cd /root/actions-runner/dingstock-finance
export RUNNER_ALLOW_RUNASROOT=1
./svc.sh install
./svc.sh start
./svc.sh status
```

成功标志：`./svc.sh status` 显示 runner 服务正在运行。

## 5. ECS 服务器准备

确认基础环境：

```bash
node -v
npm -v
rsync --version
```

如果没有 Node.js，先安装 Node.js 22 LTS 或更高版本。如果没有 `rsync`，安装：

```bash
yum install -y rsync
```

成功标志：`node -v` 能输出 `v22.x.x` 或更高版本，`rsync --version` 能正常输出版本。

部署脚本会优先使用 ECS 已安装的 pnpm；如果没有 pnpm，才会通过 `https://registry.npmmirror.com` 安装 pnpm 和 PM2，避免 ECS 访问 `registry.npmjs.org` 不稳定导致 corepack 下载失败。

## 6. 触发部署

推送到 `main` 分支会自动执行：

1. GitHub Hosted Runner 执行 CI
2. ECS 自建 Runner 拉取代码
3. 同步代码到 `/root/dingstock/dingstock-finance`
4. 安装依赖
5. 执行 Prisma migration
6. 构建 NestJS
7. 通过 PM2 重载应用
8. 发送飞书成功或失败通知

成功标志：GitHub Actions 中 `CI/CD` workflow 的三个 job 都显示绿色。

## 7. 服务器上验证

部署成功后，在 ECS 上执行：

```bash
cd /root/dingstock/dingstock-finance
pm2 status dingstock-finance
pm2 logs dingstock-finance --lines 100
systemctl is-enabled pm2-root
```

成功标志：`pm2 status` 中 `dingstock-finance` 状态为 `online`，日志中没有启动错误，`systemctl is-enabled pm2-root` 输出 `enabled`。

## 8. 配置文件优先级

PM2 默认设置 `CONFIG_FILE=config/app.production.yaml`。如果设置了 `PRODUCTION_ENV`，workflow 会在 PM2 启动前加载 `.env.production`，其中的变量可以覆盖 YAML 配置，例如：

```bash
PORT=3000
POSTGRES_URI=postgresql://user:password@host:5432/db
POSTGRES_SYNCHRONIZE=false
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
```

成功标志：修改 Secret 后重新运行 workflow，ECS 上的应用使用最新配置启动。
