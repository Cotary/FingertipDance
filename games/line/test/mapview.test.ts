import { describe, it, expect } from 'vitest';
import {
  WORLDS as MAP_WORLDS, createMapState, mapNodePos, visibleRange, pickMapNode, scrollToLevel,
  worldOf, nodeY, nodeX, levelNear, stepMapScroll,
  railGeometry, railScrollAt, railYOf, pickRail, RAIL,
  ROUTE_TOP, VIEW_BOTTOM, nodeRadius, screenYOf, FLIP_BASE,
} from '../src/ui/mapview';
import { mapPalette } from '../src/render/mapstyle';
import { THEMES } from '../src/render/themes';
import { WORLDS as COVER_WORLDS } from '../src/core/cover/v3/generate';

/** 四态里最大的视觉半径（当前金珠 26）。 */
const MAX_R = 26;

describe('关卡地图', () => {
  it('节点不出界（含节点半径与右侧导轨的手势区）', () => {
    for (let i = 1; i <= 400; i++) {
      const p = mapNodePos(i);
      // 左边至少留 40：再往外就贴屏幕边了
      expect(p.x).toBeGreaterThanOrEqual(40);
      // 右边 690 之后是导轨的手势区，节点压进去就会被导轨抢走点击
      expect(p.x).toBeLessThanOrEqual(RAIL.hitLeft - MAX_R);
    }
  });

  it('相邻节点不重叠', () => {
    for (let i = 1; i < 400; i++) {
      const a = mapNodePos(i);
      const b = mapNodePos(i + 1);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      // 两枚已过关的盘（r20）贴在一起是 40；行距 ±10 抖动 + 横向摆动后
      // 最窄处仍在 42 以上 —— 盘面不叠，只让当前关的外晕压一点邻居
      expect(d).toBeGreaterThan(42);
    }
  });

  it('y 严格单调递增（`visibleRange` 的二分依赖这一条）', () => {
    for (let i = 1; i < 400; i++) expect(nodeY(i + 1)).toBeGreaterThan(nodeY(i));
  });

  it('蜿蜒：整条路不是直线，也不是「同一行四个点」', () => {
    // 相邻节点的 x 必须真的在动 —— 全等就是退回了旧的网格
    let moved = 0;
    for (let i = 1; i < 40; i++) if (Math.abs(nodeX(i + 1) - nodeX(i)) > 20) moved++;
    expect(moved).toBeGreaterThan(20);

    // 但也不能是高频抖动：任意 9 关里必须横跨大半幅振幅（长周期 = 像山路）
    let min = Infinity;
    let max = -Infinity;
    for (let i = 1; i <= 9; i++) {
      min = Math.min(min, nodeX(i));
      max = Math.max(max, nodeX(i));
    }
    expect(max - min).toBeGreaterThan(150);
  });

  it('一屏（15 关）横向至少走 180：路径不是一根竖线', () => {
    // 定稿 02 屏一屏走完 440 设备像素；这条守的是「斜着上山」的下限。
    // 旧版（振幅 198、周期 6.6 关）一屏扫两个来回，跨度虽然够，但方向反了 5 次。
    for (let s = 1; s + 15 <= 400; s += 2) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = s; i < s + 15; i++) {
        min = Math.min(min, nodeX(i));
        max = Math.max(max, nodeX(i));
      }
      expect(max - min).toBeGreaterThanOrEqual(180);
    }
  });

  it('一屏里最多两次方向反转：不再「一屏绕几个弯」', () => {
    // 旧实现（正弦 6.6 关一个来回）一屏反 5 次，读起来是弹簧。
    // 现在是「长腿 + 一次折返」：允许摆动带来的一次小回头，但不许再来第三个。
    for (let s = 1; s + 15 <= 400; s += 2) {
      let turns = 0;
      let last = 0;
      for (let i = s; i < s + 14; i++) {
        const dx = nodeX(i + 1) - nodeX(i);
        if (Math.abs(dx) < 6) continue; // 拐点附近的小抖动不算一次转向
        const sign = dx > 0 ? 1 : -1;
        if (last !== 0 && sign !== last) turns++;
        last = sign;
      }
      expect(turns).toBeLessThanOrEqual(2);
    }
  });

  it('世界边界与 cover 关卡生成器一致', () => {
    // 地图页画的世界门 / 世界名来自 `ui/mapview.ts` 的 WORLDS，
    // 关卡实际的世界划分来自 `core/cover/v3/generate.ts` 的 WORLDS。
    // 两份定义必须锁死，否则玩家会看到「第 33 关进了深井，但深井的机制是星屑」。
    expect(MAP_WORLDS.length).toBe(COVER_WORLDS.length);
    for (let i = 0; i < MAP_WORLDS.length; i++) {
      expect(MAP_WORLDS[i].from).toBe(COVER_WORLDS[i].from);
      expect(MAP_WORLDS[i].to).toBe(COVER_WORLDS[i].to);
    }
    expect(MAP_WORLDS[0].from).toBe(1);
    expect(MAP_WORLDS[MAP_WORLDS.length - 1].to).toBe(1000);
  });

  it('关号能映射到所属世界', () => {
    expect(worldOf(1)).toBe(0);
    expect(worldOf(12)).toBe(0);
    expect(worldOf(13)).toBe(1);
    expect(worldOf(900)).toBe(6);
  });

  it('可视区间随滚动平移', () => {
    const r1 = visibleRange(0, 1000);
    const r2 = visibleRange(scrollToLevel(400), 1000);
    expect(r2.first).toBeGreaterThan(r1.first);
    expect(r2.last).toBeGreaterThan(r1.last);
  });

  it('可视区间不越界', () => {
    const st = createMapState(1, 1000, {});
    const r = visibleRange(st.maxScrollY, 1000);
    expect(r.last).toBeLessThanOrEqual(1000);
    expect(visibleRange(0, 1000).first).toBe(1);
    expect(r.first).toBeGreaterThanOrEqual(1);
  });

  it('一屏 14~18 关（设计稿 31 CSS 行距 → 62）', () => {
    // 第 1 屏的下半张卡是空的（路从下缘起步），所以量中路
    const r = visibleRange(scrollToLevel(400), 1000);
    const n = r.last - r.first + 1;
    // 卡高 972 / 行距 62 ≈ 15.7 屏内，`visibleRange` 再各多带一关（曲线切线要用）
    expect(n).toBeGreaterThanOrEqual(14);
    expect(n).toBeLessThanOrEqual(20);
  });

  it('点击节点能选中关号', () => {
    const st = createMapState(5, 1000, {});
    const p = mapNodePos(3);
    expect(pickMapNode(p.x, screenYOf(p.y, st.scrollY), st)).toBe(3);
    expect(pickMapNode(5, 5, st)).toBe(-1);
  });

  it('点到两关之间的空处，只会落到这两关之一', () => {
    const st = createMapState(5, 1000, {});
    const a = mapNodePos(3);
    const b = mapNodePos(4);
    const ay = screenYOf(a.y, st.scrollY);
    const by = screenYOf(b.y, st.scrollY);
    // 行距 62、触控半径下限 34 —— 相邻两颗的命中圈本来就相交，
    // 中间那块地不属于「空地」，属于「最近的那一关」。
    // 这里要守的是：**不能因为指偏而选中更远的关**。
    const hit = pickMapNode((a.x + b.x) / 2, (ay + by) / 2, st);
    expect([3, 4]).toContain(hit);
    // 明显偏到隔壁的世界（离得远）就必须落空
    expect(pickMapNode(5, 5, st)).toBe(-1);
  });

  it('聚焦当前关的滚动偏移会被夹进合法区间', () => {
    const st = createMapState(5, 1000, {});
    for (const lv of [1, 5, 500, 1000]) {
      // 调用方（main）负责夹上界：最后几关的节点底下没有内容了，
      // 强行居中会滚出「地图之外」的空白，所以只夹到 maxScrollY
      const y = Math.min(st.maxScrollY, scrollToLevel(lv));
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(st.maxScrollY);
    }
    // 中间那些关是真的居中的
    expect(scrollToLevel(500)).toBe(nodeY(500) - (ROUTE_TOP + VIEW_BOTTOM) / 2);
  });

  it('levelNear 能反查滚动中部是哪一关', () => {
    const st = createMapState(1, 1000, {});
    st.scrollY = scrollToLevel(512);
    expect(levelNear(st.scrollY + (ROUTE_TOP + VIEW_BOTTOM) / 2, 1000)).toBe(512);
  });

  it('currentLevel 语义 = 下一个可玩关（不是最高已通关关号）', () => {
    // 服务端 users.max_level 存的是「最高已通关关号」（0 = 没通关过）。
    // 通关第 1 关后它是 1，但下一个该打的是第 2 关。
    // 以前客户端拿 maxLevel 当「当前关」用，整体错一格，玩家以为没保存进度。
    const st = createMapState(2, 1000, { '1': 3 });
    expect(st.currentLevel).toBe(2);
    expect(createMapState(1, 1000, {}).currentLevel).toBe(1);
  });

  it('地图节点三态：已通关 / 当前 / 未解锁（几何上都能命中，拦截在 main）', () => {
    const st = createMapState(2, 1000, { '1': 3 });
    const p1 = mapNodePos(1);
    expect(pickMapNode(p1.x, screenYOf(p1.y, st.scrollY), st)).toBe(1);
    const p3 = mapNodePos(3);
    expect(pickMapNode(p3.x, screenYOf(p3.y, st.scrollY), st)).toBe(3);
  });
});

