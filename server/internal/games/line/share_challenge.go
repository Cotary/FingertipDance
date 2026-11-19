package line

import (
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// 挑战 token 的字符集与长度。
//
// ## 为什么是 base32 而不是 base64
//
// token 会进分享链接的 query（`?c=XXXX`）。base64 的 `+ / =` 在 URL 里
// 需要再转义一层，而 base32 只有 `A-Z2-7`，天然 URL-safe、也不用担心
// 大小写（微信部分场景会把 query 规范化）。
//
// 20 字节 = 160 bit 随机量 → base32 后 32 个字符，
// 碰撞概率可以忽略（生日界约 2^80 次分享才开始有风险）。
const (
	challengeTokenBytes = 20
	challengeTokenLen   = 32
	// 邀请语义的哨兵值：这次分享**不宣称成绩**。
	//
	// 不能用 0 —— 0 次重来是最好的成绩（三星），语义正好相反。
	challengeNoScore = -1
)

var challengeTokenEnc = base32.StdEncoding.WithPadding(base32.NoPadding)

// newChallengeToken 生成一个随机 token。
func newChallengeToken() (string, error) {
	buf := make([]byte, challengeTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成随机 token: %w", err)
	}
	return challengeTokenEnc.EncodeToString(buf), nil
}

// isChallengeToken 校验 token 形状。
//
// 只做形状校验（长度 + 字符集），不查库 —— 调用方要区分
// 「格式就不对」（可以直接 400）和「格式对但库里没有」（404）。
func isChallengeToken(s string) bool {
	if len(s) != challengeTokenLen {
		return false
	}
	for _, ch := range s {
		if !(ch >= 'A' && ch <= 'Z') && !(ch >= '2' && ch <= '7') {
			return false
		}
	}
	return true
}

// shareChallengeReq 创建挑战的请求体。
type shareChallengeReq struct {
	LevelIdx int `json:"levelIdx"`
	// Undos 是发起人的重来次数。
	//
	// **用指针**：需要区分「字段没传」（= 纯邀请）与「传了 0」（= 零重来，三星）。
	// 用普通 int 的话两者都是 0，邀请会被写成「我零重来通关」的假挑战。
	Undos *int `json:"undos"`
}

// ShareChallengeHandler 记录一次分享，返回可写进链接的挑战 token。
//
// ## 为什么分享也要走服务端
//
// 以前的分享是纯客户端行为：拼一个 query 交给 `wx.shareAppMessage` 就完事，
// 服务端对「谁分享了哪一关、当时什么成绩」一无所知。
// 于是挑战的对手成绩只能从 **URL 参数** 里读 —— 那是可以被任意篡改的。
//
// 现在分享先落一行记录，链接里只带 token。好友打开时用 token 反查，
// 结算时服务端按 Token 取出真正的对手成绩来判胜负。
// **胜负不再由链接参数决定。**
//
// ## 幂等：同一人重复分享同一关复用同一 token
//
// 玩家可能连点两次分享、或者隔天再分享同一关。每次都生成新 token 的话，
// `challenges` 会被同一个人的同一关反复填充，而且好友手里的旧链接
// 和新的成了两条互不相干的挑战。所以先按 `(uid, level_idx, undos)` 找最近一条，
// 找到就复用。
func ShareChallengeHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req shareChallengeReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误: "+err.Error())
			return
		}
		uid := core.UIDFromContext(c)

		lv := CoverLevels.Get(req.LevelIdx)
		if lv == nil {
			core.Fail(c, core.CodeLevelNotFound, "关卡不存在")
			return
		}

		// 没传 undos = 纯邀请；传了就必须是非负数
		undos := challengeNoScore
		if req.Undos != nil {
			if *req.Undos < 0 {
				core.Fail(c, core.CodeBadRequest, "重来次数不能为负")
				return
			}
			undos = *req.Undos
		}

		// ── 复用：同一人 + 同一关 + 同一成绩，返回已有的那条 ──
		//
		// 只复用「**最近**一条」而不是任意一条：万一将来加了挑战有效期，
		// 拿一条很旧的记录会让「刚分享出去的链接显示已过期」。
		var existing string
		err := db.QueryRow(
			"SELECT token FROM challenges WHERE from_uid=$1 AND level_idx=$2 AND from_undos=$3 "+
				"ORDER BY created_at DESC LIMIT 1",
			uid, req.LevelIdx, undos,
		).Scan(&existing)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			core.Fail(c, core.CodeInternal, "查询已有挑战失败: "+err.Error())
			return
		}
		if existing != "" {
			core.OK(c, gin.H{
				"token":    existing,
				"levelIdx": req.LevelIdx,
				"undos":    undos,
				"reused":   true,
			})
			return
		}

		token, err := newChallengeToken()
		if err != nil {
			core.Fail(c, core.CodeInternal, err.Error())
			return
		}

		// 昵称快照：好友看到的应该是「分享那一刻的署名」
		var nickname string
		if err := db.QueryRow("SELECT nickname FROM users WHERE id=$1", uid).Scan(&nickname); err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				core.Fail(c, core.CodeInternal, "读取昵称失败: "+err.Error())
				return
			}
			// 用户行不存在不该让分享失败 —— 昵称留空，前端会显示「好友」
		}

		_, err = db.Exec(
			"INSERT INTO challenges (token, from_uid, level_idx, from_undos, from_name, created_at) "+
				"VALUES ($1,$2,$3,$4,$5,$6)",
			token, uid, req.LevelIdx, undos, truncateRunes(nickname, 64), nowFunc(),
		)
		if err != nil {
			core.Fail(c, core.CodeInternal, "写入挑战失败: "+err.Error())
			return
		}

		core.OK(c, gin.H{
			"token":    token,
			"levelIdx": req.LevelIdx,
			"undos":    undos,
			"reused":   false,
		})
	}
}

