# 凭据与配置名字清单

凭据只放服务器 env 文件（权限 600，仓库外），不放进 Git、镜像、参数、状态或日志。本表只列变量名和用途，不含值；连接串特殊字符须 URL 编码。核心 env_file 会包含服务器配置，但只有最小应用连接串用于业务访问；管理连接只在维护入口使用。

| 变量名 | 用途 |
| --- | --- |
| `PG_ADMIN_PASSWORD` | Compose 新建 PG 管理账号口令，已有卷须按数据库原流程同步轮换 |
| `DATABASE_ADMIN_URL` | 管理工具迁移、账号授权与消费者租约核查连接串 |
| `APP_DB_PASSWORD` | 幂等创建或更新应用账号口令 |
| `READONLY_DB_PASSWORD` | 幂等创建或更新只读账号口令 |
| `APP_DATABASE_URL` | Compose 核心最小权限应用连接串，须与应用口令一致 |
| `READONLY_DATABASE_URL` | 只读账号连接串，供独立权限验收；生产常驻核心不使用 |
| `FRONT_CLAW_DATABASE_URL` | 核心内部应用连接串，由 Compose 从 APP_DATABASE_URL 映射 |
| `FRONT_DOT_CHANNEL` | 生产 Compose 固定选择企微，独立离线配置固定选择离线 |
| `FRONT_CLAW_WECOM_BOT_ID` | 生产长连接读取的机器人标识 |
| `FRONT_CLAW_WECOM_BOT_SECRET` | 生产长连接读取的机器人凭据 |
| `FC_MODEL_MODE` | 原模型配置模式，默认安全桩，真实模式须单独授权 |
| `FC_MODEL_TIMEOUT_MS` | 原模型调用超时预算，与请求剩余截止取较小值 |
| `FC_MODEL_ENDPOINT` | 原模型分类 HTTP 服务地址，真实模式下才调用 |
| `FC_MODEL_CONFIG` | 原模型 JSON 配置文件路径，可设置 apiKeyEnv 与 model；容器路径需经授权只读挂载 |
| `FRONT_CLAW_OPENDOT_CAPABILITIES` | 可选平台能力收窄列表，不能授予原身份额外权限 |
| `FRONT_CLAW_MEM0` | 沿用关闭约束，试图开启会拒绝启动 |
| `FRONT_DOT_PORT` | 可选容器内健康检查端口，修改时须同步 Compose 健康检查；生产始终绑定回环 |
| `ENV_FILE` | 操作 shell 指定的仓库外服务器 env 文件绝对路径 |
| `DEPLOY_DIR` | 操作 shell 指定的状态目录，默认通用部署目录 |
| `FRONT_DOT_SHA` | 镜像完整 SHA，由部署脚本从 Git 取得并覆盖旧值 |
| `SSH_ALLOW_CIDRS` | 操作 shell 提供的 SSH 网段列表，云规则生成与主机规则使用同一列表 |
| `BACKUP_DIR` | 操作 shell 指定的仓库外备份目录 |
| `BACKUP_RETENTION_DAYS` | 备份保留天数，缺省十四天 |
| `BACKUP_FILE` | 恢复归档路径 |
| `RESTORE_DB` | 新建恢复库名字 |

模型没有固定的密钥变量名：沿用配置里的 apiKeyEnv，值为服务器 env 文件中实际密钥变量的名字；仅真实模式读取该变量，不打印名字对应的值。不要声明一个代码不读取的通用密钥名。未指定模型配置时默认安全桩。离线 e2e 不读取企微、模型配置文件或密钥。

ENV_FILE、DEPLOY_DIR、SSH_ALLOW_CIDRS 与备份控制变量由运维操作 shell 显式提供；脚本不 source 服务器 env 文件，不要假定文件里的 shell 控制变量会自动导出。Compose 只静默展开服务需要的变量。不要把 env 文件或展开配置复制进仓库；备份也须保存在受保护的外部目录。
