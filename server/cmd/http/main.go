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
	"github.com/tupss/f-game/server/internal/games/line"
	"github.com/tupss/f-game/server/internal/modules/friend"
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

	// 加载关卡表
	if err := line.Levels.Load("data"); err != nil {
		log.Fatalf("加载关卡表失败: %v", err)
	}
	if err := line.Levels.SelfCheck(50); err != nil {
		log.Fatalf("关卡表自检失败: %v", err)
	}
	logger.Info("关卡表已加载",
		zap.String("version", line.Levels.Version()),
		zap.Int("count", line.Levels.Count()),
	)

	issuer := core.NewTokenIssuer(cfg.JWT.Secret, cfg.JWT.TTLHours)

	// 可取消的根上下文，供后台任务使用
	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()

	// 每日凌晨重建总榜（保证与数据库一致）
	go func() {
		for {
			now := time.Now()
			next := time.Date(now.Year(), now.Month(), now.Day()+1, 4, 0, 0, 0, now.Location())
			select {
			case <-time.After(time.Until(next)):
				if err := leaderboard.RefreshAll(rootCtx, db, rdb); err != nil {
					logger.Error("重建榜单失败", zap.Error(err))
				} else {
					logger.Info("总榜已重建")
				}
			case <-rootCtx.Done():
				return
			}
		}
	}()

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(core.CORS(), core.LoggerMiddleware(logger), gin.Recovery())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "ts": time.Now().UnixMilli()})
	})

	api := r.Group("/api")
	{
		api.POST("/login", profile.LoginHandler(cfg, issuer, db))
		api.GET("/config", line.ConfigHandler(line.DefaultSkins(), "adunit-mock"))
		api.GET("/levels", line.LevelsHandler())

		auth := api.Group("")
		auth.Use(core.AuthMiddleware(issuer))
		auth.GET("/leaderboard", leaderboard.GetHandler(db, rdb))
		auth.GET("/friends", friend.Handler(db))
		auth.POST("/friend", friend.Handler(db))
		auth.GET("/profile", profile.ProfileHandler(db))
		auth.POST("/report", core.ReportHandler(db))
		auth.POST("/progress", line.ProgressHandler(db, rdb, line.DefaultSkins()))
		auth.POST("/challenge", line.ChallengeHandler(db))
		auth.POST("/skip", line.SkipHandler(db))
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
