package admin

import (
	"fmt"
	"strings"

	"github.com/tupss/f-game/server/internal/core"
)

// OverviewPage 渲染总览页。
//
// ## 这一页只回答三个问题
//
//  1. **有多少人在玩** —— 注册 / 今日新增 / DAU / 次留
//  2. **玩到哪了** —— 进度分布
//  3. **钱从哪来** —— 今日广告收入 / 累计
//
// 低于这三条的指标（比如「平均游戏时长」）不放首页：
// 首页一挤，人就不看了。
func OverviewPage(cfg *core.Config, db *core.DB, who string) string {
	o, err := LoadOverview(db)
	if err != nil {
		return layout("总览", "overview", who, `<div class="empty">查询失败：`+esc(err.Error())+`</div>`)
	}
	hist, _ := LoadProgressHistogram(db)

	var b strings.Builder
	b.WriteString(`<h1>总览</h1><div class="sub">数据实时查询 · 广告数据为平台侧同步，可能延迟一天</div>`)

	// ── 核心数字 ──
	b.WriteString(`<div class="cards">`)
	card := func(k, v, unit, d string, hot bool) {
		cls := "card"
		if hot {
			cls += " hot"
		}
		u := ""
		if unit != "" {
			u = "<small>" + unit + "</small>"
		}
		fmt.Fprintf(&b, `<div class="%s"><div class="k">%s</div><div class="v">%s%s</div><div class="d">%s</div></div>`,
			cls, k, v, u, d)
	}
	card("注册总数", num(o.TotalUsers), "人", fmt.Sprintf("今日新增 %s", num(o.NewToday)), true)
	card("今日活跃", num(o.DAUToday), "人", fmt.Sprintf("近 7 天 %s", num(o.ActiveLast7)), true)
	retD := "昨日无新增"
	if o.NewYesterday > 0 {
		retD = fmt.Sprintf("昨日新增 %s 人", num(o.NewYesterday))
	}
	card("次日留存", pct(o.RetentionD1), "", retD, false)
	card("平均最高关", fmt.Sprintf("%.1f", o.AvgMaxLevel), "关", fmt.Sprintf("有 %s 人通过关", num(o.TotalPlayers)), false)
	card("累计通关", num(o.TotalPasses), "次", "不含跳过", false)
	card("今日广告收入", money(o.AdRevenueFenToday), "元", "平台侧数据", false)
	card("累计广告收入", money(o.AdRevenueFenTotal), "元",
		fmt.Sprintf("曝光 %s · 点击 %s", num(o.AdImpressions), num(o.AdClicks)), false)
	b.WriteString(`</div>`)

	// ── 数据新鲜度提示 ──
	if o.AdSyncedAt.IsZero() {
		b.WriteString(`<div class="hint"><b>广告数据尚未同步。</b>上方广告数字显示为 0 不代表没有收入 ——
		请到「广告」页点「同步」，或用「手工补录」录入。平台接口需要各自的开放平台凭证。</div>`)
	} else {
		b.WriteString(fmt.Sprintf(`<div class="hint">广告数据最近同步于 <b>%s</b>。平台通常延迟一天出数。</div>`,
			esc(o.AdSyncedAt.Format("2006-01-02 15:04"))))
	}

	// ── 进度分布 ──
	b.WriteString(`<div class="panel"><h2>关卡进度分布<span>玩家最高通关关号落在哪一段</span></h2>`)

	// ## 为什么不按最大值归一
	//
	// 「未开始」通常是压倒性的多数（注册完就走的玩家占大头），
	// 按最大值画条的话，其余各段全被压成 1~2px，等于看不见。
	// 但「除了未开始都很少」这个信息本身没有价值 —— 有价值的是
	// **已开始的玩家内部**怎么分布。
	//
	// 所以：条形长度按「已开始玩家里的占比」画，同时把绝对人数和
	// 总占比都写出来。这样一眼能看出「开始玩的人里，多少卡在前 10 关」。
	var started int64
	for _, x := range hist {
		if x.Label != "未开始" {
			started += x.Count
		}
	}
	var totalAll int64
	for _, x := range hist {
		totalAll += x.Count
	}

	for _, x := range hist {
		// 未开始那行按全体占比；其余按「已开始」占比 ——
		// 两种口径在同一张图里并列会误导，所以显式标注分母。
		var w float64
		var pctText string
		if x.Label == "未开始" {
			if totalAll > 0 {
				w = float64(x.Count) / float64(totalAll) * 100
				pctText = pct(w)
			}
		} else if started > 0 {
			w = float64(x.Count) / float64(started) * 100
			pctText = pct(w)
		} else {
			pctText = "—"
		}
		tag := ""
		if x.Label == "未开始" {
			tag = `<span style="color:var(--ink3);font-size:11px">占全体</span>`
		} else {
			tag = `<span style="color:var(--ink3);font-size:11px">占已开始</span>`
		}
		fmt.Fprintf(&b, `<div class="rowbar"><span class="lbl">%s</span>
<div class="bar" style="flex:1"><i style="width:%.1f%%"></i></div>
<span class="val">%s</span><span style="width:44px;text-align:right;font-size:11px;color:var(--ink3)">%s</span>
<span style="width:64px;text-align:right">%s</span></div>`,
			esc(x.Label), w, num(x.Count), pctText, tag)
	}
	b.WriteString(`</div>`)

	return layout("总览", "overview", who, b.String())
}

