package admin

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/tupss/f-game/server/internal/core"
	"github.com/tupss/f-game/server/internal/games/line"
)

// 后台「配置」页。
//
// ## 为什么是两张并排的卡，而不是一个平台一个下拉
//
// 微信和抖音的广告位、分享域名**必须能一眼对照**：
// 运营最常犯的错就是把微信的 adunit 填到抖音那栏（两端不共用，
// 混填的表现是「广告点了没反应」，几乎不可能从日志上看出来）。
// 并排摆着，两边一眼对比，比在两个页面之间来回切安全得多。
//
// ## 为什么只有一个「保存全部」
//
// 两个平台一次提交。分成两个保存按钮的话，
// 「保存微信成功、保存抖音失败」会留下两份不同步的配置，
// 而运营通常不会回头再点第二次。提交走一个事务（见 SavePlatformConfigs）。

// maxThemeRows 表单里最多容纳的主题行数。
//
// 现在只有 2 套主题，但解锁条件是**会加新主题**的配置项，
// 每次都改后台代码不现实。多给几行空位，加主题时运营自己填。
//
// 上限 12 是防止有人构造超长表单把解析拖慢（页面本身只画
// 现有主题 + 3 行空白，这个上限只是防御）。
const maxThemeRows = 12

// configPlatforms 后台可编辑的平台（顺序即页面顺序）。
//
// Web 不单独维护：它走默认值（`line.DefaultPlatformConfig`），
// 本地调试/落地页不需要另配一套广告位。
var configPlatforms = []int{line.PlatformWechat, line.PlatformDouyin}

// ConfigPage 渲染配置页。
//
// cfgs 为 nil 时从库里读；POST 校验失败时传入**刚提交的值**，
// 让运营看到自己填错的那一格，而不是被清空重填。
func ConfigPage(db *core.DB, who string, cfgs map[int]line.PlatformConfig, notice, errMsg string) string {
	banner := ""
	if errMsg != "" {
		banner += `<div class="hint" style="border-color:rgba(192,75,51,.4);color:#E08A76"><b>保存失败：</b>` + esc(errMsg) + `</div>`
	}
	if notice != "" {
		banner += `<div class="hint"><b>` + esc(notice) + `</b></div>`
	}

	if cfgs == nil {
		var errs []error
		cfgs, errs = LoadAllPlatformConfigs(db, configPlatforms)
		if len(errs) > 0 {
			banner += `<div class="hint" style="border-color:rgba(192,75,51,.4);color:#E08A76"><b>部分配置读取失败，显示的是默认值：</b>` + esc(errs[0].Error()) + `</div>`
		}
	}
	meta := PlatformConfigUpdatedAt(db)

	var b strings.Builder
	b.WriteString(`<h1>平台配置</h1>`)
	b.WriteString(`<div class="sub">按平台下发的运营参数 · 客户端启动时按自身平台拉取 <code>/api/config?platform=</code></div>`)
	b.WriteString(`<div class="hint">appid / secret 是<b>凭证</b>，不在这张表里 —— 仍由 yaml 与环境变量管理。这里只放运营会调的参数。</div>`)
	b.WriteString(banner)

	b.WriteString(`<form method="post" action="/admin/config"><div class="cols">`)
	for _, p := range configPlatforms {
		cfg := cfgs[p]
		at := ""
		if m, ok := meta[p]; ok && !m.At.IsZero() {
			at = m.At.Format("2006-01-02 15:04")
		}
		b.WriteString(renderCard(p, cfg, at, meta[p].Who))
	}
	b.WriteString(`</div>`)
	b.WriteString(`<div class="savebar"><button type="submit">保存全部</button>
		<span class="savelabel">保存后客户端重新启动（或刷新）才生效</span></div></form>`)

	return layout("配置", "config", who, b.String())
}

// formPrefix 表单字段前缀。
//
// 两个平台在一张表单里，字段名必须能区分 —— 否则后出现的
// `ad_rewardedVideoId` 会覆盖前一个，保存后两份配置变成一样，
// 而且是「微信的值跑到抖音去」这种最难察觉的错。
func formPrefix(platform int) string {
	if platform == line.PlatformDouyin {
		return "dy_"
	}
	return "wx_"
}

// formHasPlatform 判断这次提交里有没有该平台的字段。
//
// ## 为什么要判
//
// 一次提交会为**两个平台**各构造一份配置（`ReadPlatformForm`）。
// 如果表单里根本没有某个平台的字段，读出来的就是
// 「开关全关 + 主题为空 + 广告位空」—— 保存后那个平台等于被静默下线。
//
// 正常浏览器提交不会这样（两张卡在同一张表单里），但两种情况下会：
//   - 手写 / 脚本调用只带了一个平台（运维脚本、curl 调试）
//   - 页面渲染时某个平台卡片出错（只剩另一半的表单）
//
// 这时正确的行为是**保持原值**，而不是把它清空。
func formHasPlatform(v url.Values, prefix string) bool {
	for k := range v {
		if strings.HasPrefix(k, prefix) {
			return true
		}
	}
	return false
}

