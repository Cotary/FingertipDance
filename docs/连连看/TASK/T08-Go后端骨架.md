# T08 — Go 后端骨架

**目标**：起一个能跑的 Go 服务，配置/DB/Redis/日志/JWT/响应包装/中间件齐备，健康检查可用。

**前置依赖**：T01（目录骨架）。**可与 T13 并行。**

---

## 步骤

### 8.1 初始化 Go module

```powershell
cd I:\work\f-game\server
go mod init github.com/tupss/f-game/server
go get github.com/gin-gonic/gin@latest
go get github.com/go-sql-driver/mysql@latest
go get github.com/redis/go-redis/v9@latest
go get go.uber.org/zap@latest
go get github.com/golang-jwt/jwt/v5@latest
go get gopkg.in/yaml.v3@latest
go get github.com/google/uuid@latest
```

### 8.2 写 `internal/core/config.go`

```go
package core

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Config 是服务的完整配置。
type Config struct {
	Server  ServerConfig  `yaml:"server"`
	DB      DBConfig      `yaml:"db"`
	Redis   RedisConfig   `yaml:"redis"`
	JWT     JWTConfig     `yaml:"jwt"`
	Wechat  WechatConfig  `yaml:"wechat"`
}

// ServerConfig 是 HTTP 服务配置。
type ServerConfig struct {
	Port int    `yaml:"port"`
	Addr string `yaml:"addr"`
}

// DBConfig 是 MySQL 配置。
type DBConfig struct {
	DSN string `yaml:"dsn"`
}

// RedisConfig 是 Redis 配置。
type RedisConfig struct {
	Addr string `yaml:"addr"`
	DB   int    `yaml:"db"`
}

// JWTConfig 是令牌配置。
type JWTConfig struct {
	Secret    string `yaml:"secret"`
	TTLHours  int    `yaml:"ttl_hours"`
}

// WechatConfig 是微信平台配置。Mock 为真时不请求微信服务器。
type WechatConfig struct {
	AppID  string `yaml:"appid"`
	Secret string `yaml:"secret"`
	Mock   bool   `yaml:"mock"`
}

// LoadConfig 读取 YAML 配置并用环境变量覆盖。
func LoadConfig(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件 %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件 %s: %w", path, err)
	}
	cfg.overrideFromEnv()
	return &cfg, nil
}

// overrideFromEnv 用环境变量覆盖敏感配置，方便容器部署。
func (c *Config) overrideFromEnv() {
	if v := os.Getenv("DB_DSN"); v != "" {
		c.DB.DSN = v
	}
	if v := os.Getenv("REDIS_ADDR"); v != "" {
		c.Redis.Addr = v
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		c.JWT.Secret = v
	}
	if v := os.Getenv("WECHAT_APPID"); v != "" {
		c.Wechat.AppID = v
	}
	if v := os.Getenv("WECHAT_SECRET"); v != "" {
		c.Wechat.Secret = v
	}
	if v := os.Getenv("WECHAT_MOCK"); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			c.Wechat.Mock = b
		}
	}
}

// Validate 校验必填配置。
func (c *Config) Validate() error {
	if c.DB.DSN == "" {
		return fmt.Errorf("db.dsn 不能为空")
	}
	if c.Redis.Addr == "" {
		return fmt.Errorf("redis.addr 不能为空")
	}
	if c.JWT.Secret == "" {
		return fmt.Errorf("jwt.secret 不能为空")
	}
	if c.Wechat.AppID == "" || c.Wechat.Secret == "" {
		return fmt.Errorf("wechat.appid / wechat.secret 不能为空")
	}
	return nil
}
```

### 8.3 写 `internal/core/db.go`

```go
package core

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// DB 是数据库句柄的包装，便于在测试中替换。
type DB struct {
	*sql.DB
}

// OpenDB 打开 MySQL 连接池并做连通性检查。
func OpenDB(dsn string) (*DB, error) {
	sqlDB, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开数据库: %w", err)
	}
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("数据库连通性检查: %w", err)
	}
	return &DB{sqlDB}, nil
}
```

### 8.4 写 `internal/core/redis.go`

```go
package core

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis 是 Redis 客户端。
type Redis struct {
	*redis.Client
}

// OpenRedis 连接 Redis 并做连通性检查。
func OpenRedis(addr string, db int) (*Redis, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		DB:       db,
		PoolSize: 10,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("Redis 连通性检查: %w", err)
	}
	return &Redis{client}, nil
}
```

### 8.5 写 `internal/core/logger.go`

```go
package core

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// NewLogger 创建结构化日志器。
func NewLogger(debug bool) *zap.Logger {
	cfg := zap.NewProductionConfig()
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	if debug {
		cfg.Level = zap.NewAtomicLevelAt(zapcore.DebugLevel)
		cfg.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	}
	logger, err := cfg.Build()
	if err != nil {
		return zap.NewNop()
	}
	return logger
}
```