// challengeInfo 是一条挑战的对外形态。
type challengeInfo struct {
	Token     string `json:"token"`
	LevelIdx  int    `json:"levelIdx"`
	FromUid   int64  `json:"fromUid"`
	FromName  string `json:"fromName"`
	// FromUndos = -1 表示「这条分享不带成绩」（纯邀请）。
	FromUndos int `json:"fromUndos"`
	HasScore  bool `json:"hasScore"`
}

// ChallengeInfoHandler 按 token 查挑战上下文（好友打开分享链接时用）。
//
// ## 为什么**不加鉴权**
//
// 好友点开分享链接时可能还没登录（微信小游戏的登录发生在启动之后）。
// 挂强制鉴权的话，第一帧就拿不到「谁在挑战我」，横幅只能显示「好友的挑战」。
//
// 不加鉴权是安全的：token 本身就是不可枚举的随机串，
// 而返回的只有「关号 + 昵称 + 重来次数」—— 这些信息本来就要写进分享卡片，
// 不是私密数据。
func ChallengeInfoHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.Param("token")
		if !isChallengeToken(token) {
			core.Fail(c, core.CodeBadRequest, "挑战编号格式不正确")
			return
		}

		var info challengeInfo
		var nickname string
		err := db.QueryRow(
			"SELECT token, level_idx, from_uid, from_undos, from_name FROM challenges WHERE token=$1",
			token,
		).Scan(&info.Token, &info.LevelIdx, &info.FromUid, &info.FromUndos, &nickname)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				// 用 4004（关卡不存在）这个码不合适，但错误码表里没有
				// 「资源不存在」，加一个会牵动客户端所有 switch。
				// 这里借用 CodeBadRequest 并给出明确文案。
				core.Fail(c, core.CodeBadRequest, "挑战不存在或已失效")
				return
			}
			core.Fail(c, core.CodeInternal, "查询挑战失败: "+err.Error())
			return
		}

		info.FromName = nickname
		info.HasScore = info.FromUndos >= 0
		core.OK(c, info)
	}
}

// truncateRunes 按**字符**截断（不是字节）。
//
// 直接 `s[:64]` 会把多字节的中文截成半个字，写进 varchar(64) 可能触发
// 编码错误或者变成乱码。这里按 rune 走，保证不会切坏字。
func truncateRunes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n]))
}