// renderCard 渲染单个平台卡片。
func renderCard(platform int, cfg line.PlatformConfig, updatedAt, updatedBy string) string {
	name := "微信"
	if platform == line.PlatformDouyin {
		name = "抖音"
	}
	prefix := formPrefix(platform)

	field := func(key, label, value, kind string) string {
		t := "text"
		if kind != "" {
			t = kind
		}
		return `<div class="field"><label>` + esc(label) + `</label><input name="` + prefix + key +
			`" type="` + t + `" value="` + esc(value) + `"></div>`
	}
	num := func(key, label string, v int) string {
		return field(key, label, strconv.Itoa(v), "number")
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<section class="panel"><h2>%s<span>%s</span></h2>`, name, platformNote(platform))
	if updatedAt != "" {
		who := updatedBy
		if who == "" {
			who = "—"
		}
		fmt.Fprintf(&b, `<div class="stamp">最近修改 %s · %s</div>`, esc(updatedAt), esc(who))
	}

	b.WriteString(`<h3>分享</h3>`)
	b.WriteString(field("shareUrlPrefix", "分享链接前缀（https://…，留空则用当前页面地址）", cfg.ShareURLPrefix, "url"))

	b.WriteString(`<h3>广告位</h3>`)
	b.WriteString(field("ad_rewardedVideoId", "激励视频广告位 ID", cfg.Ad.RewardedVideoID, ""))
	b.WriteString(field("ad_interstitialId", "插屏广告位 ID", cfg.Ad.InterstitialID, ""))
	b.WriteString(field("ad_bannerId", "Banner 广告位 ID", cfg.Ad.BannerID, ""))

	b.WriteString(`<h3>频控</h3><div class="grid2">`)
	b.WriteString(num("ad_interstitialIntervalSec", "插屏最小间隔（秒）", cfg.Ad.InterstitialIntervalSec))
	b.WriteString(num("ad_rewardedDailyLimit", "激励视频每日上限（0=不限）", cfg.Ad.RewardedDailyLimit))
	b.WriteString(num("ad_hintFreeUses", "每关免费提示次数（0=首次看广告，付一次后本关免费）", cfg.Ad.HintFreeUses))
	b.WriteString(num("ad_skipDailyLimit", "每日跳关上限（0=不限）", cfg.Ad.SkipDailyLimit))
	b.WriteString(`</div>`)

	b.WriteString(`<h3>功能开关</h3><div class="switches">`)
	b.WriteString(checkbox(prefix+"feat_hint", "提示", cfg.Features.Hint))
	b.WriteString(checkbox(prefix+"feat_skip", "跳过", cfg.Features.Skip))
	b.WriteString(checkbox(prefix+"feat_shareChallenge", "分享挑战", cfg.Features.ShareChallenge))
	b.WriteString(checkbox(prefix+"feat_mechIntro", "机制首见说明", cfg.Features.MechIntro))
	b.WriteString(`</div>`)
	b.WriteString(`<div class="tablehint">「机制首见说明」是在关卡里**第一次遇到**某种机制（单向门 / 星屑 / 钥匙门 / 传送门 / 冰面）时弹的一次性说明卡。首次出现在哪一关由客户端解码关卡表**自动推导**，不需要逐关配置；关掉这个开关则全部不弹。</div>`)

	b.WriteString(`<h3>主题解锁</h3>`)
	b.WriteString(`<div class="tablehint">只改「什么时候解锁」。主题本体（贴图 / 音效）在客户端包里；id 要对得上客户端，写错 id 的那行会被忽略。当前客户端认得的 id：<b>` + esc(knownThemeIDs()) + `</b>。</div>`)
	b.WriteString(`<table class="themes"><thead><tr><th>id</th><th>名称</th><th>解锁方式</th><th>关号</th></tr></thead><tbody>`)
	rows := cfg.Themes
	// 多给 3 行空位：加新主题时不用改后台代码
	for i := 0; i < 3; i++ {
		rows = append(rows, line.ThemeConfig{})
	}
	for i, t := range rows {
		if i >= maxThemeRows {
			break
		}
		p := prefix + "theme_" + strconv.Itoa(i) + "_"
		fmt.Fprintf(&b, `<tr>
<td><input name="%sid" value="%s" placeholder="mise"></td>
<td><input name="%sname" value="%s" placeholder="秘色天青"></td>
<td><select name="%sunlock">%s</select></td>
<td><input name="%svalue" type="number" value="%s"></td>
</tr>`, p, esc(t.ID), p, esc(t.Name), p, unlockOptions(t.Unlock), p, themeValue(t))
	}
	b.WriteString(`</tbody></table>`)

	b.WriteString(`</section>`)
	return b.String()
}

// platformNote 卡片右上角的一句话说明。
func platformNote(platform int) string {
	if platform == line.PlatformDouyin {
		return "广告位与微信不共用"
	}
	return "1200×628 分享卡 · 主投平台"
}

// unlockOptions 解锁方式下拉。
//
// 顺序固定为「免费 / 里程碑 / 广告」：从最宽松到最需要付出，
// 和运营心里的阶梯一致。
func unlockOptions(cur string) string {
	opts := []struct{ v, label string }{
		{"free", "免费"},
		{"milestone", "里程碑关号"},
		{"ad", "看广告"},
	}
	var b strings.Builder
	for _, o := range opts {
		sel := ""
		if o.v == cur {
			sel = " selected"
		}
		fmt.Fprintf(&b, `<option value="%s"%s>%s</option>`, o.v, sel, o.label)
	}
	return b.String()
}

// themeValue 关号输入框的值。非里程碑一律留空（存 0 会让人以为能填）。
func themeValue(t line.ThemeConfig) string {
	if t.Unlock != "milestone" {
		return ""
	}
	return strconv.Itoa(t.Value)
}

// checkbox 一个开关。
func checkbox(name, label string, on bool) string {
	checked := ""
	if on {
		checked = " checked"
	}
	return `<label><input type="checkbox" name="` + name + `"` + checked + `>` + esc(label) + `</label>`
}

// ReadPlatformForm 从表单解析一个平台的配置。
//
// base 是**当前值**：表单里留空的数字栏按当前值处理，
// 这样「只想改广告位」不会把频控顺手清成 0。
//
// 这是纯函数（不碰 DB），所以能在没有数据库的情况下测。
func ReadPlatformForm(v url.Values, prefix string, base line.PlatformConfig) line.PlatformConfig {
	get := func(key string) string { return strings.TrimSpace(v.Get(prefix + key)) }
	// checkbox 未勾选时字段根本不存在 —— 拿不到 "false"，只能判空
	on := func(key string) bool { return v.Get(prefix+key) != "" }

	cfg := line.PlatformConfig{
		ShareURLPrefix: get("shareUrlPrefix"),
		Ad: line.AdConfig{
			RewardedVideoID:         get("ad_rewardedVideoId"),
			InterstitialID:          get("ad_interstitialId"),
			BannerID:                get("ad_bannerId"),
			InterstitialIntervalSec: line.ParseIntForm(get("ad_interstitialIntervalSec"), base.Ad.InterstitialIntervalSec),
			RewardedDailyLimit:      line.ParseIntForm(get("ad_rewardedDailyLimit"), base.Ad.RewardedDailyLimit),
			HintFreeUses:            line.ParseIntForm(get("ad_hintFreeUses"), base.Ad.HintFreeUses),
			SkipDailyLimit:          line.ParseIntForm(get("ad_skipDailyLimit"), base.Ad.SkipDailyLimit),
		},
		Features: line.FeaturesConfig{
			Hint:           on("feat_hint"),
			Skip:           on("feat_skip"),
			ShareChallenge: on("feat_shareChallenge"),
			MechIntro:      on("feat_mechIntro"),
		},
	}

	// 主题行：id 为空的行视为「没填」，忽略（页面上本来就多留了几行空位）
	for i := 0; i < maxThemeRows; i++ {
		p := prefix + "theme_" + strconv.Itoa(i) + "_"
		id := strings.TrimSpace(v.Get(p + "id"))
		if id == "" {
			continue
		}
		cfg.Themes = append(cfg.Themes, line.ThemeConfig{
			ID:     id,
			Name:   strings.TrimSpace(v.Get(p + "name")),
			Unlock: strings.TrimSpace(v.Get(p + "unlock")),
			Value:  line.ParseIntForm(v.Get(p+"value"), 0),
		})
	}

	// 归一化交给 line.PlatformConfig.Normalize（写入前还会再跑一次）：
	// 这里先归一化，是为了让「保存失败」时回显的就是最终会存下的值。
	return cfg.Normalize()
}

// knownThemeIDs 后台页面上提示用的「客户端认得的主题 id」。
//
// ## 为什么不直接校验、只给提示
//
// 真理源在客户端（`render/themes/index.ts` 的 `THEMES`），服务端只存
// 「什么时候解锁」。在服务端硬校验等于把主题清单复制一份 ——
// 客户端加了新主题、服务端没跟着改，正确的配置反而会被拒。
//
// 而完全不提又不行：id 写错的行**不会报错**，只是永远不生效
// （玩家看不到这个主题，运营以为配了）。所以在输入框旁边把当前
// 已知的 id 列出来，让「写错」在保存前就能看出来。
//
// 这份清单来自 `DefaultPlatformConfig()`，与服务端默认配置同源；
// 它落后于客户端时只会让提示不全，不会影响保存。
func knownThemeIDs() string {
	themes := line.DefaultPlatformConfig().Themes
	ids := make([]string, 0, len(themes))
	for _, t := range themes {
		ids = append(ids, t.ID)
	}
	return strings.Join(ids, " / ")
}
