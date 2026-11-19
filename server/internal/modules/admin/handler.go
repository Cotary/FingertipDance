package admin

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// loginReq 后台登录请求。
type loginReq struct {
	User     string `json:"user"`
	Password string `json:"password"`
}

// LoginHandler 处理后台登录，签发 admin 令牌。
//
// ## 凭据比较必须用常数时间
//
// `a == b` 会在第一个不同字节处返回，攻击者能通过响应时间差
// 逐字节猜出密码。`subtle.ConstantTimeCompare` 无论匹配多少位，
// 耗时都一样。
//
// 对一个内网工具来说这算不算过度设计？—— 后台没有注册入口、
// 没有验证码、也没有失败次数限制，暴力破解的唯一阻力就是
// 「每次尝试都要花时间」。常数时间比较是这个链条上最便宜的一环，
// 没理由不做。
func LoginHandler(cfg *core.Config, issuer *core.TokenIssuer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req loginReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误")
			return
		}

		// 两个都要比完，不能用 && 短路 —— 短路会让「用户名对不对」
		// 也能从耗时上看出来。
		userOK := constTimeEqual(req.User, cfg.Admin.User)
		passOK := constTimeEqual(req.Password, cfg.Admin.Password)
		if !userOK || !passOK {
			core.Fail(c, core.CodeUnauthorized, "用户名或密码错误")
			return
		}

		token, err := issuer.IssueAdmin(req.User)
		if err != nil {
			core.Fail(c, core.CodeInternal, "签发令牌失败")
			return
		}
		core.OK(c, gin.H{"token": token, "user": req.User})
	}
}

// OverviewHandler 返回总览数据（JSON）。
func OverviewHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		o, err := LoadOverview(db)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询总览失败: "+err.Error())
			return
		}
		hist, _ := LoadProgressHistogram(db)
		core.OK(c, gin.H{"overview": o, "progress": hist})
	}
}

// PlatformsHandler 返回分平台统计。
func PlatformsHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := LoadPlatforms(db)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询分平台失败: "+err.Error())
			return
		}
		core.OK(c, gin.H{"platforms": rows})
	}
}

// PlayersHandler 返回玩家列表（分页 + 筛选）。
func PlayersHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		size, _ := strconv.Atoi(c.DefaultQuery("size", "50"))
		plat, _ := strconv.Atoi(c.DefaultQuery("platform", "0"))

		f := PlayerFilter{
			Platform: plat,
			Search:   c.Query("q"),
			Page:     page,
			Size:     size,
		}
		rows, total, err := LoadPlayers(db, f)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询玩家失败: "+err.Error())
			return
		}
		core.OK(c, gin.H{"players": rows, "total": total, "page": f.Page, "size": f.Size})
	}
}

// PlayerDetailHandler 返回单个玩家详情。
func PlayerDetailHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || uid <= 0 {
			core.Fail(c, core.CodeBadRequest, "玩家 ID 非法")
			return
		}
		d, err := LoadPlayerDetail(db, uid)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询玩家详情失败: "+err.Error())
			return
		}
		core.OK(c, d)
	}
}

// LevelsHandler 返回关卡明细。
func LevelsHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
		rows, err := LoadLevels(db, limit)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询关卡统计失败: "+err.Error())
			return
		}
		core.OK(c, gin.H{"levels": rows})
	}
}

// AdsHandler 返回广告数据。
func AdsHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
		rows, err := LoadAds(db, days)
		if err != nil {
			core.Fail(c, core.CodeInternal, "查询广告数据失败: "+err.Error())
			return
		}
		core.OK(c, gin.H{"ads": rows})
	}
}

// ManualAdReq 是手工补录广告数据的请求。
type ManualAdReq struct {
	Platform    int    `json:"platform"`
	Day         string `json:"day"`    // YYYY-MM-DD
	AdType      string `json:"adType"`
	Placement   string `json:"placement"`
	Impressions int64  `json:"impressions"`
	Clicks      int64  `json:"clicks"`
	RevenueFen  int64  `json:"revenueFen"`
}

// ManualAdHandler 手工补录一行广告数据。
//
// ## 为什么必须有这个入口
//
// 平台接口可能因为权限没开、账号结算未完成、或者数据延迟而拿不到。
// 没有补录入口的话，那些天的收益在后台永远是 0 —— 而 0 和「没数据」
// 在报表上长得一模一样，会让人以为「那几天一分钱没赚」。
//
// 补录的行 `source='manual'`，和自动同步区分开，避免下次同步把它覆盖掉。
func ManualAdHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ManualAdReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误")
			return
		}
		if req.Platform != PlatformWechat && req.Platform != PlatformDouyin {
			core.Fail(c, core.CodeBadRequest, "平台必须是 1(微信) 或 2(抖音)")
			return
		}
		day, err := time.Parse("2006-01-02", req.Day)
		if err != nil {
			core.Fail(c, core.CodeBadRequest, "日期格式应为 YYYY-MM-DD")
			return
		}
		if req.RevenueFen < 0 || req.Impressions < 0 || req.Clicks < 0 {
			core.Fail(c, core.CodeBadRequest, "数值不能为负")
			return
		}

		_, err = db.Exec(`
INSERT INTO ad_revenue (platform, day, ad_type, placement, impressions, clicks, revenue_fen, source, fetched_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,'manual',$8)
ON CONFLICT (platform, day, ad_type, placement)
DO UPDATE SET impressions=$5, clicks=$6, revenue_fen=$7, source='manual', fetched_at=$8`,
			req.Platform, day, req.AdType, req.Placement, req.Impressions, req.Clicks, req.RevenueFen, time.Now())
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入失败: "+err.Error())
			return
		}
		core.OK(c, gin.H{"ok": true})
	}
}
