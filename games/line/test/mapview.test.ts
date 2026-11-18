import { describe, it, expect } from 'vitest';
import {
  WORLDS as MAP_WORLDS, createMapState, mapNodePos, visibleRange, pickMapNode, scrollToLevel,
  worldOf, nodeY, nodeX, levelNear, stepMapScroll, camXOf, screenXOf,
  railGeometry, railScrollAt, railYOf, pickRail, RAIL,
  ROUTE_TOP, VIEW_BOTTOM, nodeRadius, screenYOf, FLIP_BASE, SCENE,
} from '../src/ui/mapview';
import { mapPalette } from '../src/render/mapstyle';
import { THEMES } from '../src/render/themes';
import { WORLDS as COVER_WORLDS } from '../src/core/cover/v3/generate';

/** 四态里最大的视觉半径（当前金珠 26）。 */
const MAX_R = 26;

/** 卡片左缘（节点圆心不能比它更左，否则半个圆被裁掉）。 */
const SCENE_LEFT = SCENE.x;

/**
 * 模拟「把视图滚到 `lv` 关」时的相机横移量。
 *
 * 相机的输入是 `scrollY`（视野中心落在哪一关），不是关号 ——
 * 直接传关号会让「滚到第 300 关」变成「只看第 300 那一小段」，
 * 所以这里统一用 `scrollToLevel` 换算。
 */
const camAtLevel = (lv: number, count = 1000): number => camXOf(scrollToLevel(lv), count);