// PlatformPage 渲染分平台对比。
func PlatformPage(db *core.DB, who string) string {
	rows, err := LoadPlatforms(db)
	if err != nil {
		return layout("分平台", "platform", who, `<div class="empty">查询失败：`+esc(err.Error())+`</div>`)
	}

	var b strings.Builder
	b.WriteString(`<h1>分平台</h1><div class="sub">微信 / 抖音 / Web 三端的注册、活跃与进度对比</div>`)

	if len(rows) == 0 {
		b.WriteString(`<div class="empty">还没有任何注册用户。</div>`)
		return layout("分平台", "platform", who, b.String())
	}

	b.WriteString(`<div class="panel"><h2>平台对比</h2><table>
<tr><th>平台</th><th>注册</th><th>今日新增</th><th>今日活跃</th><th>平均最高关</th><th>通关次数</th><th>广告收入</th></tr>`)
	for _, r := range rows {
		fmt.Fprintf(&b, `<tr>
<td>%s</td><td class="num">%s</td><td class="num">%s</td><td class="num">%s</td>
<td class="num">%.1f</td><td class="num">%s</td><td class="num">%s 元</td></tr>`,
			platTag(r.Code), num(r.TotalUsers), num(r.NewToday), num(r.DAUToday),
			r.AvgMaxLevel, num(r.PassCount), money(r.AdRevenueFen))
	}
	b.WriteString(`</table></div>`)

	b.WriteString(`<div class="hint">「平均最高关」只统计 <b>max_level &gt; 0</b> 的玩家 ——
注册完就走的 0 会把这个均值拉到没有参考价值。</div>`)

	// 有「未知」平台时解释一下，否则运营会以为是 bug。
	hasUnknown := false
	for _, r := range rows {
		if r.Code == PlatformUnknown {
			hasUnknown = true
			break
		}
	}
	if hasUnknown {
		b.WriteString(`<div class="hint"><b>「未知」是什么？</b>
这些是接多平台之前注册的老用户 —— 那时的登录逻辑还不写 platform 字段。
他们下次登录时会自动补上正确平台（见 login 的 <b>platform=0 才补写</b> 逻辑）。
在那之前，把他们当成「历史存量」看就行，不必纠。</div>`)
	}

	return layout("分平台", "platform", who, b.String())
}