describe('地图滚动动力学', () => {
  it('甩指会自己停下来，并且不越过边界', () => {
    const st = createMapState(1, 1000, {});
    st.scrollY = 5000;
    st.fling = 4;
    for (let i = 0; i < 200; i++) stepMapScroll(st, 16);
    expect(st.fling).toBe(0);
    expect(st.scrollY).toBeGreaterThan(5000);
    expect(st.scrollY).toBeLessThanOrEqual(st.maxScrollY);
  });

  it('往顶上甩会停在 0，不会穿出上边界', () => {
    const st = createMapState(1, 1000, {});
    st.scrollY = 200;
    st.fling = -5;
    for (let i = 0; i < 200; i++) stepMapScroll(st, 16);
    expect(st.scrollY).toBe(0);
    expect(st.fling).toBe(0);
  });

  it('缓动到目标会真的到达目标，并清空目标', () => {
    const st = createMapState(500, 1000, {});
    st.scrollTarget = scrollToLevel(900);
    for (let i = 0; i < 120; i++) stepMapScroll(st, 16);
    expect(st.scrollTarget).toBeNull();
    expect(Math.abs(st.scrollY - scrollToLevel(900))).toBeLessThan(1);
  });
});

describe('右侧导轨', () => {
  it('滑块始终在轨道内，且有最小可抓高度', () => {
    for (const lv of [1, 300, 999, 1000]) {
      const st = createMapState(lv, 1000, {});
      st.scrollY = scrollToLevel(lv);
      const g = railGeometry(st);
      expect(g.thumbH).toBeGreaterThanOrEqual(RAIL.thumbMinH);
      expect(g.thumbTop).toBeGreaterThanOrEqual(RAIL.top - 0.001);
      expect(g.thumbTop + g.thumbH).toBeLessThanOrEqual(RAIL.top + g.h + 0.001);
    }
  });

  it('拖到轨道顶 = 最后一关，拖到底 = 第 1 关（跟着地图翻转）', () => {
    const st = createMapState(1, 1000, {});
    const g = railGeometry(st);
    expect(railScrollAt(g.top, st, 0)).toBe(st.maxScrollY);
    expect(railScrollAt(g.top + g.h, st, g.thumbH)).toBe(0);
    // 中间是单调的
    const mid = railScrollAt(g.top + g.h / 2, st, g.thumbH / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(st.maxScrollY);
  });

  it('导轨比例是线性的：拖一半就是滚一半', () => {
    const st = createMapState(1, 1000, {});
    const g = railGeometry(st);
    const half = railScrollAt(g.top + (g.h - g.thumbH) / 2, st, 0);
    expect(half).toBeCloseTo(st.maxScrollY / 2, 0);
  });

  it('一屏的滚动距离在导轨上只占很小一段（这正是快速跳转的来源）', () => {
    const st = createMapState(1, 1000, {});
    const g = railGeometry(st);
    // 1000 关时滑块被压到最小高度，说明「整条路远长于屏幕」
    expect(g.thumbH).toBe(RAIL.thumbMinH);
  });

  it('导轨左侧的点击不算导轨（不能抢空格子）', () => {
    const st = createMapState(1, 1000, {});
    expect(pickRail(RAIL.hitLeft - 1, 600, st)).toBeNull();
  });

  it('点滑块返回抓取偏移，点空白处 = 把滑块挪到指下', () => {
    const st = createMapState(1, 1000, {});
    const g = railGeometry(st);
    const onThumb = pickRail(RAIL.center, g.thumbTop + 10, st);
    expect(onThumb?.kind).toBe('scrub');
    expect(onThumb?.grab).toBe(10);

    // 远离滑块与小点 → 直接进入拖动，抓取偏移取滑块半高
    const r = pickRail(RAIL.center, g.top + 40, st);
    expect(r?.kind).toBe('scrub');
    expect(r?.grab).toBe(g.thumbH / 2);
  });

  it('点当前关的小点 = 回到当前（缓动）', () => {
    const st = createMapState(400, 1000, {});
    st.scrollY = 0;
    const hit = pickRail(RAIL.center, railYOf(400, st), st);
    expect(hit?.kind).toBe('current');
    expect(hit?.level).toBe(400);
  });

  it('当前关的圆点落在滑块里（点它就是在点自己）', () => {
    const st = createMapState(400, 1000, {});
    st.scrollY = scrollToLevel(400);
    const g = railGeometry(st);
    const cy = railYOf(400, st);
    expect(cy).toBeGreaterThanOrEqual(g.thumbTop - 1);
    expect(cy).toBeLessThanOrEqual(g.thumbTop + g.thumbH + 1);
  });
});

describe('翻转坐标（往上走 = 走向 ∞）', () => {
  it('翻转轴 = 屏幕中心：内容点画在对称位置', () => {
    const mid = (ROUTE_TOP + VIEW_BOTTOM) / 2;
    expect(FLIP_BASE).toBe(ROUTE_TOP + VIEW_BOTTOM);
    expect(screenYOf(mid, 0)).toBe(mid + (FLIP_BASE - ROUTE_TOP - VIEW_BOTTOM));
    // 内容越小（关号越小）→ 屏幕越靠下
    expect(screenYOf(200, 0)).toBeGreaterThan(screenYOf(400, 0));
  });

  it('滚到当前关时，当前关正好落在卡片中线', () => {
    for (const lv of [1, 5, 400, 1000]) {
      const st = createMapState(lv, 1000, {});
      st.scrollY = Math.min(st.maxScrollY, scrollToLevel(lv));
      const y = screenYOf(nodeY(lv), st.scrollY);
      // 第 1 关受上边界夹取，不强制居中
      if (lv > 80) expect(Math.abs(y - (ROUTE_TOP + VIEW_BOTTOM) / 2)).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(ROUTE_TOP - 1);
      expect(y).toBeLessThanOrEqual(VIEW_BOTTOM + 1);
    }
  });

  it('节点半径是平的：四态各有定值，与位置无关', () => {
    const st = createMapState(40, 1000, {});
    expect(nodeRadius(40, 0, st)).toBe(26);       // 当前
    expect(nodeRadius(39, 0, st)).toBe(20);       // 已过
    expect(nodeRadius(41, 800, st)).toBe(19);     // 未至
    expect(nodeRadius(50, 800, st)).toBe(23);     // 里程碑
    // 同一个节点画在任何高度都一样大
    expect(nodeRadius(41, ROUTE_TOP, st)).toBe(nodeRadius(41, VIEW_BOTTOM, st));
  });

  it('节点命中半径有 34 下限', () => {
    const st = createMapState(1, 1000, {});
    const p = mapNodePos(1);
    const y = screenYOf(p.y, st.scrollY);
    expect(pickMapNode(p.x, y, st)).toBe(1);
    expect(pickMapNode(p.x + 30, y, st)).toBe(1);
    expect(pickMapNode(p.x + 40, y, st)).toBe(-1);
  });
});

describe('地图配色跟随主题', () => {
  const IDS = ['', 'ink', 'glass', 'orbit', 'pixel', 'neon', 'obsidian', 'gilded', 'abyss'];

  it('九种主题都有完整配色，未知 id 回落到默认', () => {
    for (const id of IDS) {
      const p = mapPalette(id);
      expect(p.skyTop.startsWith('#')).toBe(true);
      expect(p.skyBottom.startsWith('#')).toBe(true);
      expect(p.road.startsWith('#')).toBe(true);
      expect(p.world.length).toBe(7);
      for (const c of p.world) expect(c.startsWith('#')).toBe(true);
    }
    expect(mapPalette('theme-that-no-longer-exists').skyTop).toBe(mapPalette('').skyTop);
  });

  it('每套主题的夜空两两不同（不是只换了个名字）', () => {
    const skies = IDS.map((id) => mapPalette(id).skyMid);
    expect(new Set(skies).size).toBe(IDS.length);
  });

  // 这条是回归测试：曾经按中文名把 id 猜成 compass / lava，
  // 真实 id 却是 orbit / obsidian，于是两套典藏主题的地图一直是默认星穹。
  it('注册表里的每一套主题都真的驱动地图（id 不许漂移）', () => {
    const fallback = mapPalette('');
    for (const t of THEMES) {
      const p = mapPalette(t.id);
      expect(p.id, `主题 ${t.id}（${t.name}）没有自己的地图配色`).not.toBe(fallback.id);
      expect(p.skyMid, `${t.id} 的夜空还是默认星穹`).not.toBe(fallback.skyMid);
    }
  });

  it('水墨是单色主题：七个世界色几乎抽干', () => {
    const ink = mapPalette('ink');
    for (const c of ink.world) {
      const n = parseInt(c.slice(1), 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      // 最大通道差 < 24：去饱和到同亮度的灰，只留一点纸暖
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24);
    }
    // 但七个世界仍然要是七个色（抽干 ≠ 塌成一个灰块，靠墨色深浅区分）
    expect(new Set(ink.world).size).toBe(7);
  });

  it('冷色主题的当前关是暖色，不会和已通关糊在一起', () => {
    for (const id of ['glass', 'abyss']) {
      const p = mapPalette(id);
      const n = parseInt(p.current.slice(1), 16);
      expect((n >> 16) & 255).toBeGreaterThan((n & 255) + 40);
    }
  });
});
