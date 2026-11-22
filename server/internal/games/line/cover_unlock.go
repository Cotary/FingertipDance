package line

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// CoverUnlockHandler 处理「看广告解锁」：主题与棋子皮肤。
//
// ## 为什么要有服务端这一层
//
// 客户端本地也有 `unlockedThemes` / `unlockedSkins`，但它们只是缓存：
// 换台手机就没了。玩家看了一次 30 秒广告，第二天在平板上打开发现
// 主题又锁上了 —— 那是**吞奖励**，比不给这个功能更伤。
//
// ## 谁能解锁：**服务端说了算**
//
// 请求只带 `{kind, id}`，能不能解锁由服务端查配置判断：
//
//   - `theme`：必须出现在 `platform_config` 的主题表里，且 `unlock == "ad"`；
//   - `skin`：必须出现在 `DefaultSkins()` 里，且 `unlockType == "ad"`。
//
// 不这样判的话，客户端可以直接 POST 一个 `gold`（第 200 关的里程碑皮肤）
// 把付费墙绕掉 —— 而这类请求在日志里和正常请求长得一模一样。
//
// ## 广告有没有真的看完，服务端验不了
//
// 激励视频的「看完」是平台 SDK 在**客户端**回调的，我们没接
// 广告主服务端的验签回调。所以这个接口本质上是「客户端自报看完了」。
// 接受这个折衷的理由：解锁的是**纯外观**，不改进度、不发奖、不影响排行榜；
// 有人伪造请求白拿一个皮肤，损失远小于把这条链做复杂的成本。
// 真要堵，就在 `ad_revenue` 侧对账时按平台回调核销。
func CoverUnlockHandler(db *core.DB, load PlatformConfigLoader) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			// Kind 目前只有 `theme` / `skin` 两种。
			Kind string `json:"kind"`
			ID   string `json:"id"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}

		uid := core.UIDFromContext(c)
		id := strings.TrimSpace(req.ID)
		if id == "" {
			core.Fail(c, core.CodeBadRequest, "缺少 id")
			return
		}

		// 平台从**用户行**取，不信 query：
		// 这个接口要鉴权，用户归属是确定的；让客户端自报平台只会多一个可篡改的参数。
		var platform int
		if err := db.QueryRow("SELECT platform FROM users WHERE id=$1", uid).Scan(&platform); err != nil {
			core.Fail(c, core.CodeInternal, "读取用户失败: "+err.Error())
			return
		}
		code := PlatformCodeOf(strconv.Itoa(platform))

		var column string
		switch req.Kind {
		case "theme":
			cfg := DefaultPlatformConfig()
			if load != nil {
				if got, err := load(code); err == nil {
					cfg = got.Normalize()
				}
			}
			if !themeUnlockableByAd(cfg, id) {
				core.Fail(c, core.CodeBadRequest, "这个主题不能用广告解锁")
				return
			}
			column = "unlocked_themes"
		case "skin":
			if !skinUnlockableByAd(DefaultSkins(), id) {
				core.Fail(c, core.CodeBadRequest, "这个皮肤不能用广告解锁")
				return
			}
			column = "unlocked_skins"
		default:
			core.Fail(c, core.CodeBadRequest, "未知的解锁类型: "+req.Kind)
			return
		}

		// ── 原子追加 ──
		//
		// 与 `grantSkinForLevel` 同一条 SQL 形状：已包含就不更新（行数 0）、
		// 没包含就 `||` 追加。这样并发点两次也只会写一个元素，
		// 不会出现「读-改-写丢更新」（玩家会看到刚解锁的东西不见了）。
		//
		// `column` 是上面 switch 里写死的常量，不是请求参数 ——
		// 拼进 SQL 是安全的（Postgres 也不支持列名占位符）。
		res, err := db.Exec(
			"UPDATE users SET "+column+" = "+column+" || to_jsonb($1::text) "+
				"WHERE id=$2 AND NOT ("+column+" @> to_jsonb($1::text))",
			id, uid,
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入解锁记录失败: "+err.Error())
			return
		}
		n, _ := res.RowsAffected()

		core.OK(c, gin.H{
			"ok": true,
			// 已经解锁过 = 幂等返回成功（客户端重复点不该看到报错）
			"already": n == 0,
			"kind":    req.Kind,
			"id":      id,
		})
	}
}

// themeUnlockableByAd 这个主题能不能用广告解锁。
//
// 判据是**配置里的 unlock 档位**，不是客户端说的话：
// 里程碑主题（第 60 关）和免费主题都不许走广告这条门 ——
// 否则客户端 POST 一个 mingsha 就把"打到 60 关"跳过了。
func themeUnlockableByAd(cfg PlatformConfig, id string) bool {
	for _, t := range cfg.Themes {
		if t.ID == id && t.Unlock == "ad" {
			return true
		}
	}
	return false
}

// skinUnlockableByAd 这个皮肤能不能用广告解锁。
//
// 与主题同理：`unlockType` 不是 `ad` 的一律拒绝。
// 特别注意 `premium`（gold / stardust / galaxy）是里程碑专属，
// 一旦能走广告，第 900 关的奖励就没有意义了。
func skinUnlockableByAd(skins []SkinConfig, id string) bool {
	for _, s := range skins {
		if s.ID == id && s.UnlockType == "ad" {
			return true
		}
	}
	return false
}
