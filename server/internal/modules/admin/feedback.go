package admin

import (
	"fmt"
	"strings"
	"time"

	"github.com/tupss/f-game/server/internal/core"
)

// FeedbackRow 后台列表里的一条反馈（**不含图片正文**）。
//
// ## 为什么列表不查 image 列
//
// 一张截图 base64 后 200~300KB。列表一页 20 条就是 6MB HTML ——
// 后台在手机上打开会直接卡住。所以列表只查「有没有图」，
// 图放在详情页按需加载（`/admin/feedback/:id/image`）。
type FeedbackRow struct {
	ID        int64
	UID       int64
	Nickname  string
	Platform  int
	Content   string
	HasImage  bool
	Scene     string
	LevelIdx  int
	Status    string
	CreatedAt time.Time
	HandledAt *time.Time
}

// FeedbackFilter 列表筛选条件。
type FeedbackFilter struct {
	// 状态："" = 全部，"new" / "done" / "ignored"
	Status string
	Page   int
	Size   int
}

// 每页条数。
const feedbackPageSize = 20

// LoadFeedbacks 查一页反馈。
func LoadFeedbacks(db *core.DB, f FeedbackFilter) ([]FeedbackRow, int64, error) {
	if f.Size <= 0 || f.Size > 100 {
		f.Size = feedbackPageSize
	}
	if f.Page <= 0 {
		f.Page = 1
	}

	// `image <> ''` 作为 has_image：不把正文查出来
	where := "WHERE 1=1"
	args := []any{}
	if f.Status != "" {
		args = append(args, f.Status)
		where += fmt.Sprintf(" AND f.status=$%d", len(args))
	}

	var total int64
	if err := db.QueryRow("SELECT count(*) FROM feedbacks f "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, f.Size, (f.Page-1)*f.Size)
	rows, err := db.Query(
		"SELECT f.id, f.uid, COALESCE(u.nickname,''), f.platform, f.content, "+
			"(f.image <> ''), f.scene, f.level_idx, f.status, f.created_at, f.handled_at "+
			"FROM feedbacks f LEFT JOIN users u ON u.id = f.uid "+
			where+
			fmt.Sprintf(" ORDER BY (f.status='new') DESC, f.created_at DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args)),
		args...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []FeedbackRow
	for rows.Next() {
		var r FeedbackRow
		if err := rows.Scan(&r.ID, &r.UID, &r.Nickname, &r.Platform, &r.Content, &r.HasImage,
			&r.Scene, &r.LevelIdx, &r.Status, &r.CreatedAt, &r.HandledAt); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// LoadFeedbackImage 取单张截图（base64 正文）。
//
// 单独一条查询：列表不查它，详情页才查。
func LoadFeedbackImage(db *core.DB, id int64) (string, error) {
	var img string
	err := db.QueryRow("SELECT image FROM feedbacks WHERE id=$1", id).Scan(&img)
	return img, err
}

// LoadFeedbackDetail 取一条反馈的完整信息（含 context）。
func LoadFeedbackDetail(db *core.DB, id int64) (*FeedbackRow, string, error) {
	var r FeedbackRow
	var ctx string
	err := db.QueryRow(
		"SELECT f.id, f.uid, COALESCE(u.nickname,''), f.platform, f.content, "+
			"(f.image <> ''), f.scene, f.level_idx, f.status, f.created_at, f.handled_at, f.context "+
			"FROM feedbacks f LEFT JOIN users u ON u.id = f.uid WHERE f.id=$1",
		id,
	).Scan(&r.ID, &r.UID, &r.Nickname, &r.Platform, &r.Content, &r.HasImage,
		&r.Scene, &r.LevelIdx, &r.Status, &r.CreatedAt, &r.HandledAt, &ctx)
	if err != nil {
		return nil, "", err
	}
	return &r, ctx, nil
}

// SetFeedbackStatus 标记处理状态。
func SetFeedbackStatus(db *core.DB, id int64, status string) error {
	if status != "new" && status != "done" && status != "ignored" {
		return fmt.Errorf("非法状态 %q", status)
	}
	if status == "new" {
		_, err := db.Exec("UPDATE feedbacks SET status='new', handled_at=NULL WHERE id=$1", id)
		return err
	}
	_, err := db.Exec("UPDATE feedbacks SET status=$1, handled_at=$2 WHERE id=$3", status, time.Now(), id)
	return err
}

// CountNewFeedbacks 未处理条数（导航角标用）。
func CountNewFeedbacks(db *core.DB) int64 {
	var n int64
	_ = db.QueryRow("SELECT count(*) FROM feedbacks WHERE status='new'").Scan(&n)
	return n
}

// FeedbackPage 反馈列表页。
func FeedbackPage(db *core.DB, who string, f FeedbackFilter) string {
	rows, total, err := LoadFeedbacks(db, f)
	if err != nil {
		return layout("反馈", "feedback", who, `<div class="empty">查询失败：`+esc(err.Error())+`</div>`)
	}

	var b strings.Builder
	b.WriteString(`<h1>意见反馈</h1><div class="sub">玩家提交的文字与截图 · 按「待处理优先」排序</div>`)

	// 状态筛选
	tab := func(key, label string) string {
		cls := "ghost"
		if f.Status == key {
			cls = ""
		}
		return fmt.Sprintf(`<a href="/admin/feedback?status=%s"><button type="button" class="%s">%s</button></a>`, key, cls, label)
	}
	all := f.Status == ""
	allCls := "ghost"
	if all {
		allCls = ""
	}
	fmt.Fprintf(&b, `<div class="row" style="margin:18px 0 6px"><a href="/admin/feedback"><button type="button" class="%s">全 部</button></a>%s%s%s</div>`,
		allCls, tab("new", "待处理"), tab("done", "已处理"), tab("ignored", "已忽略"))

	if len(rows) == 0 {
		b.WriteString(`<div class="empty">没有反馈。</div>`)
		return layout("反馈", "feedback", who, b.String())
	}

	b.WriteString(`<div class="panel"><table>
<tr><th>ID</th><th>玩家</th><th>平台</th><th>内容</th><th>截图</th><th>位置</th><th>状态</th><th>时间</th></tr>`)
	for _, r := range rows {
		// 内容截断：列表里只需要看出"在说什么"，全文在详情页
		preview := r.Content
		if len([]rune(preview)) > 40 {
			preview = string([]rune(preview)[:40]) + "…"
		}
		img := "—"
		if r.HasImage {
			img = "有图"
		}
		where := r.Scene
		if r.LevelIdx != 0 {
			where += fmt.Sprintf(" · 第 %d 关", r.LevelIdx)
		}
		if where == "" {
			where = "—"
		}
		fmt.Fprintf(&b, `<tr>
<td class="mono">%d</td>
<td><a href="/admin/players/%d">%s</a></td>
<td>%s</td>
<td><a href="/admin/feedback/%d">%s</a></td>
<td>%s</td><td class="mono">%s</td><td>%s</td><td class="mono">%s</td></tr>`,
			r.ID, r.UID, esc(nickOr(r.Nickname, r.UID)), platTag(r.Platform),
			r.ID, esc(preview), img, esc(where),
			feedbackStatusTag(r.Status), fmtTime(r.CreatedAt))
	}
	b.WriteString(`</table>`)

	// 分页
	pages := (total + int64(f.Size) - 1) / int64(f.Size)
	if pages > 1 {
		b.WriteString(`<div class="pager">`)
		prevCls, nextCls := "", ""
		if f.Page <= 1 {
			prevCls = " dis"
		}
		if int64(f.Page) >= pages {
			nextCls = " dis"
		}
		fmt.Fprintf(&b, `<a class="%s" href="/admin/feedback?status=%s&page=%d">上一页</a>`,
			prevCls, f.Status, f.Page-1)
		fmt.Fprintf(&b, `<span class="mono">%d / %d</span>`, f.Page, pages)
		fmt.Fprintf(&b, `<a class="%s" href="/admin/feedback?status=%s&page=%d">下一页</a>`,
			nextCls, f.Status, f.Page+1)
		b.WriteString(`</div>`)
	}
	b.WriteString(`</div>`)

	return layout("反馈", "feedback", who, b.String())
}

// FeedbackDetailPage 单条反馈详情。
//
// 图片走 `<img src="/admin/feedback/{id}/image">` 而不是内联 base64：
// 内联会让 HTML 变成几百 KB，且浏览器无法缓存。
func FeedbackDetailPage(db *core.DB, who string, id int64) string {
	r, ctx, err := LoadFeedbackDetail(db, id)
	if err != nil {
		return layout("反馈", "feedback", who, `<div class="empty">反馈不存在。</div>`)
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<h1>反馈 #%d</h1><div class="sub"><a href="/admin/feedback">← 返回列表</a></div>`, r.ID)

	b.WriteString(`<div class="panel"><h2>内容<span>` +
		esc(fmtTime(r.CreatedAt)) + ` · ` + feedbackStatusTag(r.Status) + `</span></h2>`)
	b.WriteString(`<div style="white-space:pre-wrap;line-height:1.72;font-size:15px">` + esc(r.Content) + `</div>`)
	b.WriteString(`</div>`)

	if r.HasImage {
		b.WriteString(`<div class="panel"><h2>截图</h2>`)
		fmt.Fprintf(&b, `<img src="/admin/feedback/%d/image" alt="反馈截图" `+
			`style="max-width:100%%;border-radius:12px;border:1px solid var(--line)">`, r.ID)
		b.WriteString(`<div class="hint">点图可在新标签打开原图。</div></div>`)
	}

	// 现场信息
	b.WriteString(`<div class="panel"><h2>现场<span>排查用</span></h2><table>`)
	fmt.Fprintf(&b, `<tr><th>玩家</th><td><a href="/admin/players/%d">%s</a> (#%d)</td></tr>`, r.UID, esc(nickOr(r.Nickname, r.UID)), r.UID)
	fmt.Fprintf(&b, `<tr><th>平台</th><td>%s</td></tr>`, platTag(r.Platform))
	fmt.Fprintf(&b, `<tr><th>位置</th><td>%s</td></tr>`, esc(r.Scene))
	fmt.Fprintf(&b, `<tr><th>关号</th><td>%d</td></tr>`, r.LevelIdx)
	if ctx != "" {
		fmt.Fprintf(&b, `<tr><th>客户端</th><td class="mono" style="word-break:break-all">%s</td></tr>`, esc(ctx))
	}
	b.WriteString(`</table></div>`)

	// 操作
	b.WriteString(`<form method="post" action="/admin/feedback/status">`)
	fmt.Fprintf(&b, `<input type="hidden" name="id" value="%d">`, r.ID)
	b.WriteString(`<div class="savebar"><span class="savelabel">标记为：</span>`)
	if r.Status != "done" {
		b.WriteString(`<button type="submit" name="status" value="done">已处理</button>`)
	}
	if r.Status != "ignored" {
		b.WriteString(`<button type="submit" name="status" value="ignored" class="ghost">忽略</button>`)
	}
	if r.Status != "new" {
		b.WriteString(`<button type="submit" name="status" value="new" class="ghost">退回待处理</button>`)
	}
	b.WriteString(`</div></form>`)

	return layout(fmt.Sprintf("反馈 #%d", r.ID), "feedback", who, b.String())
}

// feedbackStatusTag 状态标签。
func feedbackStatusTag(s string) string {
	switch s {
	case "new":
		return `<span style="color:var(--gold,#D4AF6A)">待处理</span>`
	case "done":
		return `<span style="color:#8FBF9A">已处理</span>`
	case "ignored":
		return `<span style="color:var(--ink3,#7A7468)">已忽略</span>`
	default:
		return esc(s)
	}
}

// sniffImageMime 按文件头判图片类型。
//
// 不猜类型：微信压缩图是 jpeg，安卓相机可能是 jpeg 或 png，截图工具还可能是 webp。
// 一律回 `image/jpeg` 的话 png 会在浏览器里显示成裂图（而且不报错）。
func sniffImageMime(b []byte) string {
	if len(b) >= 8 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' {
		return "image/png"
	}
	if len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF {
		return "image/jpeg"
	}
	if len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return "image/webp"
	}
	if len(b) >= 6 && string(b[0:3]) == "GIF" {
		return "image/gif"
	}
	return "application/octet-stream"
}
