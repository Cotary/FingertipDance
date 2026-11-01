package line

import (
	"encoding/base64"
	"fmt"
)

// 格子类型。与 TypeScript 侧保持一致。
const (
	CellBlock  = 0
	CellBrick  = 1
	CellOneway = 2
	CellStart  = 3
	CellEnd    = 4
)

// 方向。与 TypeScript 侧保持一致。
const (
	DirUp    = 0
	DirDown  = 1
	DirLeft  = 2
	DirRight = 3
)

// Cell 是解码后的单个格子。
type Cell struct {
	Type byte
	Dir  byte
}

// decodeGridBase64 解码 base64 网格为格子数组。
// 每格 1 字节：bit7 = 是否单向块，bit6..4 = 方向，bit3..1 = 类型，bit0 = 保留位。
func decodeGridBase64(b64 string) ([]Cell, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("base64 解码: %w", err)
	}
	out := make([]Cell, len(raw))
	for i, b := range raw {
		isOneway := (b >> 7) & 1
		dir := (b >> 4) & 0b111
		typ := (b >> 1) & 0b111
		if isOneway == 1 {
			typ = CellOneway
		}
		out[i] = Cell{Type: typ, Dir: dir}
	}
	return out, nil
}