describe('关卡地图', () => {
  it('节点在屏幕视野内（横向相机跟随，节点不会跑出卡片）', () => {
    // 相机把当前关锚在卡片 42% 处。任何一关成为「当前关」时，
    // 它自己和前后各 8 关都必须还落在卡片的可视横向范围内。
    for (let cur = 5; cur <= 400; cur += 7) {
      const cam = camAtLevel(cur);
      for (let i = cur - 8; i <= cur + 8; i++) {
        if (i < 1) continue;
        const sx = screenXOf(nodeX(i), cam);
        // 左边留一点余量（卡左缘 44）；右边不能压进导轨手势区
        expect(sx, `cur=${cur} i=${i}`).toBeGreaterThan(SCENE_LEFT - MAX_R);
        expect(sx, `cur=${cur} i=${i}`).toBeLessThan(RAIL.hitLeft - MAX_R);
      }
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

  it('蜿蜒：长卷上的 x 真的在动，不是一根直线', () => {
    // 相邻节点的世界 x 必须有变化 —— 全等就退回成一条竖直的斜坡
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

  it('一屏（15 关）在屏幕上横向至少走 180：路径不是一根竖线', () => {
    // 看的是**玩家实际看到的**那一屏：以某关为当前关（相机锚定它），
    // 数它 ±7 关在屏幕上的横向跨度。
    for (let cur = 10; cur + 7 <= 400; cur += 3) {
      const cam = camAtLevel(cur);
      let min = Infinity;
      let max = -Infinity;
      for (let i = cur - 7; i <= cur + 7; i++) {
        const sx = screenXOf(nodeX(i), cam);
        min = Math.min(min, sx);
        max = Math.max(max, sx);
      }
      expect(max - min, `cur=${cur}`).toBeGreaterThanOrEqual(180);
    }
  });

  it('一屏里要有 2~5 个弯：照设计稿的「盘山路」，不是弹簧也不是直尺', () => {
    // 设计稿 02 屏的 16 个节点折了 4 次 —— 这才是「路是人踩出来的」的来源。
    // 少了成直尺，多了成弹簧。
    // 现在看的是屏幕坐标（相机锚定当前关），因为玩家看到的就是这一段。
    for (let cur = 10; cur + 7 <= 400; cur += 3) {
      const cam = camAtLevel(cur);
      let turns = 0;
      let last = 0;
      for (let i = cur - 7; i < cur + 7; i++) {
        const dx = screenXOf(nodeX(i + 1), cam) - screenXOf(nodeX(i), cam);
        if (Math.abs(dx) < 6) continue; // 拐点附近的小抖动不算一次转向
        const sign = dx > 0 ? 1 : -1;
        if (last !== 0 && sign !== last) turns++;
        last = sign;
      }
      expect(turns, `cur=${cur}`).toBeGreaterThanOrEqual(2);
      expect(turns, `cur=${cur}`).toBeLessThanOrEqual(5);
    }
  });

  it('整条路持续向右上：长卷上的 x 单调推进，不是左右来回荡的弹簧', () => {
    // ## 这条改了语义
    //
    // 旧版要求「每 15 关窗口中位数递增」，本质是在问
    // 「屏幕上的路是不是在往右挪」。但加横向相机之后，屏幕上的路
    // **本来就不该往右挪** —— 相机跟着走，画面永远是当前关附近的那一段。
    //
    // 真正的意图是「这条路整体在往右上延伸，而不是原地绕圈」，所以要量
    // **世界坐标**：任意 100 关的窗口，最右端都要比前一个窗口更靠右。
    // 因为 `nodeX` 里 `ROUTE_SLOPE * i` 是严格递增项，蜿蜒只是叠在上面的
    // 有界扰动（|wobble| ≤ 138），所以窗口端点必然稳定右移。
    const wins: number[] = [];
    for (let s = 1; s + 100 <= 1000; s += 100) {
      wins.push(Math.max(...Array.from({ length: 100 }, (_, k) => nodeX(s + k))));
    }
    const rising = wins.slice(1).filter((v, i) => v > wins[i]).length;
    expect(rising).toBe(wins.length - 1);
  });

  it('起点在左下、终点在右上（长卷方向）', () => {
    // 世界坐标里 x 必须随关号推进：第 1000 关远在第 1 关的右边。
    expect(nodeX(1)).toBeLessThan(250);
    expect(nodeX(1000)).toBeGreaterThan(nodeX(1) + 800);
  });

  it('相机锚点不越界：任何一关成为当前关时，它都落在卡片的舒适区', () => {
    // 节点半径最大 26（当前关金珠）。相机把它锚在卡片宽度的 42% 处，
    // 所以要检验的是**屏幕坐标**始终在卡片内、且不压导轨手势区。
    for (let i = 1; i <= 1000; i++) {
      const sx = screenXOf(nodeX(i), camAtLevel(i));
      expect(sx - MAX_R, `lv=${i}`).toBeGreaterThanOrEqual(SCENE.x);
      expect(sx + MAX_R, `lv=${i}`).toBeLessThanOrEqual(RAIL.hitLeft);
    }
  });

  it('净漂移为正：长卷整体向右推进，蜿蜒只是叠在上面的扰动', () => {
    // 有了 `ROUTE_SLOPE·i` 这一项，任意足够长的区间里
    // 「向右的总路程」必然大于「向左的总路程」——
    // 蜿蜒（|wobble| ≤ A1+A2）是有界的，基线是无界的，长程上一定赢。
    // 用 200 关（远大于两个主周期）来量，避免被单个波峰带偏。
    let right = 0;
    let left = 0;
    for (let i = 1; i < 200; i++) {
      const d = nodeX(i + 1) - nodeX(i);
      if (d > 0) right += d;
      else left -= d;
    }
    expect(right).toBeGreaterThan(left);
    // 净位移也要明显为正（不是「来回抵消后勉强为正」）
    expect(nodeX(200) - nodeX(1)).toBeGreaterThan(150);
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
    // 命中判定吃的是**屏幕坐标**，所以要先过相机
    const sx = screenXOf(p.x, camXOf(st.scrollY, st.levelCount));
    expect(pickMapNode(sx, screenYOf(p.y, st.scrollY), st)).toBe(3);
    expect(pickMapNode(5, 5, st)).toBe(-1);
  });

  it('点到两关之间的空处，只会落到这两关之一', () => {
    const st = createMapState(5, 1000, {});
    const cam = camXOf(st.scrollY, st.levelCount);
    const a = mapNodePos(3);
    const b = mapNodePos(4);
    const ax = screenXOf(a.x, cam);
    const bx = screenXOf(b.x, cam);
    const ay = screenYOf(a.y, st.scrollY);
    const by = screenYOf(b.y, st.scrollY);
    // 行距 70、触控半径下限 36 —— 相邻两颗的命中圈本来就相交，
    // 中间那块地不属于「空地」，属于「最近的那一关」。
    // 这里要守的是：**不能因为指偏而选中更远的关**。
    const hit = pickMapNode((ax + bx) / 2, (ay + by) / 2, st);
    expect([3, 4]).toContain(hit);
    // 明显偏到隔壁的世界（离得远）就必须落空
    expect(pickMapNode(5, 5, st)).toBe(-1);
  });

  it('路面走廊没有死带：按在两关之间一定按得到某一关', () => {
    // 折返的陡崖段里，相邻两关横向能差 110+，两枚半径 36 的命中圈接不上。
    // 这不是新公式带来的病 —— 旧公式实测前 400 关里有 194 对相邻节点
    // 的命中圈不相交，一半的地图都有「按下去没反应」的死带。
    //
    // 所以命中判定加了一档「路面走廊」：按在看得见的路面上，
    // 归给最近的那一关。这条守的就是「任何一屏里都没有点不中的路」。
    const st = createMapState(5, 1000, {});
    for (const scrollY of [0, 30000, 61000]) {
      st.scrollY = scrollY;
      const cam = camXOf(st.scrollY, st.levelCount);
      const { first, last } = visibleRange(st.scrollY, st.levelCount);
      for (let i = first; i < last; i++) {
        const a = mapNodePos(i);
        const b = mapNodePos(i + 1);
        const ax = screenXOf(a.x, cam);
        const bx = screenXOf(b.x, cam);
        const ay = screenYOf(a.y, st.scrollY);
        const by = screenYOf(b.y, st.scrollY);
        // 取中点（死带最深处）
        const hit = pickMapNode((ax + bx) / 2, (ay + by) / 2, st);
        expect(hit).toBeGreaterThanOrEqual(i);
        expect(hit).toBeLessThanOrEqual(i + 1);
      }
    }
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
    const cam = camXOf(st.scrollY, st.levelCount);
    const p1 = mapNodePos(1);
    expect(pickMapNode(screenXOf(p1.x, cam), screenYOf(p1.y, st.scrollY), st)).toBe(1);
    const p3 = mapNodePos(3);
    expect(pickMapNode(screenXOf(p3.x, cam), screenYOf(p3.y, st.scrollY), st)).toBe(3);
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
    expect(nodeRadius(40, 0, st)).toBe(23);       // 当前
    expect(nodeRadius(39, 0, st)).toBe(17);       // 已过
    expect(nodeRadius(41, 800, st)).toBe(16);     // 未至
    expect(nodeRadius(50, 800, st)).toBe(20);     // 里程碑
    // 同一个节点画在任何高度都一样大
    expect(nodeRadius(41, ROUTE_TOP, st)).toBe(nodeRadius(41, VIEW_BOTTOM, st));
  });

  it('百关大圈半径 33，优先级压过当前关（整百关上的当前关画的也是大圈）', () => {
    const st = createMapState(40, 1000, {});
    expect(nodeRadius(100, 800, st)).toBe(33);     // 百关大圈
    expect(nodeRadius(200, 800, st)).toBe(33);
    const st100 = createMapState(100, 1000, {});
    expect(nodeRadius(100, 0, st100)).toBe(33);    // 当前关落在 100：仍是大圈（金面变体）
    expect(nodeRadius(110, 800, st100)).toBe(20);  // 未至整十小盘照旧
    expect(nodeRadius(90, 800, st100)).toBe(17);   // 已过的整十关随已过关走
    expect(nodeRadius(101, 800, st100)).toBe(16);
  });

  it('节点命中半径有 36 下限（≥ 半个行距，不能留死带）', () => {
    const st = createMapState(1, 1000, {});
    const p = mapNodePos(1);
    const sx = screenXOf(p.x, camXOf(st.scrollY, st.levelCount));
    const y = screenYOf(p.y, st.scrollY);
    expect(pickMapNode(sx, y, st)).toBe(1);
    expect(pickMapNode(sx + 30, y, st)).toBe(1);
    expect(pickMapNode(sx + 40, y, st)).toBe(-1);
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
