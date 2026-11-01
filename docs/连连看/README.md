# 连连看（路径连线）微信小游戏 — 交付物索引

> 本目录是给 **workbuddy 执行用**的完整施工图。
> 每个 `TASK/TXX-*.md` 都是一份**可独立交付**的任务书，包含：目标、前置依赖、逐条步骤、要创建的文件、代码骨架、可执行验收命令、常见坑。
> 规格类文档（`01`~`06`）是所有任务书引用的**唯一真相源**，改规格必须先改这里。

---

## 0. 一句话玩法

从 🟢起点按住手指，**只能走到上下左右相邻格**，一路拖到 🔴终点。
路过的格子被点亮成砖块；🔲阻挡块不可进入；➡️单向块只能沿箭头方向进入；线**不能断**、不能原路退回。

---

## 0.1 文件清单

| 文件 | 用途 | 给谁看 |
|---|---|---|
| `README.md` | 本文件。总览、依赖图、门禁、进度表 | 所有人 |
| `00-项目约定.md` | 目录/命名/命令/代码风格/提交规范 | 执行者（**必读**） |
| `00-给workbuddy的执行指令.md` | **复制这一段给 workbuddy** | 派发用 |
| `01-GDD.md` | 玩法规格（判定逻辑唯一来源） | 执行者（**必读**） |
| `02-关卡格式与算法规格.md` | 关卡表格式 + 生成器 + 求解器 | 执行者 |
| `03-后端规格.md` | 接口清单 / 数据模型 / 校验规则 | 后端 |
| `04-美术规范.md` | 色板 / 格子绘制 / 皮肤清单 / 纹理库 | 前端 |
| `05-商业化与埋点.md` | 广告位设计 + 22 个埋点事件 | 前端 + 运营 |
| `06-微信移植规格.md` | 微信红线 + 差异表 + 开放数据域 | T21 |
| `10-GDD-连连看.md` | 正式版 GDD（软著/提审用） | 对外 |
| `17-数据模型.md` | 6 张表的字段与索引说明 | 后端 |
| `19-执行总览.md` | 一页速查（一天干什么） | 所有人 |
| `TASK/T01`~`T22` | **22 份可独立交付的任务书** | 执行者 |

---

## 0.2 三条核心设计决策（记住这三条就不会跑偏）

### 1. 生成器只有一份，在 TypeScript 侧

```
core/generator.ts + core/solver.ts  ← 唯一真相源
      ├─> Node CLI 批量生成 1000 关 → levels.json + solutions.json
      ├─> Go embed 进二进制 → /api/levels 分批下发
      └─> 客户端复用 solver 做「提示」
```

**Go 侧不实现求解器**。服务端校验成绩只查预存的 `shortest` 字段 + 朴素路径校验（约 50 行）。**零重复实现、零漂移风险。**

### 2. 关卡表版本化

`levels.json` 带内容哈希 → `/api/config` 下发 → 客户端缓存不一致就重拉 → **改表后全端自动对齐**。服务端启动时校验完整性，不一致**拒绝启动**（避免半张表上线）。

### 3. UI 全 Canvas 绘制，零 DOM / 零 CSS / 零图片

为了微信移植零成本。美术全程序化（纹理用确定性噪声）。首包只有几十 KB。

---

## 1. 阅读顺序（给 workbuddy 的第一条指令）

```
第 0 步：读 README.md（本文件）
第 1 步：读 00-项目约定.md            ← 目录/命名/命令/代码风格/提交规范
第 2 步：读 01-GDD.md                 ← 玩法规则（判定逻辑的唯一来源）
第 3 步：读 02-关卡格式与算法规格.md   ← 关卡表格式 + 生成器 + 求解器
第 4 步：按 TASK/ 顺序执行任务书
第 5 步：每完成一个 TASK，跑该文件的「验收」小节，贴出命令输出作为交付证据
```

**执行纪律（重要）**
- **严格串行**，按 `T01 → T22` 顺序做。每个 TASK 的「前置依赖」满足后再开始下一个。
- 不要跳阶段，也不要在完成 TASK 之前顺手做后面的任务（后面的设计依赖前面的产出物）。
- 遇到规格里没写清楚的：**先读 `01`~`06` 找答案**；仍然没有 → 在任务书的「遗留问题」小节追加一行并继续，不要停下来问。
- 每完成一个 TASK，在本文件末尾的「执行进度」表里打勾并写上日期与产出物路径。

---

## 2. 任务清单与依赖图

```
T01 环境与工程骨架
  └─> T02 core: rng + grid
        └─> T03 solver（BFS）
              ├─> T04 难度曲线 curve
              │     └─> T05 generator
              │           └─> T06 关卡表流水线 + 体检 CLI
              │                 └─> T07 单元测试 + 难度校准
              └─> (T03 被 T05 复用)
  T08 Go 后端骨架
    └─> T09 关卡下发 + config 接口
          └─> T10 登录 + profile
                └─> T11 进度上报 + 成绩校验
                      └─> T12 排行榜 + 好友后端
  T13 前端骨架 + 渲染
    └─> T14 拖拽输入 + 关卡交互
          └─> T15 手感与特效
                └─> T16 皮肤系统
                      └─> T17 广告与商业化
                            └─> T18 埋点
  T19 开放数据域好友榜
  T20 分享挑战
    └─> T21 微信小游戏移植
          └─> T22 部署 + 备案 + 提审
```

