package admin

import (
	"crypto/subtle"
	"errors"
	"strconv"
	"strings"
)

// errBadCreds 账号或密码错误。
//
// 故意不区分「用户名错」和「密码错」—— 区分了就等于告诉攻击者
// 「用户名是对的，继续猜密码吧」。
var errBadCreds = errors.New("账号或密码错误")

// constTimeEqual 常数时间字符串比较。
//
// ## 为什么不能用 ==
//
// `==` 在第一个不同的字节处返回，攻击者可以按响应时间
// 逐字节猜出密码。`subtle.ConstantTimeCompare` 耗时与内容无关。
//
// 长度不同时会立即返回 false —— 这本身泄露了「长度」，但密码长度
// 远不如内容敏感，且换来更简单的逻辑。要彻底消除可以先把两边
// 都哈希成定长再比，这里不必要。
func constTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// yuanToFen 把「元」字符串转成「分」。
//
// ## 为什么要在字符串层面解析
//
// `strconv.ParseFloat("12.50") * 100` 会得到 1249.9999999999998，
// 取整成 1249 —— 少一分。这类误差在报表里会累积成对不上账。
//
// 按「整数部分 + 小数部分」分别解析，全程整数运算，不会漂。
// 允许的输入：`12`、`12.5`、`12.50`、`.5`、空串（= 0）。
// 非法输入返回 0（宁可少记收入，也不因为一个格式错误让整个表单失败）。
func yuanToFen(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}

	intPart, fracPart := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, fracPart = s[:i], s[i+1:]
	}
	// 小数只取前两位（分是人民币最小单位）
	for len(fracPart) < 2 {
		fracPart += "0"
	}
	fracPart = fracPart[:2]

	iv, err := strconv.ParseInt(orZero(intPart), 10, 64)
	if err != nil {
		return 0
	}
	fv, err := strconv.ParseInt(orZero(fracPart), 10, 64)
	if err != nil {
		return 0
	}

	fen := iv*100 + fv
	if neg {
		fen = -fen
	}
	return fen
}

// orZero 空串当 0（`parseInt("")` 会报错）。
func orZero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}
