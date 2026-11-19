package admin

import (
	"fmt"
	"html"
	"strings"
	"time"
)

// 后台的样式：深色数据台，复用游戏的秘色天青色板。
//
// ## 为什么不引前端框架
//
// 要看的就四类数据：总览数字、平台对比、玩家列表、关卡明细。
// 这类「表格 + 几个数」的界面，服务端渲染 + 少量原生 JS 最省事：
//   - 没有构建步骤（改一行刷新就见效）
//   - 没有依赖升级焦虑（后台不是产品，不该占维护预算）
//   - 首屏快（直出 HTML）
//
// 代价是筛选要刷新页面 —— 但后台本来就该「点一下看一次」，
// 不需要 SPA 那种丝滑。
//
// ## 视觉为什么跟游戏同一套色
//
// 运营一天里在游戏和后台之间来回看。两套完全不同的配色
// 会让人每次切换都要重新适应。用同一套深釉 + 鎏金，
// 至少「哪里是数字、哪里是标签」的视觉语法是一致的。
// 但**不做动效** —— 后台要的是读数快，不是好看。
const adminCSS = `
:root{
  --page:#0C1310; --well:#16241E; --well2:#1A2B23; --well3:#0F1915;
  --ink:#E4EDE6; --ink2:#B9B2A4; --ink3:#7A7468;
  --gold:#D4AF6A; --gold2:#F2DCA8; --gold3:#B8945A;
  --seal:#C04B33; --jade:#93B3A2;
  --line:rgba(147,179,162,.14); --line2:rgba(147,179,162,.08);
}
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:var(--page);
  background-image:radial-gradient(1200px 500px at 50% -10%,rgba(212,175,106,.05),transparent 60%);
  color:var(--ink);
  font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  font-size:14px;line-height:1.6;font-weight:300;
}
a{color:var(--gold);text-decoration:none}
a:hover{color:var(--gold2)}
.wrap{max-width:1280px;margin:0 auto;padding:28px 24px 60px}

/* 顶栏 */
.top{display:flex;align-items:center;gap:20px;padding-bottom:18px;margin-bottom:24px;
  border-bottom:1px solid var(--line)}
.top .brand{font-family:"Songti SC",serif;font-size:17px;letter-spacing:.28em;color:var(--gold2);font-weight:600}
.top nav{display:flex;gap:4px;flex-wrap:wrap}
.top nav a{padding:6px 14px;border-radius:8px;font-size:13px;letter-spacing:.08em;color:var(--ink2)}
.top nav a:hover{background:rgba(212,175,106,.08);color:var(--gold2)}
.top nav a.on{background:rgba(212,175,106,.14);color:var(--gold2);font-weight:500}
.top .who{margin-left:auto;font-size:12px;color:var(--ink3);letter-spacing:.1em}

/* 标题 */
h1{font-family:"Songti SC",serif;font-size:24px;letter-spacing:.16em;font-weight:600;margin-bottom:6px}
.sub{font-size:12px;color:var(--ink3);letter-spacing:.08em;margin-bottom:22px}

/* 数字卡 */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:24px}
.card{background:linear-gradient(160deg,var(--well2),var(--well3));border:1px solid var(--line);
  border-radius:14px;padding:18px 20px}
.card .k{font-size:11px;letter-spacing:.2em;color:var(--ink3);margin-bottom:8px}
.card .v{font-family:"Songti SC",serif;font-size:30px;font-weight:700;color:var(--gold2);letter-spacing:.02em}
.card .v small{font-size:14px;color:var(--ink3);margin-left:4px;letter-spacing:.06em}
.card .d{font-size:11px;color:var(--ink3);margin-top:6px;letter-spacing:.06em}
.card.hot .v{color:var(--ink)}

/* 表格 */
.panel{background:rgba(22,36,30,.55);border:1px solid var(--line);border-radius:14px;
  padding:18px 20px;margin-bottom:20px;overflow:hidden}
.panel h2{font-family:"Songti SC",serif;font-size:15px;letter-spacing:.2em;
  color:var(--ink);margin-bottom:14px;font-weight:600}
.panel h2 span{font-size:11px;color:var(--ink3);letter-spacing:.1em;margin-left:10px;font-family:inherit;font-weight:300}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;font-size:11px;letter-spacing:.18em;
  color:var(--gold3);padding:8px 10px;border-bottom:1px solid rgba(212,175,106,.22);white-space:nowrap}
td{padding:10px;border-bottom:1px solid var(--line2);color:var(--ink2);vertical-align:middle}
tr:hover td{background:rgba(212,175,106,.03)}
td.num{font-family:"Songti SC",serif;color:var(--gold2);font-weight:600;font-size:14px}
td.mono{font-family:ui-monospace,monospace;font-size:12px;color:var(--ink3)}
.tag{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;letter-spacing:.1em}
.tag.wx{background:rgba(147,179,162,.14);color:var(--jade)}
.tag.dy{background:rgba(192,75,51,.14);color:#E08A76}
.tag.web{background:rgba(122,116,104,.16);color:var(--ink2)}
.tag.unk{background:rgba(60,60,60,.2);color:var(--ink3)}
.tag.man{background:rgba(212,175,106,.14);color:var(--gold2)}

/* 进度条 */
.bar{height:8px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden;min-width:60px}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold3),var(--gold2));border-radius:4px}
.rowbar{display:flex;align-items:center;gap:10px}
.rowbar .lbl{width:64px;font-size:12px;color:var(--ink3);flex-shrink:0}
.rowbar .val{width:52px;text-align:right;font-size:12px;color:var(--ink2);flex-shrink:0}

/* 表单 / 按钮 */
input,select{background:rgba(15,25,21,.9);border:1px solid var(--line);border-radius:8px;
  color:var(--ink);padding:7px 12px;font-size:13px;font-family:inherit;outline:none}
input:focus,select:focus{border-color:rgba(212,175,106,.5)}
button{background:linear-gradient(180deg,var(--gold2),var(--gold3));border:none;
  color:#2A2114;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;
  letter-spacing:.12em;cursor:pointer;font-family:inherit}
button:hover{filter:brightness(1.06)}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--ink2);font-weight:400}
.filter{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}

/* 登录 */
.login{max-width:360px;margin:120px auto;padding:32px;background:linear-gradient(160deg,var(--well2),var(--well3));
  border:1px solid var(--line);border-radius:16px}
.login h1{text-align:center;font-size:20px;margin-bottom:24px}
.login label{display:block;font-size:11px;letter-spacing:.2em;color:var(--ink3);margin:14px 0 6px}
.login input{width:100%}
.login button{width:100%;margin-top:22px;padding:11px}
.err{color:#E08A76;font-size:12px;margin-top:12px;text-align:center;min-height:18px}

/* 分页 */
.pager{display:flex;gap:8px;align-items:center;margin-top:16px;font-size:12px;color:var(--ink3)}
.pager a{padding:5px 12px;border:1px solid var(--line);border-radius:6px}
.pager a.dis{opacity:.35;pointer-events:none}

.empty{text-align:center;padding:40px 20px;color:var(--ink3);font-size:13px;line-height:2}
.empty b{color:var(--gold);font-weight:500}
.hint{font-size:11px;color:var(--ink3);letter-spacing:.06em;line-height:1.9;padding:12px 14px;
  background:rgba(212,175,106,.04);border:1px solid rgba(212,175,106,.14);border-radius:10px;margin-bottom:16px}
.hint b{color:var(--gold2);font-weight:500}
`

