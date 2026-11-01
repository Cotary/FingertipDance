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
