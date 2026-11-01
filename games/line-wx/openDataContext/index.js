// 开放数据域：绘制好友榜（独立 JS 环境，只能用 wx.*，不能引用主域任何模块）
const { sharedCanvas } = wx.getOpenDataContext();

const COLS = 3;
const ROWS = 4;
const CELL_W = 90;
const CELL_H = 120;

// 画圆角矩形
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 绘制单个好友卡片
function drawFriend(ctx, friend, x, y, size, rank) {
  ctx.fillStyle = rank <= 3 ? '#3A4460' : '#262D42';
  roundRect(ctx, x, y, size, size, 14);
  ctx.fill();

  if (friend.avatar) {
    const img = wx.createImage();
    img.src = friend.avatar;
    img.onload = function () {
      ctx.save();
      roundRect(ctx, x + size * 0.22, y + size * 0.12, size * 0.56, size * 0.56, size * 0.28);
      ctx.clip();
      ctx.drawImage(img, x + size * 0.22, y + size * 0.12, size * 0.56, size * 0.56);
      ctx.restore();
    };
  }

  ctx.fillStyle = '#E8ECF5';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  const name = friend.nickname ? friend.nickname.slice(0, 4) : '玩家';
  ctx.fillText(name, x + size / 2, y + size * 0.78);

  ctx.fillStyle = '#F2C14E';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('第' + friend.maxLevel + '关', x + size / 2, y + size * 0.93);
}

function render() {
  const ctx = sharedCanvas.getContext('2d');
  ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);
  ctx.fillStyle = '#1E2436';
  ctx.fillRect(0, 0, sharedCanvas.width, sharedCanvas.height);

  wx.getFriendCloudStorage({
    keyList: ['line_profile'],
    success: function (res) {
      const list = (res.data || [])
        .filter(function (item) {
          return item.KVDataList && item.KVDataList.length > 0;
        })
        .map(function (item) {
          const kv = item.KVDataList[0];
          let p = {};
          try {
            p = JSON.parse(kv.value);
          } catch (e) {
            p = {};
          }
          return {
            openid: item.openid,
            nickname: p.nickname || '',
            avatar: p.avatar || '',
            maxLevel: p.maxLevel || 0,
            totalTimeMs: p.totalTimeMs || 0,
            skinCount: p.skinCount || 0,
          };
        });

      list.sort(function (a, b) {
        if (b.maxLevel !== a.maxLevel) return b.maxLevel - a.maxLevel;
        return a.totalTimeMs - b.totalTimeMs;
      });

      const size = CELL_W;
      for (let i = 0; i < list.length && i < COLS * ROWS; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        drawFriend(ctx, list[i], col * (size + 12) + 12, row * (size + 12) + 12, size, i + 1);
      }

      if (list.length === 0) {
        ctx.fillStyle = '#8A94AD';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('还没有好友数据，快去分享给好友吧', sharedCanvas.width / 2, sharedCanvas.height / 2);
      }
    },
    fail: function () {
      console.error('读取好友数据失败');
    },
  });
}

render();
// 定时刷新（好友榜数据不会自动更新）
setInterval(render, 3000);