// PlayersPage 渲染玩家列表。
func PlayersPage(db *core.DB, who string, f PlayerFilter) string {
	rows, total, err := LoadPlayers(db, f)
	if err != nil {
		return layout("玩家", "players", who, `<div class="empty">查询失败：`+esc(err.Error())+`</div>`)
	}

	var b strings.Builder
	b.WriteString(`<h1>玩家</h1><div class="sub">按最后登录时间倒序 · 共 ` + num(total) + ` 人</div>`)

	// 筛选
	b.WriteString(`<form class="filter" method="get" action="/admin/players">
<input name="q" placeholder="昵称 或 玩家 ID" value="` + esc(f.Search) + `" style="width:200px">
<select name="platform">
<option value="0">全部平台</option>`)
	for _, p := range []struct {
		v int
		n string
	}{{PlatformWechat, "微信"}, {PlatformDouyin, "抖音"}, {PlatformWeb, "Web"}} {
		sel := ""
		if f.Platform == p.v {
			sel = " selected"
		}
		fmt.Fprintf(&b, `<option value="%d"%s>%s</option>`, p.v, sel, p.n)
	}
	b.WriteString(`</select>
<button type="submit">筛 选</button>
<a href="/admin/players"><button type="button" class="ghost">清 空</button></a>
</form>`)

	if len(rows) == 0 {
		b.WriteString(`<div class="empty">没有符合条件的玩家。</div>`)
		return layout("玩家", "players", who, b.String())
	}

	b.WriteString(`<div class="panel"><table>
<tr><th>ID</th><th>昵称</th><th>平台</th><th>最高关</th><th>三星关</th><th>注册</th><th>最后登录</th></tr>`)
	for _, r := range rows {
		fmt.Fprintf(&b, `<tr>
<td class="mono">%d</td>
<td><a href="/admin/players/%d">%s</a></td>
<td>%s</td><td class="num">%d</td><td class="num">%d</td>
<td class="mono">%s</td><td class="mono">%s</td></tr>`,
			r.ID, r.ID, esc(nickOr(r.Nickname, r.ID)), platTag(r.Platform),
			r.MaxLevel, r.StarCount, fmtTime(r.CreatedAt), fmtTime(r.LastLogin))
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
		q := func(p int) string {
			return fmt.Sprintf("/admin/players?page=%d&platform=%d&q=%s", p, f.Platform, urlq(f.Search))
		}
		fmt.Fprintf(&b, `<a class="%s" href="%s">上一页</a><span>第 %d / %d 页</span>`,
			strings.TrimSpace(prevCls), q(f.Page-1), f.Page, pages)
		fmt.Fprintf(&b, `<a class="%s" href="%s">下一页</a>`, strings.TrimSpace(nextCls), q(f.Page+1))
		b.WriteString(`</div>`)
	}
	b.WriteString(`</div>`)

	return layout("玩家", "players", who, b.String())
}

