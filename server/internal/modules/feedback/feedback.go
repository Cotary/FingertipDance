// Package feedback 意见反馈：文字 + 可选截图，落库供后台查看。
//
// ## 为什么不做成「发邮件 / 跳客服会话」
//
// 平台客服会话（`wx.openCustomerServiceConversation`）要求后台配客服人员，
// 而且对话记录留在微信侧 —— 我们看不到、也统计不了。反馈落库之后，
// 「这周玩家在抱怨什么」是一个 SQL 能回答的问题。
//
// 客服会话仍然有价值（真人即时回复），但那是**另一条路**：本模块负责
// "能收、能看、能筛"，客服负责"能回"。两者不冲突，后台可以并列放。
package feedback

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/tupss/f-game/server/internal/core"
)

// 正文长度限制（按**字符**不是字节：中文一个字 3 字节，
// 按字节限会让玩家只能写 1/3 的内容）。
const (
	maxContentRunes = 500
	// base64 后的长度。nginx 限 2m 请求体，这里留余量。
	maxImageB64 = 1_500_000
	// 场景 / 机型的长度上限
	maxSceneRunes   = 32
	maxContextBytes = 2000
)

// submitReq 提交反馈。
type submitReq struct {
	Content string `json:"content"`
	/** 截图（base64，**不含** `data:image/...;base64,` 前缀） */
	Image string `json:"image"`
	/** 玩家当时在哪：home / playing / result / skins ... */
	Scene string `json:"scene"`
	/** 当时关号，0 = 不在关卡里 */
	LevelIdx int `json:"levelIdx"`
	/** 客户端版本 / 机型等（JSON 文本，客户端自己拼） */
	Context string `json:"context"`
}

// SubmitHandler 接收一条反馈。
//
// ## 为什么允许匿名「有 uid 但没内容」之外的宽松处理
//
// 挂的是强制鉴权（`auth` 分组），所以一定有 uid。但**内容必须非空**：
// 一条只有截图的反馈，运营看不出玩家想说什么（"这关过不去"还是"这里画错了"）。
//
// ## 长度是截断而不是报错
//
// 玩家写超了 500 字，把他的 500 字退回来说"太长了"是最差的做法 ——
// 他会直接放弃。截断 + 收下，比原样退回去有用。
func SubmitHandler(db *core.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req submitReq
		if err := c.ShouldBindJSON(&req); err != nil {
			core.Fail(c, core.CodeBadRequest, "参数错误")
			return
		}

		content := strings.TrimSpace(req.Content)
		if content == "" {
			core.Fail(c, core.CodeBadRequest, "请先写点内容")
			return
		}
		if utf8.RuneCountInString(content) > maxContentRunes {
			content = string([]rune(content)[:maxContentRunes])
		}

		image := strings.TrimSpace(req.Image)
		// 去掉可能的 dataURL 前缀：客户端不该带，但带了也不该整条拒绝
		if i := strings.Index(image, "base64,"); i >= 0 && strings.HasPrefix(image, "data:") {
			image = image[i+len("base64,"):]
		}
		if len(image) > maxImageB64 {
			// 图太大直接丢图保文字 —— 文字才是主体
			image = ""
		}

		scene := strings.TrimSpace(req.Scene)
		if utf8.RuneCountInString(scene) > maxSceneRunes {
			scene = string([]rune(scene)[:maxSceneRunes])
		}

		ctxJSON := req.Context
		if len(ctxJSON) > maxContextBytes {
			ctxJSON = ctxJSON[:maxContextBytes]
		}

		uid := core.UIDFromContext(c)

		// 平台快照：从 users 取，不信客户端传的。
		var platform int
		_ = db.QueryRow("SELECT platform FROM users WHERE id=$1", uid).Scan(&platform)

		var id int64
		err := db.QueryRow(
			"INSERT INTO feedbacks (uid, platform, content, image, scene, level_idx, context, status, created_at) "+
				"VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8) RETURNING id",
			uid, platform, content, image, scene, req.LevelIdx, ctxJSON, time.Now(),
		).Scan(&id)
		if err != nil {
			core.Fail(c, core.CodeInternal, "提交失败，请稍后再试")
			return
		}

		core.OK(c, gin.H{"id": id})
	}
}
