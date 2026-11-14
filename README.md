# FingertipDance · 指尖舞

一款「路径连线」类小游戏（连连看 / Cover 玩法）：从起点按住手指，只能走到上下左右相邻格，
一路拖到终点；路过的格子被点亮，线不能断、不能原路退回。

微信小游戏 / H5 双端同构，前端用 **Canvas 2D 全手绘**（零 DOM、零 CSS、零图片资源），
后端 Go 提供关卡表、进度、分数与皮肤。

---

## 目录结构

```
games/line/          客户端（TypeScript + Vite，750×1334 设计坐标等比缩放）
  src/core/cover/v3/  关卡生成：carve / pool / rules / solver / solcount
  src/game/           会话、状态、提示、进度与同步
  src/render/         棋盘、路径、主题、音色、地图配色
  src/ui/             主页 / 游戏内 / 结算 / 地图 / 皮肤页
  src/platform/       web 与微信小游戏的能力封装（登录 / 分享 / 广告 / 存储）
  test/               vitest 用例
  tools/              截图、主题预览、关卡陈列、生成与审计脚本
server/              服务端（Go 1.24 + gin + pgx + Redis）
  internal/games/line  关卡、进度、分数、皮肤、调试跳关
  migrations/          SQL 迁移（幂等，启动时按序执行）
  deploy/              本地与生产的 compose / Dockerfile / nginx 配置
docs/连连看/          设计与施工文档（规格、坑表、复盘，README 里是索引）
```

## 快速开始

前端（默认 http://localhost:50002）：

```bash
cd games/line
npm install
npm run dev -- --port 50002
```

后端（默认 :50001，依赖 Postgres 与 Redis）：

```bash
cd server/deploy && docker compose up -d postgres redis   # 15432 / 6379
cd ../ && go run ./cmd/http -config deploy/config.local.yaml
```

两个常用预览页，改参数就能看不同关卡与主题：

- `http://localhost:50002/tools/live-gallery.html?p=map&lv=38&t=kintsugi` — 地图（`lv=` 关号，`t=` 主题）
- `http://localhost:50002/tools/theme-board.html?t=kintsugi` — 单套棋盘主题

主题 id：留空为默认星穹，另有 `ink` `glass` `kintsugi` `pixel` `orbit` `neon` `obsidian` `gilded` `abyss`。

## 验证

```bash
cd games/line && npm test && npm run typecheck && npm run build
cd server && go build ./... && go test ./...
```

## 几个关键约束

- **坐标系**：所有绘制都写在 750×1334 设计坐标里，由 `render/viewport.ts` 换算到设备像素，
  所以布局不随屏幕宽度变化，只整体缩放。
- **关卡表**：`games/line/data/levels-v3.json` 是生成产物，服务端读同名文件；
  改动要用 `npm run cover:gen` 重新生成，不要手改。
- **主题**：一套主题 = `backdrop + plate + cell + trail + glyph + endpoint` 六个钩子
  （见 `src/render/themes/kit.ts`）。新增一套要同时注册名称、地图配色（`mapstyle.ts`）、
  音色（`voice.ts`）、陈列页陶片与测试，漏一处就会「装备了但没生效」。
- **迁移**：服务启动会从头执行全部 `.sql`，没有版本表，所以 DDL 必须幂等。

## 文档

`docs/连连看/README.md` 是总索引。想快速了解现状，建议按这个顺序看：

| 文档 | 内容 |
|---|---|
| `00-项目约定.md` | 目录 / 命名 / 命令 / 提交规范 |
| `26-项目现状与玩法总览.md` | 这个项目现在是什么样 |
| `32-棋盘主题.md`、`38-金缮瓷盘.md` | 主题系统的设计与复盘 |
| `36-星空古路地图.md` | 地图的伪 3D 做法 |
| `35-多端账号与数据后台方案.md` | 微信 / 抖音 / H5 账号打通方案（**仅设计，未实现**） |

> `35` 号文档目前只是方案：登录态、跨端合号与统一后台还没落到代码里。