// layout 包一层页面骨架。
func layout(title, active, who, body string) string {
	nav := []struct{ href, label, key string }{
		{"/admin", "总览", "overview"},
		{"/admin/platform", "分平台", "platform"},
		{"/admin/players", "玩家", "players"},
		{"/admin/levels", "关卡", "levels"},
		{"/admin/ads", "广告", "ads"},
	}
	var navHTML strings.Builder
	for _, n := range nav {
		cls := ""
		if n.key == active {
			cls = ` class="on"`
		}
		fmt.Fprintf(&navHTML, `<a href="%s"%s>%s</a>`, n.href, cls, n.label)
	}

	whoHTML := ""
	if who != "" {
		whoHTML = fmt.Sprintf(`<span class="who">%s · <a href="/admin/logout">退出</a></span>`, esc(who))
	}

	return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>` + esc(title) + ` · 指尖舞后台</title>
<style>` + adminCSS + `</style></head><body><div class="wrap">
<div class="top"><span class="brand">指尖舞 · 数据台</span><nav>` + navHTML.String() + `</nav>` + whoHTML + `</div>
` + body + `
</div></body></html>`
}

// esc 转义 HTML（昵称是用户可控内容，不转义会 XSS）。
func esc(s string) string { return html.EscapeString(s) }

// pct 把百分比格式化成一位小数。
func pct(v float64) string { return fmt.Sprintf("%.1f%%", v) }

// num 千分位。
func num(v int64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	s := fmt.Sprintf("%d", v)
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}

// money 把「分」转成「元」显示，两位小数。
func money(fen int64) string {
	neg := fen < 0
	if neg {
		fen = -fen
	}
	s := fmt.Sprintf("%d.%02d", fen/100, fen%100)
	if neg {
		return "-" + s
	}
	return s
}

// platTag 平台标签。
func platTag(code int) string {
	switch code {
	case PlatformWechat:
		return `<span class="tag wx">微信</span>`
	case PlatformDouyin:
		return `<span class="tag dy">抖音</span>`
	case PlatformWeb:
		return `<span class="tag web">Web</span>`
	default:
		return `<span class="tag unk">未知</span>`
	}
}

// fmtTime 时间格式化（后台不显示秒，够用）。
func fmtTime(t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	return t.Format("01-02 15:04")
}

// LoginPage 渲染登录页。
func LoginPage(errMsg string) string {
	errHTML := ""
	if errMsg != "" {
		errHTML = `<div class="err">` + esc(errMsg) + `</div>`
	} else {
		errHTML = `<div class="err"></div>`
	}
	return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 · 指尖舞后台</title><style>` + adminCSS + `</style></head><body>
<form class="login" method="post" action="/admin/login">
  <h1>数据后台</h1>
  <label>账号</label><input name="user" autocomplete="username" autofocus>
  <label>密码</label><input name="password" type="password" autocomplete="current-password">
  <button type="submit">登 录</button>
  ` + errHTML + `
</form></body></html>`
}
