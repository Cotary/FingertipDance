/**
 * 地图（星空古路）配色。
 *
 * ## 为什么地图要跟棋盘主题走
 *
 * 地图是全屏页，棋盘主题只换盘面；如果地图永远是一套「深蓝 + 金色」，
 * 玩家装着水墨山河进来，会觉得地图是另一个 App 的截图。
 *
 * 所以这里按**主题 id** 给一套天空 / 路面 / 节点 / 边框的颜色，
 * 每套只改 4~6 个关键色（天空、星色、路面、金色），其余沿用同一份基准。
 * 这样九套主题共用一套构图，换的是「同一个世界观的夜晚」。
 *
 * 判据仍然是灰度的：抽掉颜色，水墨是灰雾、像素是硬点、霓虹是紫黑、
 * 熔岩是暗红，四张灰度图不会混。
 */
export interface MapPalette {
  id: string;
  /** 天空三段色 */
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  /** 星云（rgba，叠加在天空上） */
  nebulaA: string;
  nebulaB: string;
  /** 星点：冷星 / 暖星 */
  star: string;
  starWarm: string;
  /** 远景行星 */
  planet: string;
  planetDark: string;
  planetRing: string;
  /** 路：主色 / 边缘 / 外发光 / 未走 */
  road: string;
  roadEdge: string;
  roadGlow: string;
  roadDim: string;
  /** 路面符文 */
  rune: string;
  /** 未解锁球体 */
  locked: string;
  lockedRim: string;
  /** 当前关（金色主球） */
  current: string;
  currentInk: string;
  /** 世界门 */
  gate: string;
  gateInk: string;
  /** 全局金 */
  gold: string;
  /** 玻璃面板 */
  panel: string;
  panelEdge: string;
  /** 文字 */
  ink: string;
  inkSoft: string;
  /** 七个世界的主色（跑完基础色后按主题路面色再混一次） */
  world: string[];
  /** 单色主题（水墨）：世界色几乎抽干，只留一点冷暖差 */
  mono?: boolean;
  /**
   * 世界色的混合目标（默认 = `road`）与混入比例（默认 0.30）。
   *
   * 金缮那套不能用默认：它的路是**金色**，七个世界往金里混会集体变成
   * 「灰绿 / 灰紫」—— 金路的旁边站着一排脏球。改成往**冷瓷白**混 0.46，
   * 七个世界就成了「七只不同色的瓷球」，和金路是同一间屋子里的东西。
   */
  worldTo?: string;
  worldK?: number;
}

/** 七个世界的基础主色。深色天空上要比黏土版亮一档，否则全糊成灰。 */
const WORLD_BASE = ['#8FE3A8', '#7FC8F0', '#7FE0C4', '#F0906A', '#8C9BE8', '#E8D9B8', '#F2C86A'];

/** 默认：星穹（无主题 / 经典黏土时的地图）。 */
const STAR: MapPalette = {
  id: 'star',
  skyTop: '#05070F',
  skyMid: '#0A1226',
  skyBottom: '#131E38',
  nebulaA: 'rgba(96,74,168,0.30)',
  nebulaB: 'rgba(38,110,132,0.22)',
  star: '#DCE6FF',
  starWarm: '#FFE0A8',
  planet: '#2A3A66',
  planetDark: '#070B16',
  planetRing: 'rgba(232,182,103,0.34)',
  road: '#E8B667',
  roadEdge: '#FFD79A',
  roadGlow: 'rgba(232,182,103,0.20)',
  roadDim: '#B08A50',
  rune: '#FFE6B0',
  locked: '#101A2E',
  lockedRim: 'rgba(160,190,230,0.34)',
  current: '#FFD37A',
  currentInk: '#2A1B08',
  gate: '#8C6A3A',
  gateInk: '#FFF1CE',
  gold: '#E8B667',
  panel: 'rgba(8,12,22,0.78)',
  panelEdge: 'rgba(232,182,103,0.42)',
  ink: '#FFF4DE',
  inkSoft: 'rgba(228,214,188,0.66)',
  world: WORLD_BASE,
};

