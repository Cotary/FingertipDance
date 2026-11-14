package core

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// 业务错误码。0 表示成功。
const (
	CodeOK            = 0
	CodeBadRequest    = 4000
	CodeUnauthorized  = 4001
	CodeRateLimit     = 4002
	CodeForbidden     = 4003
	CodeLevelNotFound = 4004
	CodeStepsTooLow   = 4005
	CodeTimeInvalid   = 4006
	CodeSkipLimit     = 4007
	CodePathIllegal   = 4008
	CodeInternal      = 5000
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
