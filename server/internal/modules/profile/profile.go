package profile

import (
	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// LoginHandler 登录处理。T10 实现，T08 阶段为占位。
func LoginHandler(cfg *core.Config, issuer *core.TokenIssuer, db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		core.Fail(c, core.CodeInternal, "TODO")
	}
}
