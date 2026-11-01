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