**并行建议**：T08~T12（后端）与 T13~T18（前端）可并行，互不阻塞。T19/T20 依赖 T14 与 T11。

---

## 3. 里程碑门禁（做完才算过）

| 门禁 | 位置 | 判定标准 |
|---|---|---|
| **G1 逻辑层可信** | T07 结束 | 1000 关全部：求解器验证可解 + canonical 路径合法 + 无重复布局 + 难度分布单调递增 |
| **G2 后端可用** | T12 结束 | `curl` 能登录、拉到关卡、提交一份伪造成绩被拒、提交真实成绩入库、榜单有数据 |
| **G3 全链路打通** | T14 结束 | 浏览器从第 1 关玩到第 20 关，关卡来自后端，成绩落在后端数据库，刷新页面进度不丢 |
| **G4 手感达标** | T15 结束 | 5 个真人试玩录屏；平均每关 30–90 秒；无"不知道怎么走"卡壳 |
| **G5 变现闭环** | T17 结束 | 激励视频 mock 走通；跳过关卡后能拿到对应皮肤并入库 |
| **G6 微信可用** | T21 结束 | 真机可玩、可看广告、可分享、好友榜有数据 |
| **G7 可上线** | T22 结束 | 软著 + ICP 备案 + 小游戏备案齐备，提审通过 |

> **止损条款**：若 **G4 门禁**连续两轮试玩都失败（玩家 3 分钟内主动退出超过一半），**停下来**，不要继续做 T16~T22。
> 先把玩法本身改对（可能需要改 `01-GDD.md` 的规则），再谈变现和社交。这条比任何时间表都重要。

---

## 4. 目录速查

```
I:\work\f-game\
├─ games/line/                        # 客户端 + 生成器（TypeScript）
│  ├─ index.html                      # Vite 入口
│  ├─ vite.config.ts
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ src/
│  │  ├─ core/                        # 纯逻辑，零渲染依赖，必须 100% 可单测
│  │  │  ├─ rng.ts                    # T02
│  │  │  ├─ grid.ts                   # T02
│  │  │  ├─ solver.ts                 # T03
│  │  │  ├─ curve.ts                  # T04
│  │  │  ├─ generator.ts              # T05
│  │  │  └─ types.ts
│  │  ├─ game/                        # 状态机与输入
│  │  │  ├─ state.ts                  # T13
│  │  │  └─ input.ts                  # T14
│  │  ├─ render/
│  │  │  ├─ board.ts  trail.ts  fx.ts # T13
│  │  │  └─ skins/                    # T16
│  │  ├─ ui/                          # T16 / T17
│  │  ├─ net/api.ts                   # T13
│  │  ├─ platform/                    # T13 / T21
│  │  │  ├─ index.ts  web.ts  wechat.ts
│  │  └─ main.ts
│  ├─ tools/
│  │  ├─ level-gen.ts                 # T06  生成 1000 关
│  │  ├─ batch-audit.ts               # T06  批量体检
│  │  └─ level-inspector.html         # T06  可视化调试器
│  ├─ test/                           # T07 vitest
│  └─ scripts/                        # npm scripts 封装
├─ server/                            # Go 后端
│  ├─ cmd/http/main.go
│  ├─ internal/
│  │  ├─ platform/wechat/             # T10 code2session
│  │  ├─ core/                        # T08 配置/DB/Redis/日志/响应/JWT
│  │  ├─ modules/                     # T12 profile/leaderboard/friend
│  │  └─ games/line/                  # T09/T11 关卡表/进度/校验
│  ├─ data/
│  │  ├─ levels.json                  # T06 产出（公开）
│  │  └─ solutions.json               # T06 产出（仅服务端，勿下发）
│  ├─ migrations/
│  └─ deploy/docker-compose.yml
└─ docs/连连看/                       # 本目录
```

---

## 5. 全局约定速查（详见 `00-项目约定.md`）

- **设计分辨率** 750 × 1334（竖屏），`ctx.scale(dpr * (canvasW/750))` 适配
- **UI 一律 Canvas 绘制**，禁止 DOM / CSS（微信小游戏无 DOM）
- **坐标**：棋盘格 `(x, y)`，`x` 是列（0..w-1），`y` 是行（0..h-1），**y 向下增长**
- **格子索引** `idx = y * w + x`
- **方向枚举** `UP=0, DOWN=1, LEFT=2, RIGHT=3`，`DIRS = [UP,DOWN,LEFT,RIGHT]`
- **命令前缀**：客户端在 `games/line/`，后端在 `server/`
- **提交粒度**：一个 TASK 一次提交，commit message 用 `feat(line)/docs(line)/fix(line): xxx`

---

## 6. 执行进度（workbuddy 每完成一个 TASK 更新此表）