/** 每套主题只覆盖「换世界」必须变的几个色。 */
const OVERRIDES: Record<string, Partial<MapPalette>> = {
  // 水墨：不是纯黑，是「墨夜」——天是淡墨积出来的灰，路是一线宣纸白
  ink: {
    mono: true,
    skyTop: '#0B0C0C',
    skyMid: '#16191A',
    skyBottom: '#202526',
    nebulaA: 'rgba(210,204,190,0.10)',
    nebulaB: 'rgba(120,126,124,0.12)',
    star: '#F4EFE2',
    starWarm: '#E8DFC9',
    planet: '#2C3030',
    planetDark: '#0B0C0C',
    planetRing: 'rgba(207,199,180,0.22)',
    road: '#CFC7B4',
    roadEdge: '#EFE8D6',
    roadGlow: 'rgba(207,199,180,0.14)',
    roadDim: '#8E887A',
    rune: '#FFF9EC',
    locked: '#15191A',
    lockedRim: 'rgba(220,214,200,0.28)',
    current: '#F2EADA',
    currentInk: '#1A1B1A',
    gate: '#4A4E4C',
    gateInk: '#F4EFE2',
    gold: '#C9BFA6',
    panel: 'rgba(10,11,11,0.82)',
    panelEdge: 'rgba(207,199,180,0.34)',
    ink: '#F7F2E6',
    inkSoft: 'rgba(226,220,206,0.62)',
  },
  // 金缮瓷盘：地图是「盘外的那片靛天」。
  //
  // 关键一条：**路是金的**。地图上唯一一条路，正好是这只盘被金漆补过的那道缝 ——
  // 棋盘里「走过 = 金线」，地图上「整条古路 = 金线」，两边是同一件事。
  // 所以这里不写 road 的常规做法（往 skyMid 混），直接把金交给它。
  kintsugi: {
    skyTop: '#050B13',
    skyMid: '#0C1A2A',
    skyBottom: '#17293C',
    nebulaA: 'rgba(56,96,140,0.18)',
    nebulaB: 'rgba(120,92,46,0.12)',
    star: '#F4F2E8',
    starWarm: '#E9CC8A',
    // 远景行星用「一只白瓷的球」：在这个主题里，天上的东西也该是瓷的
    planet: '#8C97A0',
    planetDark: '#0A1420',
    planetRing: 'rgba(233,204,138,0.26)',
    road: '#A8813A',
    roadEdge: '#E9CC8A',
    roadGlow: 'rgba(233,204,138,0.20)',
    roadDim: '#6B5228',
    rune: '#FFF6DC',
    locked: '#0B1926',
    lockedRim: 'rgba(160,190,214,0.26)',
    current: '#E9CC8A',
    currentInk: '#1A1206',
    gate: '#1E4B6E',
    gateInk: '#F5F4ED',
    gold: '#E9CC8A',
    panel: 'rgba(8,15,24,0.84)',
    panelEdge: 'rgba(233,204,138,0.34)',
    ink: '#F2F1EA',
    inkSoft: 'rgba(206,212,214,0.64)',
    // 世界色往冷瓷白混，不往金混 —— 见 `worldTo` 的说明
    worldTo: '#C6D2DC',
    worldK: 0.46,
  },
  // 秘色天青：地图是「展柜上方的那片墨石夜」。
  //
  // 和金缮同一条道理：**路是金的**——盘面走过的金缮光迹，在地图上
  // 延伸成整条古道。世界球往「青白瓷」混：七只瓷球 + 一条金路，
  // 同一间展柜里的东西。
  mise: {
    skyTop: '#060B08',
    skyMid: '#0C1712',
    skyBottom: '#13241B',
    nebulaA: 'rgba(110,158,130,0.14)',
    nebulaB: 'rgba(184,144,69,0.08)',
    star: '#EDE7DA',
    starWarm: '#E9CC8A',
    // 远景行星：一颗青石球
    planet: '#3D5F50',
    planetDark: '#060B08',
    planetRing: 'rgba(184,144,69,0.22)',
    road: '#B89045',
    roadEdge: '#F2DCA8',
    roadGlow: 'rgba(242,220,168,0.20)',
    roadDim: '#6E5218',
    rune: '#FFF6DC',
    locked: '#0B1410',
    lockedRim: 'rgba(150,180,162,0.24)',
    current: '#F2DCA8',
    currentInk: '#2A2114',
    gate: '#2D5245',
    gateInk: '#EDE7DA',
    gold: '#E9CC8A',
    panel: 'rgba(8,14,11,0.86)',
    panelEdge: 'rgba(212,175,106,0.30)',
    ink: '#EDE7DA',
    inkSoft: 'rgba(197,191,175,0.64)',
    // 世界色往青白瓷混，不往金混 —— 金路旁边站一排脏球就毁了
    worldTo: '#C2D2C4',
    worldK: 0.42,
  },
  // 鸣沙丹青：暮色沙原。
  //
  // 地图不能跟着棋盘一起变亮：地图是"夜空 + 路"，一页暖沙会把世界球和
  // 未解锁球全洗没。所以只把**色相**搬过来 —— 天从蓝黑换成暖褐黑、
  // 星从冷白换成土白、路是沥金，世界色往「壁土」混而不是往金混
  // （和金缮同一条道理：金路旁边站一排脏球就毁了）。
  mingsha: {
    skyTop: '#0D0A07',
    skyMid: '#1B1410',
    skyBottom: '#2E2116',
    nebulaA: 'rgba(181,71,46,0.13)',
    nebulaB: 'rgba(201,155,63,0.11)',
    star: '#F2E4C6',
    starWarm: '#E8C87E',
    // 远景行星：一颗赭石球
    planet: '#7A5634',
    planetDark: '#0D0A07',
    planetRing: 'rgba(201,155,63,0.26)',
    road: '#C99B3F',
    roadEdge: '#F0C868',
    roadGlow: 'rgba(240,200,104,0.18)',
    roadDim: '#6B4C18',
    rune: '#FFF0C8',
    locked: '#1B1410',
    lockedRim: 'rgba(201,155,63,0.26)',
    current: '#E8C87E',
    currentInk: '#2A1E10',
    gate: '#4C6E56',
    gateInk: '#F2E8D4',
    gold: '#E2B558',
    panel: 'rgba(24,17,11,0.87)',
    panelEdge: 'rgba(201,155,63,0.32)',
    ink: '#F2E8D4',
    inkSoft: 'rgba(214,192,160,0.66)',
    worldTo: '#D8C4A0',
    worldK: 0.36,
  },
  // 玻璃穹顶：极地夜空，星是冰蓝
  glass: {
    skyTop: '#04121C',
    skyMid: '#082B3C',
    skyBottom: '#0C3F52',
    nebulaA: 'rgba(60,190,220,0.22)',
    nebulaB: 'rgba(120,220,255,0.14)',
    star: '#DFFBFF',
    starWarm: '#BFF3FF',
    planet: '#1D5C74',
    planetDark: '#04121C',
    planetRing: 'rgba(143,233,255,0.30)',
    road: '#8FE9FF',
    roadEdge: '#D6FAFF',
    roadGlow: 'rgba(143,233,255,0.22)',
    roadDim: '#4E8FA3',
    rune: '#FFFFFF',
    locked: '#0A2230',
    lockedRim: 'rgba(160,235,255,0.35)',
    current: '#FFE8B0',
    currentInk: '#2A1B08',
    gate: '#2C7C93',
    gateInk: '#E8FEFF',
    gold: '#7FE3FF',
    panel: 'rgba(4,20,30,0.76)',
    panelEdge: 'rgba(143,233,255,0.40)',
    ink: '#EAFDFF',
    inkSoft: 'rgba(190,238,250,0.66)',
  },
  // 像素街机：8-bit 太空，绿路 + 黄星
  pixel: {
    skyTop: '#04050B',
    skyMid: '#0A0D18',
    skyBottom: '#111827',
    nebulaA: 'rgba(80,60,140,0.18)',
    nebulaB: 'rgba(40,120,90,0.16)',
    star: '#D8FF6A',
    starWarm: '#FFF3A0',
    planet: '#24406B',
    planetDark: '#05070D',
    planetRing: 'rgba(216,255,106,0.26)',
    road: '#6FE08A',
    roadEdge: '#C8FF9E',
    roadGlow: 'rgba(111,224,138,0.18)',
    roadDim: '#3C7A50',
    rune: '#EAFFC0',
    locked: '#0C1220',
    lockedRim: 'rgba(150,200,170,0.30)',
    current: '#FFE066',
    currentInk: '#241C05',
    gate: '#2F6B45',
    gateInk: '#EAFFC0',
    gold: '#FFE066',
    panel: 'rgba(6,8,14,0.84)',
    panelEdge: 'rgba(216,255,106,0.36)',
    ink: '#F2FFD8',
    inkSoft: 'rgba(200,220,180,0.62)',
  },
  // 圆格罗盘：蓝色星图，路是一道冷蓝缎带
  //
  // 注意 id 是 `orbit` 不是 `compass`。之前按中文名猜成 compass，
  // 结果这套主题在地图上一直回落默认星穹（2026-11-14 修）。
  orbit: {
    skyTop: '#03070E',
    skyMid: '#081426',
    skyBottom: '#0E2140',
    nebulaA: 'rgba(110,168,255,0.20)',
    nebulaB: 'rgba(200,220,255,0.10)',
    star: '#EAF3FF',
    starWarm: '#B4CFFF',
    planet: '#1B3560',
    planetDark: '#03070E',
    planetRing: 'rgba(110,168,255,0.30)',
    road: '#6EA8FF',
    roadEdge: '#DCEBFF',
    roadGlow: 'rgba(110,168,255,0.20)',
    roadDim: '#3A5C8A',
    rune: '#EAF3FF',
    locked: '#0A1424',
    lockedRim: 'rgba(140,180,240,0.32)',
    current: '#FFE9A8',
    currentInk: '#2A1B08',
    gate: '#24406C',
    gateInk: '#EAF3FF',
    gold: '#9CC4FF',
    panel: 'rgba(6,12,22,0.80)',
    panelEdge: 'rgba(110,168,255,0.38)',
    ink: '#EAF3FF',
    inkSoft: 'rgba(198,218,255,0.66)',
  },
  // 赛博霓虹：紫黑 + 青路 + 品红边
  neon: {
    skyTop: '#06020E',
    skyMid: '#120728',
    skyBottom: '#1B0B3A',
    nebulaA: 'rgba(177,76,255,0.26)',
    nebulaB: 'rgba(69,240,255,0.18)',
    star: '#FF9DF0',
    starWarm: '#9FF6FF',
    planet: '#3A1E63',
    planetDark: '#06020E',
    planetRing: 'rgba(255,111,224,0.34)',
    road: '#45F0FF',
    roadEdge: '#FF6FE0',
    roadGlow: 'rgba(69,240,255,0.24)',
    roadDim: '#2A6A7A',
    rune: '#FFE6FF',
    locked: '#120A22',
    lockedRim: 'rgba(255,111,224,0.34)',
    current: '#FF6FE0',
    currentInk: '#1A0418',
    gate: '#4A2A7A',
    gateInk: '#F4E6FF',
    gold: '#B14CFF',
    panel: 'rgba(10,4,20,0.80)',
    panelEdge: 'rgba(255,111,224,0.44)',
    ink: '#FDEBFF',
    inkSoft: 'rgba(220,180,240,0.66)',
  },
  // 黑曜熔岩：暗红天 + 橙路（id 是 `obsidian`，不是 `lava`）
  obsidian: {
    skyTop: '#040304',
    skyMid: '#0B0A0C',
    skyBottom: '#1A0D08',
    nebulaA: 'rgba(255,120,60,0.18)',
    nebulaB: 'rgba(120,30,10,0.24)',
    star: '#FFD9B0',
    starWarm: '#FFB067',
    planet: '#3A1A10',
    planetDark: '#040304',
    planetRing: 'rgba(255,120,60,0.28)',
    road: '#FF6B2C',
    roadEdge: '#FFB067',
    roadGlow: 'rgba(255,92,26,0.22)',
    roadDim: '#8A3A1A',
    rune: '#FFE0B0',
    locked: '#140906',
    lockedRim: 'rgba(255,150,100,0.28)',
    current: '#FFC27A',
    currentInk: '#2A0A02',
    gate: '#5A2414',
    gateInk: '#FFE6C4',
    gold: '#FF9A50',
    panel: 'rgba(10,5,4,0.84)',
    panelEdge: 'rgba(255,120,60,0.40)',
    ink: '#FFE6D2',
    inkSoft: 'rgba(255,196,160,0.66)',
  },
  // 金线装饰：深翡翠 + 金线
  gilded: {
    skyTop: '#03110C',
    skyMid: '#071F17',
    skyBottom: '#0C2C22',
    nebulaA: 'rgba(201,162,39,0.16)',
    nebulaB: 'rgba(40,120,90,0.20)',
    star: '#F0DFA8',
    starWarm: '#E8CE7A',
    planet: '#1B3B30',
    planetDark: '#03110C',
    planetRing: 'rgba(201,162,39,0.40)',
    road: '#C9A227',
    roadEdge: '#F0DFA8',
    roadGlow: 'rgba(201,162,39,0.20)',
    roadDim: '#6E5A1C',
    rune: '#FFF3CE',
    locked: '#0A1A15',
    lockedRim: 'rgba(201,162,39,0.32)',
    current: '#F5E2A0',
    currentInk: '#241A05',
    gate: '#3E5A44',
    gateInk: '#F5E9C0',
    gold: '#E8CE7A',
    panel: 'rgba(4,16,12,0.82)',
    panelEdge: 'rgba(201,162,39,0.44)',
    ink: '#F7EFD2',
    inkSoft: 'rgba(220,206,160,0.64)',
  },
  // 深海荧光：几乎全黑的蓝绿，路是生物光
  abyss: {
    skyTop: '#02060E',
    skyMid: '#031824',
    skyBottom: '#052A36',
    nebulaA: 'rgba(40,150,150,0.20)',
    nebulaB: 'rgba(30,80,160,0.22)',
    star: '#BFFFE9',
    starWarm: '#7CFFD8',
    planet: '#0B3A46',
    planetDark: '#02060E',
    planetRing: 'rgba(98,232,200,0.28)',
    road: '#39C7B0',
    roadEdge: '#8CFFE4',
    roadGlow: 'rgba(57,199,176,0.22)',
    roadDim: '#1E6B62',
    rune: '#D8FFF4',
    locked: '#04141C',
    lockedRim: 'rgba(120,255,225,0.30)',
    current: '#FFE0A3',
    currentInk: '#2A1B08',
    gate: '#0F4A52',
    gateInk: '#D8FFF4',
    gold: '#62E8C8',
    panel: 'rgba(2,10,16,0.82)',
    panelEdge: 'rgba(98,232,200,0.38)',
    ink: '#E6FFF9',
    inkSoft: 'rgba(180,230,222,0.64)',
  },
};