// PlayerDetailPage 渲染玩家详情。
func PlayerDetailPage(db *core.DB, who string, uid int64) string {
	d, err := LoadPlayerDetail(db, uid)
	if err != nil {
		return layout("玩家详情", "players", who,
			`<div class="empty">查不到这个玩家（ID `+fmt.Sprint(uid)+`）。</div>`)
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<h1>%s</h1><div class="sub">玩家 ID %d · %s</div>`,
		esc(nickOr(d.Nickname, d.ID)), d.ID, platTag(d.Platform))

	b.WriteString(`<div class="cards">`)
	card := func(k, v, unit, dd string) {
		u := ""
		if unit != "" {
			u = "<small>" + unit + "</small>"
		}
		fmt.Fprintf(&b, `<div class="card"><div class="k">%s</div><div class="v">%s%s</div><div class="d">%s</div></div>`,
			k, v, u, dd)
	}
	card("最高关卡", fmt.Sprint(d.MaxLevel), "关", "已通关的最高关号")
	card("通关 / 跳过", fmt.Sprintf("%d / %d", d.PassCount, d.SkipCount), "", "跳过不给星")
	card("累计重来", num(d.UndoTotal), "次", "越低越好")
	card("看广告", num(d.AdWatchCnt), "次", "激励视频")
	card("挑战战绩", fmt.Sprintf("%d 胜 %d 负", d.ChallengeWins, d.ChallengeLoses), "", "好友挑战")
	b.WriteString(`</div>`)

	// 最近记录
	b.WriteString(`<div class="panel"><h2>最近记录<span>最近 20 条</span></h2>`)
	if len(d.RecentLevels) == 0 {
		b.WriteString(`<div class="empty">还没有通关记录。</div>`)
	} else {
		b.WriteString(`<table><tr><th>关卡</th><th>重来</th><th>用时</th><th>状态</th><th>时间</th></tr>`)
		for _, r := range d.RecentLevels {
			st := "通过"
			if r.Skipped {
				st = "跳过"
			}
			fmt.Fprintf(&b, `<tr><td class="num">%d</td><td class="num">%d</td>
<td class="mono">%.1fs</td><td>%s</td><td class="mono">%s</td></tr>`,
				r.LevelIdx, r.Undos, float64(r.TimeMs)/1000, st, fmtTime(r.CreatedAt))
		}
		b.WriteString(`</table>`)
	}
	b.WriteString(`</div>`)

	fmt.Fprintf(&b, `<div class="hint">注册于 %s · 最后登录 %s</div>`,
		esc(d.CreatedAt.Format("2006-01-02 15:04")), esc(fmtTime(d.LastLogin)))

	return layout("玩家详情", "players", who, b.String())
}

// LevelsPage 渲染关卡明细。
//
// ## 这一页用来找「卡点」
//
// 通关率明显低于前后的那几关，就是玩家流失的地方。
// 按关号排序（不是按通关率），因为要看的是**曲线**的形状。
func LevelsPage(db *core.DB, who string, limit int) string {
	rows, err := LoadLevels(db, limit)
	if err != nil {
		return layout("关卡", "levels", who, `<div class="empty">查询失败：`+esc(err.Error())+`</div>`)
	}

	var b strings.Builder
	b.WriteString(`<h1>关卡</h1><div class="sub">按关号排列 · 通关率 = 通过人数 / 打到前一关的人数</div>`)

	if len(rows) == 0 {
		b.WriteString(`<div class="empty">还没有任何通关记录。</div>`)
		return layout("关卡", "levels", who, b.String())
	}

	b.WriteString(`<div class="panel"><table>
<tr><th>关卡</th><th>通过人数</th><th>通关率</th><th>平均重来</th><th>零重来</th><th>跳过</th></tr>`)
	for _, r := range rows {
		// 通关率为 0 通常意味着「没人打到这关」而不是「全失败」，
		// 显示成「—」比显示 0% 诚实。
		rate := "—"
		if r.PassRate > 0 {
			rate = pct(r.PassRate)
		}
		fmt.Fprintf(&b, `<tr><td class="num">%d</td><td class="num">%s</td>
<td class="num">%s</td><td class="num">%.1f</td>
<td class="mono">%d</td><td class="mono">%d</td></tr>`,
			r.LevelIdx, num(r.Players), rate, r.AvgUndos, r.ZeroUndos, r.SkipCount)
	}
	b.WriteString(`</table></div>`)

	b.WriteString(`<div class="hint">只列出<b>有通关记录</b>的关（最多 100 条）。
通关率显示「—」表示还没有玩家打到这一关。</div>`)

	return layout("关卡", "levels", who, b.String())
}

// AdsPage 渲染广告数据。
func AdsPage(db *core.DB, who string, days int) string {
	rows, err := LoadAds(db, days)
	if err != nil {
		return layout("广告", "ads", who, `<div class="empty">查询失败：`+esc(err.Error())+`</div>`)
	}

	var b strings.Builder
	b.WriteString(`<h1>广告</h1><div class="sub">最近 ` + fmt.Sprint(days) + ` 天 · 数据来自平台侧接口或手工补录</div>`)

	// 汇总
	var sumRev, sumImp, sumClk int64
	for _, r := range rows {
		sumRev += r.RevenueFen
		sumImp += r.Impressions
		sumClk += r.Clicks
	}
	b.WriteString(`<div class="cards">`)
	card := func(k, v, unit, dd string) {
		u := ""
		if unit != "" {
			u = "<small>" + unit + "</small>"
		}
		fmt.Fprintf(&b, `<div class="card"><div class="k">%s</div><div class="v">%s%s</div><div class="d">%s</div></div>`,
			k, v, u, dd)
	}
	card("区间收入", money(sumRev), "元", fmt.Sprintf("最近 %d 天", days))
	card("曝光", num(sumImp), "次", "广告展示")
	card("点击", num(sumClk), "次", "点击数")
	// eCPM = 收入(元) / 曝光 × 1000。
	//
	// ## 单位必须换算
	//
	// `sumRev` 是**分**，eCPM 的行业口径是**元**。
	// 直接用分去算会放大 100 倍（1250 分 / 1200 次 × 1000 = 1041.67，
	// 而真实值只有 1.04 元）—— 这种错误在报表里极其危险，
	// 因为它看起来"像个数"，不会有人怀疑。
	ecpm := "—"
	if sumImp > 0 {
		ecpm = fmt.Sprintf("%.2f", float64(sumRev)/100/float64(sumImp)*1000)
	}
	card("eCPM", ecpm, "元", "每千次曝光收入")
	b.WriteString(`</div>`)

	if len(rows) == 0 {
		b.WriteString(`<div class="panel"><div class="empty">
还没有广告数据。<br><br>
<b>数据从哪来？</b><br>
平台侧接口自动同步（需要开放平台凭证），或者在下面手工补录。<br>
平台通常延迟一天出数，今天的数据明天才能看到。
</div></div>`)
	} else {
		b.WriteString(`<div class="panel"><h2>明细</h2><table>
<tr><th>日期</th><th>平台</th><th>类型</th><th>广告位</th><th>曝光</th><th>点击</th><th>收入</th><th>来源</th></tr>`)
		for _, r := range rows {
			src := `<span class="tag man">手工</span>`
			if r.Source == "api" {
				src = `<span class="tag wx">同步</span>`
			}
			adType := r.AdType
			if adType == "" {
				adType = "合计"
			}
			pl := r.Placement
			if pl == "" {
				pl = "—"
			}
			fmt.Fprintf(&b, `<tr><td class="mono">%s</td><td>%s</td><td>%s</td><td class="mono">%s</td>
<td class="num">%s</td><td class="num">%s</td><td class="num">%s 元</td><td>%s</td></tr>`,
				r.Day.Format("2006-01-02"), platTag(r.Platform), esc(adType), esc(pl),
				num(r.Impressions), num(r.Clicks), money(r.RevenueFen), src)
		}
		b.WriteString(`</table></div>`)
	}

	// 同步按钮 + 手工补录表单
	b.WriteString(`<div class="panel"><h2>同步<span>从平台接口拉最近 30 天</span></h2>
<form method="post" action="/admin/ads/sync" style="margin-bottom:12px">
<button type="submit">立即同步</button>
</form>
<div class="hint">同步在后台异步执行，点完等几秒刷新本页即可。
<b>mock 模式下会跳过</b>（本地没有真实凭证）；生产环境配好 appid/secret 后才会真正拉数据。</div>
</div>`)

	b.WriteString(`<div class="panel"><h2>手工补录<span>平台接口拿不到时用这个</span></h2>
<form class="filter" method="post" action="/admin/ads/manual">
<select name="platform"><option value="1">微信</option><option value="2">抖音</option></select>
<input name="day" placeholder="2026-11-20" style="width:130px">
<select name="adType"><option value="rewarded">激励视频</option><option value="interstitial">插屏</option><option value="banner">Banner</option><option value="">合计</option></select>
<input name="placement" placeholder="广告位（可空）" style="width:150px">
<input name="impressions" placeholder="曝光" style="width:90px">
<input name="clicks" placeholder="点击" style="width:90px">
<input name="revenueYuan" placeholder="收入(元)" style="width:100px">
<button type="submit">补 录</button>
</form>
<div class="hint">补录的行标记为「手工」，不会被自动同步覆盖。
<b>收入填「元」</b>（如 12.50），入库统一转成「分」。</div>
</div>`)

	return layout("广告", "ads", who, b.String())
}

// orDash 空值显示成破折号。
func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

// nickOr 昵称为空时给一个可辨识的占位。
//
// ## 为什么不显示「—」
//
// 老数据的昵称是空的（微信登录时没拿到用户信息）。
// 整列全是「—」时，运营无法区分「这个人没昵称」和
// 「这里渲染坏了」。带上 ID 至少能定位到人。
func nickOr(name string, uid int64) string {
	if strings.TrimSpace(name) == "" {
		return fmt.Sprintf("玩家 %d", uid)
	}
	return name
}

// urlq 给 URL 参数做最小转义（只处理会破坏 query 的字符）。
func urlq(s string) string {
	r := strings.NewReplacer("&", "%26", "=", "%3D", "?", "%3F", "#", "%23", " ", "%20", "+", "%2B")
	return r.Replace(s)
}