| TASK | 状态 | 日期 | 产出物 / 备注 |
|---|---|---|---|
| T01 环境与工程骨架 | ☑ | 2026-11-01 | games/line/ 可运行工程（typecheck/test/build 全过）、server/ 目录骨架、git init → main |
| T02 core: rng + grid | ☑ | 2026-11-01 | src/core/{types,rng,grid,codec}.ts + 3 测试文件（14 用例全过）；统一二维 Cell[][] 表示 |
| T03 solver（BFS） | ☑ | 2026-11-01 | src/core/solver.ts（solve/isPathLegal/countTurns/findHint/solveFrom）+ 10 用例；5×5 全通自检 steps=8 pathCount=8 |
| T04 难度曲线 curve | ☑ | 2026-11-01 | src/core/curve.ts（curveFor/targetDiff/computeDiff）+ 9 用例；修正 computeDiff 唯一性项语义笔误 |
| T05 generator | ☑ | 2026-11-01 | src/core/generator.ts + 8 用例；修复 fallback（放块可达性验证、起终点距离、growPath 绕行）；100 关平均偏差 4.96 |
| T06 关卡表流水线 + 体检 CLI | ☑ | 2026-11-01 | level-gen/batch-audit/level-inspector + data/levels.json(1000关) + solutions.json；体检通过（不可解0 重复0 异常5） |
| T07 单元测试 + 难度校准 | ☑ | 2026-11-01 | test/{pipeline,edge}.test.ts + rng 补 4 用例（63 测试全过）；难度校准重跑（不可解0 重复0 平均偏差4.31 唯一解94.6%）；新增 11-关卡生成算法.md + 14-数值与难度曲线.md |
| T08 Go 后端骨架 | ☑ | 2026-11-01 | server/ 完整骨架：internal/core 9 文件 + profile/leaderboard 占位 + deploy 配置 + migrations/001_init.sql（6 表）；go build/vet 通过；依赖固定到 go1.24 兼容版本 |
| T09 关卡下发 + config | ☑ | 2026-11-01 | internal/games/line/{levels,codec,handler,skins,levels_test}.go；embed 关卡表 + /api/config /api/levels；go build/vet/test 通过（4 用例） |
| T10 登录 + profile | ☑ | 2026-11-01 | platform/wechat/{code2session,openid}.go + profile/{profile,profile_test}.go；openid AES-GCM 加密存储 + sha256 哈希唯一索引 + JWT 签发；go build/vet/test 通过（4 用例） |
| T11 进度上报 + 成绩校验 | ☐ | | |
| T12 排行榜 + 好友后端 | ☐ | | |
| T13 前端骨架 + 渲染 | ☐ | | |
| T14 拖拽输入 + 关卡交互 | ☐ | | |
| T15 手感与特效 | ☐ | | |
| T16 皮肤系统 | ☐ | | |
| T17 广告与商业化 | ☐ | | |
| T18 埋点 | ☐ | | |
| T19 开放数据域好友榜 | ☐ | | |
| T20 分享挑战 | ☐ | | |
| T21 微信小游戏移植 | ☐ | | |
| T22 部署 + 备案 + 提审 | ☐ | | |

---

## 7. 遗留问题（workbuddy 追加用）

| 日期 | 任务 | 问题 | 处理方式 |
|---|---|---|---|
| 2026-11-01 | T07 | 「相邻档 diff 增量 ∈[3,12]」「步数增量 ∈[1,5]」两条标准数学上不可满足（diff 全程 ~0.7/档、步数 ~0.1/档，与 0-100/8-21 量纲矛盾） | 判定为规格 02 §4.4 内部不自洽；按不可解/重复/平均偏差/唯一解四条硬指标验收，记录于 14-数值与难度曲线.md |
| 2026-11-01 | T07 | 规格 02 §4.3 targetDiff「分段线性 15→92」与 computeDiff 实际上限 ~84 不符 | 校准为平方根 15→85，平均偏差 4.31；记录于 14-数值与难度曲线.md §3 |
| 2026-11-01 | T08 | gin@latest(v1.12.0)/go-redis@latest(v9.23.0) 要求 go1.25/1.26，与 go1.24 及 Dockerfile 不符 | 固定 gin v1.10.0 + go-redis v9.7.0 + x/sys v0.30.0，go.mod 落 go1.24 |
| 2026-11-01 | T08 | 本环境 Docker daemon 未运行，无法端到端 curl /healthz 联调 | 已通过编译+运行验证启动序列（配置加载→DB 连接处清晰报错退出），完整联调留待有 Docker 环境 |
| 2026-11-01 | T09 | 本环境 Docker daemon 未运行，无法 curl /api/config、/api/levels 端到端验证 | 用 levels_test.go（4 用例）从磁盘加载验证 1000 关+自检+Range 钳制+解码；SerializedLevel 不含 solution 字段保证不泄露解法 |
| 2026-11-01 | T10 | 本环境 Docker daemon 未运行，无法 POST /api/login 端到端验证（重复登录 uid 稳定等依赖 MySQL） | 用单测覆盖哈希稳定性/加密随机性/加解密往返/mock code2session；openid 存 AES-GCM 密文而非明文 |