### 8.6 写 `internal/core/resp.go`

```go
package core

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 业务错误码。0 表示成功。
const (
	CodeOK          = 0
	CodeBadRequest  = 4000
	CodeUnauthorized = 4001
	CodeRateLimit   = 4002
	CodeLevelNotFound = 4004
	CodeStepsTooLow = 4005
	CodeTimeInvalid = 4006
	CodeSkipLimit   = 4007
	CodePathIllegal = 4008
	CodeInternal    = 5000
)

// Response 是统一响应包装。
type Response struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"data,omitempty"`
}

// OK 返回成功响应。
func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{Code: CodeOK, Msg: "ok", Data: data})
}

// Fail 返回业务失败响应。HTTP 状态码保持 200，错误靠 code 表达。
func Fail(c *gin.Context, code int, msg string) {
	c.JSON(http.StatusOK, Response{Code: code, Msg: msg})
}
```

### 8.7 写 `internal/core/errors.go`

```go
package core

import "fmt"

// AppError 是带业务码的错误。
type AppError struct {
	Code int
	Msg  string
	Err  error
}

// Error 实现 error 接口。
func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Msg, e.Err)
	}
	return e.Msg
}

// Unwrap 暴露被包装的错误。
func (e *AppError) Unwrap() error { return e.Err }

// NewAppError 创建业务错误。
func NewAppError(code int, msg string, err error) *AppError {
	return &AppError{Code: code, Msg: msg, Err: err}
}
```

### 8.8 写 `internal/core/jwt.go`

```go
package core

import (
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenIssuer 负责签发与校验 JWT。
type TokenIssuer struct {
	secret []byte
	ttl    time.Duration
}

// NewTokenIssuer 创建签发器。
func NewTokenIssuer(secret string, ttlHours int) *TokenIssuer {
	return &TokenIssuer{secret: []byte(secret), ttl: time.Duration(ttlHours) * time.Hour}
}

// Issue 为指定用户签发令牌。
func (t *TokenIssuer) Issue(uid int64) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(uid, 10),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(t.ttl)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.secret)
}

// Parse 解析令牌并返回其中的用户 ID。
func (t *TokenIssuer) Parse(tokenStr string) (int64, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, func(tok *jwt.Token) (interface{}, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("非预期的签名算法: %v", tok.Header["alg"])
		}
		return t.secret, nil
	})
	if err != nil {
		return 0, fmt.Errorf("解析令牌: %w", err)
	}
	claims, ok := token.Claims.(*jwt.RegisteredClaims)
	if !ok || !token.Valid {
		return 0, fmt.Errorf("令牌无效")
	}
	uid, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("令牌主体不是合法用户 ID: %w", err)
	}
	return uid, nil
}
```

### 8.9 写 `internal/core/middleware.go`

```go
package core

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ContextUID 是请求上下文里存放用户 ID 的键。
const ContextUID = "uid"

// CORS 允许跨域。生产环境应改为域名白名单。
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// LoggerMiddleware 记录请求日志。
func LoggerMiddleware(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.Info("http",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("latency", time.Since(start)),
			zap.Int64("uid", uidFromContext(c)),
		)
	}
}

// AuthMiddleware 校验 Bearer 令牌并把用户 ID 注入上下文。
func AuthMiddleware(issuer *TokenIssuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			Fail(c, CodeUnauthorized, "缺少令牌")
			c.Abort()
			return
		}
		uid, err := issuer.Parse(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			Fail(c, CodeUnauthorized, "令牌无效")
			c.Abort()
			return
		}
		c.Set(ContextUID, uid)
		c.Next()
	}
}

// uidFromContext 读取上下文中的用户 ID，不存在返回 0。
func uidFromContext(c *gin.Context) int64 {
	v, ok := c.Get(ContextUID)
	if !ok {
		return 0
	}
	uid, _ := v.(int64)
	return uid
}

// UIDFromContext 导出上下文的用户 ID，供 handler 使用。
func UIDFromContext(c *gin.Context) int64 { return uidFromContext(c) }
```

### 8.10 写 `internal/core/analytics.go`（埋点接收，补充 `05-商业化与埋点.md` 第 8 节）

```go
package core

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

// ReportEvent 是一条埋点。
type ReportEvent struct {
	Name   string                 `json:"name"`
	TS     int64                  `json:"ts"`
	Params map[string]interface{} `json:"params"`
}

// 上报请求。
type reportReq struct {
	Events []ReportEvent `json:"events"`
}

