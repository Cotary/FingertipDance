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
| `21-大厅与导航规格.md` | 大厅外壳 5 页面 + 底部导航（T23 唯一真相源） | 前端 |
| `22-UI设计系统.md` | 糖果夜空设计系统（**已整体废弃，仅作历史记录**） | 历史 |
| `23-UI风格方案.md` | **UI 风格选型与「黏土工坊」规格（现行 UI 唯一真相源，8/8 屏已完成）**：三套方向对比 / 黏土原语 / 色板 / 落地范围 / 踩坑修复表 | 前端（**必读**） |
| `风格样片/` | 三套风格样片 + `_横评.html` 横评页 | 决策留档 |
| `TASK/T01`~`T23` | **23 份可独立交付的任务书** | 执行者 |

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
  T23 大厅外壳 + 底部导航（主页/地图/排行/我的）
```

**并行建议**：T08~T12（后端）与 T13~T18（前端）可并行，互不阻塞。T19/T20 依赖 T14 与 T11。

> **T23 是补齐任务**：T01–T22 的规格文档从头到尾没有描述大厅/主页/底部导航，
> 首版实现因此是「启动直接进关卡」的裸游戏循环。T23 依据用户提供的参考截图
> （`I:\work\f-game\连连看` 下 6 张）补齐 App 外壳，**不改 T01–T22 的任何既有结论**。

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
| T11 进度上报 + 成绩校验 | ☑ | 2026-11-01 | internal/games/line/{validate,progress,challenge,skip,validate_test}.go + 路由接入；防作弊校验（路径/步数/用时）+ 交叉验证 TS 解法通过 Go 校验；go build/vet/test 通过 |
| T12 排行榜 + 好友 | ☑ | 2026-11-01 | modules/{leaderboard/leaderboard,leaderboard_test,friend/friend}.go + 路由接入 + progress 更新榜单 + 每日重建 goroutine；go build/vet/test 通过 |
| T13 前端骨架 + 渲染 | ☑ | 2026-11-01 | platform/{index,types,web,wechat}.ts + render/{layout,board,trail}.ts + net/api.ts + game/state.ts + main.ts + test/layout.test.ts；Canvas 渲染 + 平台适配；typecheck/test(67)/build 全过 |
| T14 拖拽输入 + 关卡交互 | ☑ | 2026-11-01 | game/{session,progressStore}.ts + ui/hud.ts + main.ts 全链路 + test/session.test.ts（3 用例）；Session 事件驱动拖拽/断线/通关；typecheck/test(70)/build 全过 |
| T15 手感与特效 | ☑ | 2026-11-01 | render/{fx,audio}.ts + game/anim.ts + ui/skins.ts（接口）+ main.ts 接入粒子/音效/通关波次 + 13-手感与反馈规范.md；typecheck/test(70)/build 全过 |
| T16 皮肤系统 | ☑ | 2026-11-01 | render/skins/{textures,index}.ts（16 皮肤 + 9 纹理）+ ui/skins.ts（皮肤页）+ board.ts 改皮肤渲染 + main.ts 接入 + test/skins.test.ts(8 用例) + 15-美术规范.md + tools/skins-preview.html；typecheck/test(78)/build 全过 |
| T17 广告与商业化 | ☑ | 2026-11-01 | src/ads/{ads,rewardRules}.ts + main.ts 接入激励视频/插屏频控/Banner + test/ads.test.ts(5 用例) + 16-商业化与埋点.md；typecheck/test(83)/build 全过 |
| T18 埋点 | ☑ | 2026-11-01 | src/analytics/tracker.ts（本地缓冲+批量上报+断网补传）+ net/api.reportEvent 改走 tracker + main.ts 初始化+补齐埋点 + server/tools/analyze/main.go（4 漏斗）+ 16-商业化与埋点.md 数据看板章节；typecheck/test(83)/build + go build/vet 全过 |
| T19 开放数据域好友榜 | ☑ | 2026-11-01 | platform/openData.ts（publishProfile/computeRankScore）+ ui/friends.ts（好友页+统计面板）+ line-wx/openDataContext/index.js + main.ts 接入 + test/friends.test.ts(4 用例)；typecheck/test(87)/build 全过 |
| T20 分享挑战 | ☑ | 2026-11-01 | game/challenge.ts（parseChallenge/buildShareQuery）+ net/api reportChallenge + ui/share.ts（renderPoster 平台分支/shareCopy）+ main.ts 挑战模式接入 + test/challenge.test.ts(2 用例) + 18-社交裂变设计.md；typecheck/test(89)/build 全过 |
| T21 微信小游戏移植 | ☑ | 2026-11-01 | line-wx/ 工程脚手架（game.js/game.json/project.config.json）+ vite 多环境构建 + scripts/copy-wx-assets.mjs + main.ts 微信触摸/onHide/onShow 分支 + 后端 GET /api/profile；build:wx 产出 game.js(39KB)；typecheck/test(89)/build + go build/vet 全过（真机验证留待外部条件） |
| T22 部署 + 备案 + 提审 | ☑ | 2026-11-01 | deploy/{config.prod.yaml,nginx.prod.conf,docker-compose.prod.yml,backup-mysql.sh} + 20-软著说明书骨架.md；外部流程（备案/软著/服务器/提审）留待人工 |
| T23 大厅外壳 + 底部导航 | ☑ | 2026-11-01 | 新增 `ui/{theme,nav,home,mapview,leaderboard,profile}.ts`（双主题 + 5 Tab 导航 + 主页大厅/关卡地图/排行榜总榜+好友榜/我的页）+ `ui/friends.ts` 拆出可复用 `drawFriendsBoard` + `ui/hud.ts` 结算页加「返回大厅」（面板 560→660）+ `main.ts` phase 5→8 值状态机改造 + 后端 `GET /api/progress/stars`（stars.go，与客户端 starOf 双端一致）；typecheck/test(111，19 文件)/build + go build/vet/test 全过；`/api/progress` 返回已含 `stars`/`totalSteps` |

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
| 2026-11-01 | T11 | 本环境 Docker daemon 未运行，无法执行 §11.7 的 7 项防作弊手动验证 | 用单测覆盖路径校验 4 种拒绝场景 + 交叉验证（TS 解法跑 Go ValidatePath 抽检 100 关），其余留待有 Docker 环境 |
| 2026-11-01 | T12 | 本环境 Docker daemon 未运行，无法验证好友链路与榜单更新（G2 门禁全链路依赖 MySQL+Redis） | 用 TestComputeScore 覆盖分数换算；后端 16 测试全过、build/vet 通过，端到端 curl 留待有 Docker 环境补做 |
| 2026-11-01 | T13 | 本环境后端未启动，无法可视化验证「拖动连线通关」 | typecheck/test(67)/build 全过，dev server 能启动并正确转译；完整可视化验证需后端就绪 |
| 2026-11-01 | T14 | 本环境后端未启动，无法执行 G3 门禁「浏览器从第 1 关玩到第 20 关、成绩落库、刷新不丢」 | typecheck/test(70)/build 全过 + Session 单测覆盖拖拽/断线/通关；端到端 G3 验证留待有 Docker/后端环境补做 |
| 2026-11-01 | T15 | G4 门禁「5 人真人试玩录屏 + 单关 30–90s + 首关通过率 ≥95%」需真人试玩，无法在本环境自动完成 | 特效/音效/缓动已实现并通过 typecheck/test/build；真人试玩留待有可运行后端的环境由人工补做 |
| 2026-11-01 | T16 | 本环境后端未启动，无法可视化验证「结算页点皮肤→装备→砖块纹理改变」 | typecheck/test(78)/build 全过 + skins.test.ts 8 用例覆盖清单/解锁方式/调色板；皮肤页交互留待有后端环境浏览器验证 |
| 2026-11-01 | T17 | G5 门禁「激励视频 mock 走通 + 跳过通关拿皮肤入库」依赖后端数据库（skin 入库需 MySQL），本环境 Docker 未启动 | 广告管理器 + 奖励规则 + 前端接入 + ads.test.ts 5 用例全过（mock 广告 3s 倒计时走通）；端到端变现闭环留待有 Docker 环境补做 |
| 2026-11-01 | T18 | 本环境无 MySQL，无法 `go run ./tools/analyze` 实跑打印四张漏斗表 | 分析脚本 go build/vet 通过；tracker 单测覆盖埋点规则；实际跑数留待有 MySQL 环境 |
| 2026-11-01 | T19 | 微信开放数据域需真机 + 两个互关微信号才能端到端验证好友榜 | openData 主域侧 + 开放数据域 index.js + 好友页 + computeRankScore 单测全过；真机好友榜留待 T21 微信移植后验证 |
| 2026-11-01 | T20 | 挑战模式端到端需后端 `/api/challenge` + MySQL（scores 表），本环境 Docker 未启动 | parseChallenge/buildShareQuery/renderPoster/挑战结算前端全通 + challenge.test.ts 2 用例；数据库落库留待有 Docker 环境补做 |
| 2026-11-01 | T21 | G6 门禁需外部条件：微信开发者工具、AppID、ICP 备案域名 + HTTPS、广告位 ID（本环境均无） | 代码侧全部完成：工程脚手架 + 多环境构建（build:wx 产出 game.js 39KB）+ 微信触摸/onHide/onShow 分支 + GET /api/profile；真机验证留待外部条件齐备后人工完成 |
| 2026-11-01 | T22 | G7 门禁依赖外部流程：域名 ICP 备案（1–3 周）、软著（10–17 天）、服务器购买、微信提审，本环境均无法完成 | 生产部署模板（config.prod/nginx.prod/docker-compose.prod/backup）+ 软著说明书骨架已就绪；实际备案/软著/部署/提审留待人工启动 |
| 2026-11-01 | 全局 | 数据库按用户要求由 MySQL 迁到 **PostgreSQL**：`server/` 全部 SQL 改为 `$n` 占位符 / `ON CONFLICT` / `jsonb` / `BIGSERIAL`，驱动换 pgx v5，`backup-mysql.sh` → `backup-pg.sh`。T22 行里提到的 `backup-mysql.sh` 文件名已过时 | 复用现有 `mcp-test-pg`（postgres:16-alpine，端口 15432）+ 新起 `fgame-redis`；pgx 固定 v5.7.2（v5.12 要求 go1.25，本机 go1.24.1）；所有 go 命令统一加 `GOTOOLCHAIN=local` 防 go.mod 被自动升级。迁移后 login/progress/leaderboard/skip/report/friends/analyze 端到端 curl 全通 |
| 2026-11-01 | 全局 | `users.openid` 原为 `VARCHAR(64)`，AES-GCM + base64 后密文超长。MySQL 非严格模式静默截断未暴露，PG 严格模式直接报 `SQLSTATE 22001` | 列宽改 `VARCHAR(256)` 并 DROP 重建表（`CREATE TABLE IF NOT EXISTS` 不会修改已存在表的结构，只改迁移文件不生效） |
| 2026-11-01 | T23 | 本环境无浏览器（playwright / puppeteer 均未安装），无法截图做 Canvas 视觉验收 | 自建 `fakeCtx()` Proxy 桩（所有绘图方法 no-op + 记录调用）+ `test/lobby-smoke.test.ts` 8 用例，在 Node 里跑主页/导航/地图/排行/我的/皮肤/结算 7 个页面的**真实绘制代码**抓运行时错误；像素级视觉回归留待人工在浏览器确认 |
| 2026-11-01 | T23 | 地图页 1000 关靠 `visibleRange` 虚拟滚动只渲染可视区，但单测只能验算区间 | `mapview.test.ts` 6 用例锁定（x 在设计宽度内 / y 线性递增 / 视区随滚动平移 / 不越界 / 点击选中关号 / `scrollToLevel` 合法区间）；真实帧率需浏览器 Performance 面板或真机 |
| 2026-11-01 | T23 | 星级阈值（≤1.15 三星、≤1.5 二星、其余一星）双端各有一份实现，天然存在漂移风险 | `test/stars.test.ts`（3 用例）+ `stars_test.go`（5 用例）两端锁死同一组边界值，任一侧改动都会红 |
| 2026-11-01 | T23 | 任务书 §7.1、§11.9 两处故意留白需自行判断实现 | §7.1：把 `drawFriendsPage` 拆出 `drawFriendsBoard(ctx, st, topY, height)` 供排行榜好友 Tab 复用；§11.9：结算页加「返回大厅」按钮并把 `drawResult` 面板高度 560→660 腾位 |
| 2026-11-01 | UI 改版 | **原「双主题」是风格不一致的根源**：大厅亮色 `#EEF3FF` + 游戏内深色 `#141824`，两套都是扁平风，切页像换了个产品 | 废弃双主题，统一为「糖果夜空 / Candy Night」单色板。`GAME_THEME`/`LOBBY_THEME` 降级为 `THEME` 的别名（16 处 import 零改动即自动统一）；背景收口到 `main.ts` 的 `frame()` 一处绘制 |
| 2026-11-01 | UI 改版 | 各页面各自 `fillRect` / 各写死颜色圆角，改一处颜色要翻 7 个文件 | 建两层：`ui/theme.ts`（token 唯一真相源：CANDY 四层色轮 `base/light/dark/glow` + `R`/`SP`/`W`）+ `ui/draw.ts`（绘制原语 `nightSky`/`jelly`/`glass`/`pill`/`strokeText`/`starRow`），页面禁止写死数值。规格见 `22-UI设计系统.md` |
| 2026-11-01 | UI 改版 | **真 bug**：主页卫星节点 6 个里 3 个完全重合（截图只看到 3 个，金色节点底下压着小绿勾） | `ang = o.phase + (slot / ORBITS.length) * 2π` 在 `slot=3,4,5` 时 `slot/3=1`，`+2π` 与 `slot=0,1,2` 同角。修为 `lap = Math.floor(slot / ORBITS.length); ang = o.phase + lap * Math.PI`（每轨 2 个、相隔半圈） |
| 2026-11-01 | UI 改版 | **真 bug**：结算页进度条同时压住「解锁皮肤」胶囊和「下一关」按钮 | 进度条整体上移到三星正下方，纵向节奏重排为 标题 `+58` → 三星 `+146` → 进度文字 `+204` → 细条 `+220(420×12)` → 数据胶囊 `+240` → 解锁胶囊 `+332` → 按钮 `+400/+500/+570` |
| 2026-11-01 | UI 改版 | 本环境此前判定「无浏览器」，Canvas 视觉只能靠 no-op 桩跑通、看不出好不好看 | 本机实际有 Chrome/Edge：`chrome --headless=new --screenshot --window-size=750,1334 file://...`。另自建 `tools/canvas2svg.ts`（把**真实绘制代码**转录为 SVG，变换烘焙进几何、`arcTo` 求切点、arc 折线采样）+ `tools/ui-gallery.ts`，`npm run ui:gallery` 出 7 屏总览、`npm run ui:gallery -- 主页` 出单屏 1:1。**已知工具差异**：不支持 `shadowBlur`（产品代码本就不用）、不支持 `drawImage`（好友榜开放数据域走兜底分支） |
| 2026-11-01 | UI 改版 | 描边文字在离线 SVG 预览里居中、真机偏下贴胶囊下沿 | 根因是 Canvas `textBaseline='middle'` 与 SVG `central` 视觉位置不同。`strokeText` 内部固定 `alphabetic` 并手动补偿 `dy`（middle → `0.36em`），浏览器实测与预览完全对齐 |
| 2026-11-01 | UI 改版 | **真 bug**：起点「起」终点「终」糊成一团墨块。先后把字号从 `0.80r` 收到 `0.62r`、描边从 `0.20r` 收到 `0.09r`，**都没解决** | 真因不是字号：连线从格心出发，`drawTrail()` 在 `drawBoard()` 之后执行，**线头横穿圆片把字压在了下面**。改为 `drawBoard` 只铺底板、新增 `drawEndpoints()` 在连线之后叠画圆片；同时改深色实心字（不描边）、高光从圆片中部上移到上缘（中部高光会把字上半截洗白） |
| 2026-11-01 | UI 改版 | 棋盘未点亮格几乎不可见（`0.085` 白 + 底板 `0.62`），玩家看不清格子在哪儿；两处进度条轨道比底色还暗，等于隐形 | 未点亮格提到 `0.13` + `0.22` 边光、底板提到 `0.80`；进度条轨道改 `rgba(255,255,255,0.13)`，并在填充末端加白色进度头（37/1000 时填充只有十几像素，没珠子就只剩个看不清的点） |
| 2026-11-01 | UI 改版 | 用户反馈「糖果夜空」不够好看。诊断：深紫渐变 + 40 处同一个果冻材质 + 发光泛滥 + 只有圆角和圆形两种造型 + 7 色平均铺开 + 零质感，是标准的 AI 通用审美 | 出 `23-UI风格方案.md`：三套换材质语言的方向（剪纸 / 油印 / 黏土）+ 样片 + Canvas 落地度评估。用户选定 **C 黏土工坊**（明亮浅底），先做 2 屏 |
| 2026-11-01 | UI 改版 | **黏土质感在 Canvas 里怎么实现**：样片靠指纹纹理与棚拍柔光，原判断只能还原 60% | 不做贴图，改用四种纯 Canvas 手法：① 硬边色阶做体积（2~3 个同心不规则色块，边界硬）② 固定 seed 的半径抖动做手捏轮廓（每帧一致不闪）③ 三层同形错位叠出软投影（不用 `shadowBlur`）④ 大面积低 alpha 柔光代替高光条。实测还原度约 78%，唯一没做到的是指纹颗粒 |
| 2026-11-01 | UI 改版 | 浅底暴露两处布局问题：棋盘下方 292px 空白、主页玩家条到球之间有 226px 空 | `BOARD_TOP 220→200` / `BOARD_BOTTOM 1000→1176` 按「HUD 底 → 进度条顶」重新居中；主页星球 `(375,540) r170 → (375,486) r178`；游戏内进度条 `y 1042→1196` |
| 2026-11-01 | UI 改版 | **全量迁移 8/8 屏完成**。地图 / 皮肤 / 排行 / 好友榜 / 我的 / 挑战横幅全部改黏土，`frame()` 无条件走 `clayBackdrop`，`ui/draw.ts` 整个删除 | 补齐 `clayLock`（三处各写一份挂锁，形状粗细都不一致）与 `clayStar`（星级要跟着黏土走，矢量星没有厚度）。地图路径改三段色（凹槽/未走/已走）才分得出进度；地图顶部遮罩必须 0~167px 完全不透明，否则滚出去的星星会从半透明段透出来和关号胶囊叠在一起 |
| 2026-11-01 | UI 改版 | 黏土块 `lift = h*0.05` 在 380 高的头卡上露出 19px 深色横带，读作「一条黑边」而不是厚度 | 给 `lift` 加 11px 上限 |
| 2026-11-01 | UI 改版 | 主页只有 3 个节点时全挤在星球下半圈 | `phase` 取 120° 均分（`0 / 2π/3 / 4π/3`）：3 个节点＝正三角，6 个（第二圈 +π）＝60° 均分 |
| 2026-11-01 | UI 改版 | 浅底上的进度条凹槽 `#C2A284` 只比桌面深一点点，37/1000 时整条槽读成「没有」 | 三处（主页 / 游戏内 / 结算）统一改 `CLAY.sand.shade` |
| 2026-11-01 | UI 改版 | 黏土改造只做了 3 屏（主页 / 游戏内 / 结算），地图 / 皮肤 / 排行 / 我的 / 好友榜仍是旧糖果夜空，切页会断层 | `main.ts` 的 `frame()` 按 phase 分支背景，全量迁移完成后只留 `clayBackdrop`。进度与规格见 `23-UI风格方案.md` §7 |
| 2026-11-01 | UI 改版 | 结算面板 7 行内容挤在 660 高里，进度条与上下元素只隔 6px，读起来像一条分隔线 | 面板 `ph 660 → 732` 并按 `(1334-732)/2` 垂直居中，纵向节奏重排为 标题 `+58` / 三星 `+148` / 进度文字 `+212` / 细条 `+238` / 数据胶囊 `+272` / 解锁胶囊 `+380` / 按钮 `+456、+562、+642` |

