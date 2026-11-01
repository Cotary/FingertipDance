package core

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Config 是服务的完整配置。
type Config struct {
	Server ServerConfig `yaml:"server"`
	DB     DBConfig     `yaml:"db"`
	Redis  RedisConfig  `yaml:"redis"`
	JWT    JWTConfig    `yaml:"jwt"`
	Wechat WechatConfig `yaml:"wechat"`
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
