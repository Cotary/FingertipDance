package line

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// TestSkinsMatchClient 锁定服务端皮肤表与客户端 `SKINS` 一致。
//
// ## 为什么必须一致
//
// `/api/config` 会把服务端的皮肤表下发给客户端。两边口径不一致时，
// 皮肤页显示的解锁条件（"通关第 3 关" vs "看广告"）和服务端实际发放
// 的规则就对不上 —— 玩家按提示做了一件事，结果拿不到皮肤。
//
// 客户端真相源：`games/line/src/render/skins/index.ts` 的 `SKINS` 数组。
func TestSkinsMatchClient(t *testing.T) {
	client := parseClientSkins(t)

	server := map[string]SkinConfig{}
	for _, s := range DefaultSkins() {
		server[s.ID] = s
	}

	// 数量一致
	if len(server) != len(client) {
		t.Errorf("皮肤数量不一致：服务端 %d，客户端 %d", len(server), len(client))
	}

	for id, cs := range client {
		ss, ok := server[id]
		if !ok {
			t.Errorf("服务端缺少皮肤 %q（客户端有）", id)
			continue
		}
		if ss.Name != cs.Name {
			t.Errorf("皮肤 %q 名称不一致：服务端 %q，客户端 %q", id, ss.Name, cs.Name)
		}
		if ss.Tier != cs.Tier {
			t.Errorf("皮肤 %q 档位不一致：服务端 %q，客户端 %q", id, ss.Tier, cs.Tier)
		}
		if ss.UnlockType != cs.UnlockType {
			t.Errorf("皮肤 %q 解锁方式不一致：服务端 %q，客户端 %q", id, ss.UnlockType, cs.UnlockType)
		}
		if ss.UnlockValue != cs.UnlockValue {
			t.Errorf("皮肤 %q 解锁值不一致：服务端 %d，客户端 %d", id, ss.UnlockValue, cs.UnlockValue)
		}
	}
}

// TestNoLevelUnlockSkins 锁定「普通皮肤不再按关卡自动发放」。
//
// 客户端在 2026-11-01 把 8 个 normal 皮肤改成「看广告解锁」，
// 服务端要同步 —— 否则皮肤页写「看广告」，服务端却按关卡发。
func TestNoLevelUnlockSkins(t *testing.T) {
	for _, s := range DefaultSkins() {
		if s.UnlockType == "level" {
			t.Errorf("皮肤 %q 仍是 level 解锁（客户端已改为 ad），解锁值 %d", s.ID, s.UnlockValue)
		}
	}
}

// clientSkin 是从客户端 SKINS 数组解析出的一条皮肤。
type clientSkin struct {
	Name        string
	Tier        string
	UnlockType  string
	UnlockValue int
}

// 解析客户端 SKINS 里的一行。
var clientSkinLine = regexp.MustCompile(
	`\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*tier:\s*'([^']+)',\s*unlockType:\s*'([^']+)',\s*unlockValue:\s*(\d+)`,
)

// parseClientSkins 解析客户端 `SKINS` 常量。
func parseClientSkins(t *testing.T) map[string]clientSkin {
	t.Helper()
	p := filepath.Join("..", "..", "..", "..", "games", "line", "src", "render", "skins", "index.ts")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("读取客户端皮肤表失败: %v", err)
	}
	out := map[string]clientSkin{}
	for _, m := range clientSkinLine.FindAllStringSubmatch(string(b), -1) {
		out[m[1]] = clientSkin{
			Name:        m[2],
			Tier:        m[3],
			UnlockType:  m[4],
			UnlockValue: atoiOrZero(m[5]),
		}
	}
	if len(out) == 0 {
		t.Fatal("没能从客户端 SKINS 里解析出任何皮肤（正则不匹配了？）")
	}
	return out
}

func atoiOrZero(s string) int {
	v, err := atoiSafe(s)
	if err != nil {
		return 0
	}
	return v
}
