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

	// 加载 cover v3 关卡表（铺满全盘的新玩法）
	if err := line.CoverLevels.Load("data"); err != nil {
		log.Fatalf("加载 cover 关卡表失败: %v", err)
	}
	if err := line.CoverLevels.SelfCheck(50); err != nil {
		log.Fatalf("cover 关卡表自检失败: %v", err)
	}
	logger.Info("cover 关卡表已加载",
		zap.String("version", line.CoverLevels.Version()),
		zap.Int("count", line.CoverLevels.Count()),
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
	r.Use(core.CORS(cfg.CORS.AllowedOrigins...), core.LoggerMiddleware(logger), core.LimitBodyMiddleware(), gin.Recovery())

	// 埋点接口限流：6 次/秒，突发 20 次。
	// 正常客户端每分钟也就上报几次，突发 20 次足够覆盖
	// 「启动埋点 + 切后台补传 + 断网积压一次性补传」这些场景。
	reportLimiter := core.NewRateLimiter(6, 20)
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			reportLimiter.Cleanup(10 * time.Minute)
		}
	}()

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "ts": time.Now().UnixMilli()})
	})

	api := r.Group("/api")
	{
		api.POST("/login", profile.LoginHandler(cfg, issuer, db))
		api.GET("/config", line.ConfigHandler(line.DefaultSkins(), "adunit-mock"))
		// ── 经典模式接口（已废弃）──
		//
		// cover 模式是现行玩法，客户端只用下面那组 `/api/cover/*`。
		// 这些经典接口保留是为了兼容老版本客户端，**新的客户端不要用**。
		api.GET("/levels", line.LevelsHandler())
		// cover 模式（现行玩法）的关卡表
		api.GET("/levels-v3", line.CoverLevelsHandler())

		auth := api.Group("")
		auth.Use(core.AuthMiddleware(issuer))
		auth.GET("/leaderboard", leaderboard.GetHandler(db, rdb))
		auth.GET("/friends", friend.Handler(db))
		auth.POST("/friend", friend.Handler(db))
		auth.GET("/profile", profile.ProfileHandler(db))
		auth.GET("/progress/stars", line.StarsHandler(db))
		// 以下三个是经典模式的写接口，已废弃（保留兼容老客户端）
		auth.POST("/progress", line.ProgressHandler(db, rdb, line.DefaultSkins()))
		auth.POST("/challenge", line.ChallengeHandler(db))
		auth.POST("/skip", line.SkipHandler(db))

		// ── 埋点：鉴权可选 ──
		//
		// 客户端在 `login()` 之前就开始埋点（`app_start` 是第一个事件），
		// 那时还没有 token。挂在强制鉴权下的话这批事件会永远 401。
		// 用可选鉴权：有 token 就记 uid，没有就记 0（匿名）。
		//
		// 因为匿名可调，必须限流 —— 否则 events 表可以被刷爆。
		api.POST("/report", core.RateLimitMiddleware(reportLimiter), core.OptionalAuthMiddleware(issuer), core.ReportHandler(db))

		// ── cover 模式（现行玩法）──
		// 每一项都有独立入口：关卡表、成绩上报、挑战、跳过。
		// **不能复用经典模式的接口** —— 两套关卡的数据模型和校验规则完全不同
		// （cover 要铺满全盘 + 冰块滑行 / 钥匙门 / 传送门 / 星星顺序）。
		auth.POST("/cover/progress", line.CoverProgressHandler(db, rdb))
		auth.POST("/cover/challenge", line.CoverChallengeHandler(db))
		auth.POST("/cover/skip", line.CoverSkipHandler(db))

		// ── 调试接口（仅测试环境）──
		//
		// 跳到任意关卡。**服务端独立把关**：配置里没开 `debug.enabled`
		// 时这个接口直接 403 —— 客户端绕过不算数。
		// 生产环境的 `config.yaml` 不含这个配置项 → 默认关闭。
		if cfg.Debug.Enabled {
			logger.Info("调试模式已开启：/api/debug/jump 可用")
		}
		auth.POST("/debug/jump", line.DebugJumpHandler(db, cfg.Debug.Enabled))
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
