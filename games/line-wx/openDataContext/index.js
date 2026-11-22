/**
 * 微信开放数据域：好友榜。
 *
 * ## 它为什么必须是一个独立文件
 *
 * 开放数据域运行在**另一个 JS 环境**里：没有 `document`、不能 import 主域模块、
 * 只能用 `wx.*`，画到 `sharedCanvas` 上。主域把这个 canvas 用 `drawImage`
 * 贴进自己的版面（`ui/leaderboard.ts`）。所以这里的配色/字号是**手抄**的，
 * 不能从 `ui/leaderboard.ts` 引常量 —— 这是这套架构的固有代价。
 *
 * ## 尺寸由主域给
 *
 * `sharedCanvas` 的尺寸由主域设置，改完 `postMessage({type:'resize'})`
 * 通知这里重画。**不要**按固定 90px 格子画：主域给的是设计像素宽（约 660），
 * 照 90px 画只占左边一小块，右边一片空白。
 *
 * ## 为什么只画首字圆球，不加载头像
 *
 * `wx.createImage()` 是异步的：首帧画不了头像，`onload` 回来又得整张重画，
 * 连续几次会闪。主域自己的榜单（`ui/leaderboard.ts`）用的就是
 * "玉球 + 首字"，这里跟它一致反而更像同一个游戏。
 */

var ctx = wx.getOpenDataContext();
var canvas = ctx.canvas;

/** 数据缓存：主域每帧都会触发绘制，不能每帧拉一次好友数据。 */
var cache = { at: 0, list: [] };
var REFRESH_MS = 30000;

function palette() {
  return {
    ink: '#E4EDE6',
    dim: '#B9B2A4',
    muted: '#7A7468',
    gold: '#D4AF6A',
    goldHi: '#F2DCA8',
    rowBg: 'rgba(22,36,30,0.70)',
    rowLine: 'rgba(147,179,162,0.12)',
  };
}

function roundRect(c, x, y, w, h, r) {
  var rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function drawAvatar(c, cx, cy, r, name) {
  var g = c.createRadialGradient(cx - r * 0.34, cy - r * 0.44, r * 0.05, cx, cy, r * 1.1);
  g.addColorStop(0, '#DCEBDD');
  g.addColorStop(0.36, '#9FB8A8');
  g.addColorStop(0.7, '#547F6B');
  g.addColorStop(1, '#22452F');
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = g;
  c.fill();

  var ch = (name || '玩').slice(0, 1);
  c.save();
  c.font = '900 ' + Math.round(r * 0.92) + 'px serif';
  c.fillStyle = '#1D3A2E';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(ch, cx, cy + 1);
  c.restore();
}

function drawList(list) {
  var P = palette();
  var W = canvas.width;
  var H = canvas.height;
  var c = canvas.getContext('2d');
  c.clearRect(0, 0, W, H);
  var pad = 4;
  var titleH = 46;
  var rowH = Math.max(56, Math.min(72, Math.round((H - titleH - 16) / 7)));
  var rowGap = 8;

  // 标题行
  c.save();
  c.font = '600 22px serif';
  c.fillStyle = P.dim;
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillText('好友榜', pad + 4, titleH - 10);
  c.textAlign = 'right';
  c.fillStyle = P.muted;
  c.font = '400 18px serif';
  c.fillText(list.length ? list.length + ' 位好友' : '', W - pad - 4, titleH - 12);
  c.restore();

  if (!list.length) {
    c.save();
    c.font = '600 22px serif';
    c.fillStyle = P.muted;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('还没有好友数据，分享给好友一起来玩', W / 2, H / 2);
    c.restore();
    return;
  }

  var maxRows = Math.floor((H - titleH - 8 + rowGap) / (rowH + rowGap));
  for (var i = 0; i < list.length && i < maxRows; i++) {
    var f = list[i];
    var y = titleH + i * (rowH + rowGap);
    roundRect(c, pad, y, W - pad * 2, rowH, 20);
    c.fillStyle = P.rowBg;
    c.fill();
    c.strokeStyle = P.rowLine;
    c.lineWidth = 1;
    c.stroke();

    var cy = y + rowH / 2;
    c.save();
    c.font = '500 20px serif';
    c.fillStyle = i < 3 ? P.gold : P.muted;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(i + 1), pad + 34, cy);
    c.restore();

    drawAvatar(c, pad + 78, cy, Math.min(22, rowH * 0.34), f.nickname);

    c.save();
    c.font = '500 21px serif';
    c.fillStyle = P.ink;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    var name = (f.nickname || '好友').slice(0, 8);
    c.fillText(name, pad + 108, cy);
    c.textAlign = 'right';
    c.fillStyle = P.goldHi;
    c.font = '600 21px serif';
    c.fillText('第 ' + f.maxLevel + ' 关', W - pad - 20, cy);
    c.restore();
  }
}

function fetchAndRender(force) {
  var now = Date.now();
  if (!force && now - cache.at < REFRESH_MS) {
    drawList(cache.list);
    return;
  }
  cache.at = now;
  wx.getFriendCloudStorage({
    keyList: ['line_profile'],
    success: function (res) {
      var list = (res.data || [])
        .filter(function (item) {
          return item.KVDataList && item.KVDataList.length > 0;
        })
        .map(function (item) {
          var p = {};
          try {
            p = JSON.parse(item.KVDataList[0].value);
          } catch (e) {
            p = {};
          }
          return {
            nickname: p.nickname || '',
            maxLevel: p.maxLevel || 0,
            totalTimeMs: p.totalTimeMs || 0,
          };
        });
      list.sort(function (a, b) {
        if (b.maxLevel !== a.maxLevel) return b.maxLevel - a.maxLevel;
        return a.totalTimeMs - b.totalTimeMs;
      });
      cache.list = list;
      drawList(list);
    },
    fail: function () {
      // 没授权 / 没有好友：画空态，不要留一张黑屏
      drawList([]);
    },
  });
}

// 主域：改完尺寸后通知重画。
wx.onMessage(function (msg) {
  if (!msg) return;
  if (msg.type === 'resize' || msg.type === 'refresh') {
    fetchAndRender(msg.type === 'refresh');
  }
});

// 首帧先画空态（等好友数据回来之前不要是一片空白）
drawList([]);
fetchAndRender(true);
