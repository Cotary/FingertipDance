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
		cfg.Encoding = "console"
		cfg.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	}
	logger, err := cfg.Build()
	if err != nil {
		return zap.NewNop()
	}
	return logger
}