/** 缓存的成品。地图每帧都要取，不能每帧拼 7 个世界色。 */
const CACHE = new Map<string, MapPalette>();

/** #RRGGBB 混色。 */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number): number => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** 同亮度的灰（Rec.601 亮度）。水墨主题用它把世界色抽干。 */
function grayOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  return `#${((y << 16) | (y << 8) | y).toString(16).padStart(6, '0')}`;
}

/**
 * 取地图配色。
 *
 * 未知 id（老版本存的主题已下线）回落到默认星穹，不抛错。
 */
export function mapPalette(themeId?: string): MapPalette {
  const id = themeId && themeId !== '' ? themeId : 'star';
  const hit = CACHE.get(id);
  if (hit) return hit;

  const o = OVERRIDES[id];
  const base = o ? { ...STAR, ...o, id } : STAR;
  // 用**路面色**而不是金色去染七个世界。
  //
  // 金色在霓虹/水墨里分别是紫和米白，混 35% 会把所有世界拉成灰紫
  // （实测：苔原的薄荷绿 → 灰蓝）。路面色本身带有主题的色相，
  // 混 30% 既统一了色温，又保住了七个世界之间的差异。
  //
  // 单色主题（水墨）另走一条：先按亮度去饱和到同亮度的灰，再往路面色
  // 靠 12% 讨一点纸暖。直接往暖色路面混 94% 会留下约 33 的通道差
  // （橙色世界最明显），灰不下来；去饱和的做法能把差值压到 10 上下，
  // 七个世界靠**墨色深浅**区分，正合水墨「墨分五色」的路子。
  const target = base.worldTo ?? base.road;
  const k = base.worldK ?? 0.30;
  const world = !o
    ? WORLD_BASE
    : WORLD_BASE.map((c) =>
        base.mono ? mixHex(mixHex(c, grayOf(c), 0.94), base.road, 0.12) : mixHex(c, target, k),
      );
  const out: MapPalette = { ...base, world };
  CACHE.set(id, out);
  return out;
}