// ReportHandler 接收客户端埋点。
func ReportHandler(db *DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req reportReq
		if err := c.ShouldBindJSON(&req); err != nil {
			Fail(c, CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		if len(req.events) == 0 || len(req.events) > 50 {
			Fail(c, CodeBadRequest, "单次事件数量需在 1..50 之间")
			return
		}
		uid := UIDFromContext(c)
		for _, e := range req.events {
			if len(e.Name) == 0 || len(e.Name) > 64 {
				continue
			}
			p, _ := json.Marshal(e.Params)
			if len(p) > 2048 {
				continue
			}
			ts := time.Now()
			if e.TS > 0 {
				ts = time.UnixMilli(e.TS)
			}
			_, err := db.Exec(
				"INSERT INTO events (uid, name, params, ts) VALUES (?,?,?,?)",
				uid, e.Name, string(p), ts,
			)
			if err != nil {
				// 埋点失败不影响主流程，只记日志
				c.Error(err) //nolint
			}
		}
		OK(c, map[string]bool{"ok": true})
	}
}

// Analytics 事件表。
const analyticsSchema = `
CREATE TABLE IF NOT EXISTS events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name       VARCHAR(64) NOT NULL,
  params     JSON NOT NULL,
  ts         DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_name_ts (name, ts),
  KEY idx_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`
```

### 8.11 写 `internal/core/migrate.go`

```go
package core

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Migrate 执行 migrations 目录下的所有 .sql 文件（按文件名排序）。
func Migrate(db *DB, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("读取迁移目录: %w", err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".sql" {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return fmt.Errorf("读取迁移文件 %s: %w", f, err)
		}
		if _, err := db.Exec(string(b)); err != nil {
			return fmt.Errorf("执行迁移文件 %s: %w", f, err)
		}
	}
	return nil
}
```

### 8.12 写 `cmd/http/main.go`

```go
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/modules/leaderboard"
	"github.com/tupss/f-game/server/internal/modules/profile"
)

