package core

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config 是服务的完整配置。
type Config struct {
	Server ServerConfig `yaml:"server"`
	DB     DBConfig     `yaml:"db"`
	Redis  RedisConfig  `yaml:"redis"`
	JWT    JWTConfig    `yaml:"jwt"`
	Wechat WechatConfig `yaml:"wechat"`
	CORS   CORSConfig   `yaml:"cors"`
	Debug  DebugConfig  `yaml:"debug"`
}

// ServerConfig 是 HTTP 服务配置。
type ServerConfig struct {
	Port int    `yaml:"port"`
	Addr string `yaml:"addr"`
}

// DBConfig 是 PostgreSQL 配置。
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
	Secret   string `yaml:"secret"`
	TTLHours int    `yaml:"ttl_hours"`
}

// WechatConfig 是微信平台配置。Mock 为真时不请求微信服务器。
type WechatConfig struct {
	AppID  string `yaml:"appid"`
	Secret string `yaml:"secret"`
	Mock   bool   `yaml:"mock"`
}

// CORSConfig 是跨域白名单配置。
//
// ## 为什么需要白名单
//
// 以前 `Access-Control-Allow-Origin: *` 是写死的。配合
// `Authorization` 头被允许（`Allow-Headers` 里有），意味着**任何网站**
// 都能拿用户浏览器里的 token 调我们的 API —— 这是典型的 CSRF / 跨站攻击面。
//
// 生产环境必须收敛到自己的域名。
type CORSConfig struct {
	// AllowedOrigins 是允许的来源白名单。
	//
	// 特殊值：
	//   - `*`：允许所有（**仅限本地开发**，默认值）
	//   - 空数组：拒绝所有跨域请求
	AllowedOrigins []string `yaml:"allowed_origins"`
	// AllowCredentials 是否允许携带 Cookie。
	//
	// 注意：浏览器规定 `Allow-Origin: *` 与 `Allow-Credentials: true` 不能共存，
	// 所以配了 `*` 时这个开关会被忽略（见 `CORS` 中间件）。
	AllowCredentials bool `yaml:"allow_credentials"`
}

// DebugConfig 是调试功能开关。
//
// ## 为什么要有
//
// 测试时需要「直接跳到任意一关」——
// 1000 关手动打过来不现实；想复现某个具体关卡的 bug 也几乎不可能。
//
// ## 安全性
//
// **生产环境必须关掉**（默认 `false`）。
//
// 关掉之后：
//   - 跳关接口直接返回 403
//   - 客户端的调试入口也不存在（客户端用**独立的**构建期开关，
//     见 `games/line/src/core/debug.ts` —— 两边各判各的，
//     客户端绕过不算数，服务端自己把关）
type DebugConfig struct {
	// Enabled 是否开启调试功能（跳关等）。
	Enabled bool `yaml:"enabled"`
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
	if v := os.Getenv("SERVER_ADDR"); v != "" {
		c.Server.Addr = v
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
	// CORS 白名单：逗号分隔
	if v := os.Getenv("CORS_ALLOWED_ORIGINS"); v != "" {
		c.CORS.AllowedOrigins = splitAndTrim(v)
	}
	if v := os.Getenv("CORS_ALLOW_CREDENTIALS"); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			c.CORS.AllowCredentials = b
		}
	}
	if v := os.Getenv("DEBUG_ENABLED"); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			c.Debug.Enabled = b
		}
	}
}

// splitAndTrim 按逗号切分并去掉每项两端的空白。
func splitAndTrim(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
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