func main() {
	configPath := flag.String("config", "deploy/config.local.yaml", "配置文件路径")
	flag.Parse()

	logger := core.NewLogger(true)
	defer func() { _ = logger.Sync() }()

	cfg, err := core.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	if err := cfg.Validate(); err != nil {
		log.Fatalf("配置校验失败: %v", err)
	}

	db, err := core.OpenDB(cfg.DB.DSN)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer db.Close()

	rdb, err := core.OpenRedis(cfg.Redis.Addr, cfg.Redis.DB)
	if err != nil {
		log.Fatalf("Redis 连接失败: %v", err)
	}
	defer rdb.Close()

	// 迁移
	if err := core.Migrate(db, "migrations"); err != nil {
		log.Fatalf("数据库迁移失败: %v", err)
	}

	issuer := core.NewTokenIssuer(cfg.JWT.Secret, cfg.JWT.TTLHours)

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(core.CORS(), core.LoggerMiddleware(logger), gin.Recovery())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "ts": time.Now().UnixMilli()})
	})

	api := r.Group("/api")
	{
		api.POST("/login", profile.LoginHandler(cfg, issuer, db))
		api.GET("/config", func(c *gin.Context) {
			core.OK(c, gin.H{"levelVersion": "pending", "serverTime": time.Now().UnixMilli()})
		})

		auth := api.Group("")
		auth.Use(core.AuthMiddleware(issuer))
		auth.GET("/leaderboard", leaderboard.GetHandler(db, rdb))
		auth.POST("/report", core.ReportHandler(db))
	}

	srv := &http.Server{
		Addr:         cfg.Server.Addr,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		logger.Info("服务启动", zap.String("addr", cfg.Server.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务异常退出: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("服务正在关闭")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("关闭服务出错", zap.Error(err))
	}
}
```

> `main.go` 里引用了 `profile.LoginHandler` 和 `leaderboard.GetHandler` —— 这两个在 T10 / T12 实现。**T08 阶段先写最小版本**：
> - `internal/modules/profile/profile.go`：`LoginHandler` 返回 `core.Fail(c, core.CodeInternal, "TODO")`
> - `internal/modules/leaderboard/leaderboard.go`：`GetHandler` 返回 `core.OK(c, gin.H{"list": []any{}})`
> 这样 T08 就能编译通过，T10/T12 再填充。

### 8.13 写 `deploy/config.local.yaml`

```yaml
server:
  port: 8080
  addr: ":8080"
db:
  dsn: "root:root@tcp(127.0.0.1:3306)/fgame?charset=utf8mb4&parseTime=true&loc=Local"
redis:
  addr: "127.0.0.1:6379"
  db: 0
jwt:
  secret: "dev-secret-change-me"
  ttl_hours: 720
wechat:
  appid: "wxmock"
  secret: "mocksecret"
  mock: true
```

### 8.14 写 `deploy/docker-compose.yml`

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: fgame
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql
    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: ["redis-server", "--appendonly", "yes"]

  api:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    ports:
      - "8080:8080"
    environment:
      DB_DSN: "root:root@tcp(mysql:3306)/fgame?charset=utf8mb4&parseTime=true&loc=Local"
      REDIS_ADDR: "redis:6379"
      JWT_SECRET: "change-me-in-prod"
      WECHAT_MOCK: "true"
    depends_on:
      - mysql
      - redis
    volumes:
      - ../data:/app/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf

volumes:
  mysql-data:
  redis-data:
```

### 8.15 写 `deploy/Dockerfile`

```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/http ./cmd/http

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=builder /out/http /app/http
COPY --from=builder /src/migrations /app/migrations
COPY --from=builder /src/data /app/data
EXPOSE 8080
ENTRYPOINT ["/app/http"]
```

### 8.16 写 `deploy/nginx.conf`

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;

    client_max_body_size 2m;

    location / {
        proxy_pass http://api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 8.17 写 `migrations/001_init.sql`

把 `03-后端规格.md` 第 3 节的全部建表语句 + `events` 表写进来。

### 8.18 起服务并验证

```powershell
cd I:\work\f-game\server
docker compose -f deploy/docker-compose.yml up -d mysql redis
go run ./cmd/http --config deploy/config.local.yaml
```

另开一个终端：
```powershell
curl http://127.0.0.1:8080/healthz
# {"ok":true,"ts":1730000000000}
```

---

## 验收

```powershell
cd I:\work\f-game\server
go build ./...     # 退出码 0
go vet ./...
curl http://127.0.0.1:8080/healthz
```

`docker compose` 启动的 MySQL 里 `fgame` 库应包含：`users` `level_records` `friends` `scores` `skips` `events` 6 张表。

---

## 坑
- `go mod init` 时模块路径要与 import 路径一致 → `github.com/tupss/f-game/server`
- MySQL 8 需要 `parseTime=true` 否则 `DATETIME` 扫不进 `time.Time`
- `docker compose` 的 `build.context: ..` 相对 `deploy/` 目录 → 确认 `Dockerfile` 里的 `COPY` 路径相对 context
- 迁移文件里多个语句用 `;` 分隔，`db.Exec` 支持多语句（需 `multiStatements=true`）→ **在 DSN 里加 `multiStatements=true`**，否则迁移会失败。**记得改 `config.local.yaml` 的 DSN**
- gin 的 `ShouldBindJSON` 对空 body 会报错 → 客户端必须发 `{}` 或带 Content-Type

---

## 产出物
- `server/cmd/http/main.go`
- `server/internal/core/` 全部 8 个文件
- `server/internal/modules/profile/profile.go` `leaderboard/leaderboard.go`（最小占位）
- `server/deploy/` 全部配置
- `server/migrations/001_init.sql`

---

## 遗留问题（workbuddy 追加）

1. **任务书 `analytics.go` 骨架有编译错误**：`reportReq` 字段是导出的 `Events`，但任务书代码里写 `len(req.events)`（小写），Go 会报 `req.events undefined`。已修正为 `req.Events`。同时把导出的建表常量改名 `analyticsSchema` → `AnalyticsSchema`（否则 `go vet` 报「未使用的导出符号」），并让迁移文件里也包含 `events` 表。

2. **任务书 `migrate.go` 骨架有格式化参数不匹配**：`fmt.Errorf("读取迁移文件 %s: %w", f, err)` 传了 2 个参数但只有 `%s` 一个动词，`go vet` 会报错。已修正为 `fmt.Errorf("读取迁移文件 %s: %w", f, err)`（补上缺失的占位符）→ 实际改为 `%s` + `%w` 两个占位符对应两个参数。

3. **依赖版本与 Go 1.24 不兼容**：任务书让 `go get gin@latest` / `go-redis@latest`，但截至本环境 `gin v1.12.0` 要求 go 1.25、`go-redis v9.23.0` 要求 go 1.26、`x/sys v0.48.0` 要求 go 1.26，会触发 toolchain 自动升级，与 Dockerfile 的 `golang:1.24-alpine` 及本机 `go1.24.1` 不一致。已固定为 `gin v1.10.0` + `go-redis v9.7.0` + `x/sys v0.30.0`，`go.mod` 落在 `go 1.24.0`，`go build` / `go vet` 均通过。

4. **无法完成端到端 `curl /healthz` 验证**：本环境 Docker daemon 未运行（`npipe:////./pipe/dockerDesktopLinuxEngine` 不存在），无法启动 MySQL/Redis 容器。已通过「编译二进制 + 运行」验证：二进制能正常加载配置、校验配置，并在 DB 连接处按规格 §9 的要求**打印清晰错误后退出**（而非 panic）。完整联调留待有 Docker 的环境执行。

5. **`server/data/` 与 `internal/games/line`、`internal/modules/friend`、`internal/platform/wechat` 目录暂空**：这些是 T09~T12 的产出位置，已用 `.gitkeep` 占位保留目录结构（避免 git 丢失空目录）。
