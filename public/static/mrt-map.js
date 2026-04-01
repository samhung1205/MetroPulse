/**
 * MRT Rank — 台北捷運互動式 SVG 路線圖
 *
 * 採用示意圖（Schematic Map）方式繪製，類似倫敦地鐵圖風格：
 * - 直線、90°/45° 轉角，間距均勻
 * - 轉乘站以大圓圈顯示
 * - 支援：hover 顯示站名、click 選擇出發站、推薦結果高亮
 */

const MRTMap = (() => {
  // ============================================================
  // 路線顏色定義
  // ============================================================
  const LINE_COLORS = {
    BL: '#0070BD',
    R:  '#E3002C',
    G:  '#1A803F',
    O:  '#F5A623',
    BR: '#C48C31',
  };

  const LINE_NAMES = {
    BL: '板南線', R: '淡水信義線', G: '松山新店線',
    O: '中和新蘆線', BR: '文湖線',
  };

  // ============================================================
  // 站點座標佈局 — 示意圖設計
  // 座標系統：x=[0, 1000], y=[0, 800]
  // ============================================================

  const STATION_COORDS = {
    // === 板南線 (BL) — 水平主幹線，y≈420 ===
    BL01: { x: 70,  y: 420 },
    BL02: { x: 110, y: 420 },
    BL03: { x: 150, y: 420 },
    BL04: { x: 190, y: 420 },
    BL05: { x: 230, y: 420 },
    BL06: { x: 270, y: 420 },
    BL07: { x: 310, y: 420 },  // 板橋 (轉乘)
    BL08: { x: 350, y: 420 },  // 新埔 (轉乘)
    BL09: { x: 390, y: 420 },
    BL10: { x: 430, y: 420 },  // 龍山寺
    BL11: { x: 470, y: 420 },  // 西門 (轉乘 BL/G)
    BL12: { x: 520, y: 420 },  // 台北車站 (轉乘 BL/R)
    BL13: { x: 570, y: 420 },
    BL14: { x: 620, y: 420 },  // 忠孝新生 (轉乘 BL/O)
    BL15: { x: 670, y: 420 },  // 忠孝復興 (轉乘 BL/BR)
    BL16: { x: 720, y: 420 },
    BL17: { x: 770, y: 420 },
    BL18: { x: 820, y: 420 },  // 市政府
    BL19: { x: 860, y: 420 },
    BL20: { x: 900, y: 420 },
    BL21: { x: 930, y: 420 },
    BL22: { x: 960, y: 420 },  // 南港 (轉乘)
    BL23: { x: 990, y: 420 },  // 南港展覽館 (轉乘)

    // === 淡水信義線 (R) — 縱貫線 ===
    // 北段：淡水 → 台北車站 (x=520)
    R02:  { x: 520, y: 30  },  // 淡水
    R04:  { x: 520, y: 60  },
    R05:  { x: 520, y: 85  },
    R07:  { x: 520, y: 110 },
    R09:  { x: 520, y: 135 },
    R10:  { x: 520, y: 155 },
    R11:  { x: 520, y: 175 },  // 北投 (轉乘)
    R12:  { x: 520, y: 195 },
    R13:  { x: 520, y: 215 },
    R14:  { x: 520, y: 235 },
    R15:  { x: 520, y: 255 },
    R16:  { x: 520, y: 275 },
    R17:  { x: 520, y: 295 },  // 士林
    R18:  { x: 520, y: 315 },  // 劍潭
    R19:  { x: 520, y: 340 },  // 圓山
    R20:  { x: 520, y: 360 },  // 民權西路 (轉乘 R/O)
    R21:  { x: 520, y: 380 },  // 雙連
    R22:  { x: 520, y: 400 },  // 中山 (轉乘 R/G)
    R23:  { x: 520, y: 420 },  // 台北車站 (same as BL12)
    // 南段：台北車站 → 象山
    R24:  { x: 520, y: 450 },
    R25:  { x: 520, y: 480 },  // 中正紀念堂 (轉乘 R/G)
    R26:  { x: 570, y: 510 },  // 東門 (轉乘 R/O) — 往東南偏折
    R27:  { x: 620, y: 540 },
    R28:  { x: 670, y: 540 },  // 大安 (轉乘 R/BR)
    R29:  { x: 720, y: 540 },
    R30:  { x: 770, y: 540 },  // 台北101
    R31:  { x: 820, y: 540 },  // 象山

    // === 松山新店線 (G) — 西南→東北對角線 ===
    // 南段：新店 → 西門
    G01:  { x: 380, y: 700 },  // 新店
    G02:  { x: 380, y: 670 },
    G03:  { x: 380, y: 640 },
    G04:  { x: 380, y: 610 },
    G05:  { x: 400, y: 580 },  // 景美
    G07:  { x: 420, y: 555 },
    G08:  { x: 440, y: 530 },  // 公館
    G09:  { x: 450, y: 510 },
    G10:  { x: 460, y: 490 },  // 古亭 (轉乘 G/O)
    G11:  { x: 470, y: 470 },  // 中正紀念堂(G) — 與 R25 不同 entry 但轉乘
    G12:  { x: 470, y: 450 },
    G13:  { x: 470, y: 420 },  // 西門(G) — 與 BL11 轉乘
    // 北段：北門 → 松山（向東北延伸）
    G14:  { x: 490, y: 400 },  // 北門
    G15:  { x: 520, y: 400 },  // 中山(G) — 與 R22 轉乘
    G16:  { x: 620, y: 380 },  // 松江南京 (轉乘 G/O)
    G17:  { x: 670, y: 380 },  // 南京復興 (轉乘 G/BR)
    G18:  { x: 720, y: 380 },
    G19:  { x: 770, y: 380 },
    G22:  { x: 850, y: 380 },  // 松山

    // === 中和新蘆線 (O) — 南北向，偏西 ===
    // 南段：南勢角 → 古亭
    O01:  { x: 360, y: 600 },  // 南勢角
    O02:  { x: 360, y: 570 },  // 景安 (轉乘)
    O03:  { x: 360, y: 540 },
    O04:  { x: 360, y: 510 },
    O05:  { x: 460, y: 490 },  // 古亭(O) — 與 G10 轉乘
    O06:  { x: 570, y: 510 },  // 東門(O) — 與 R26 轉乘
    O07:  { x: 620, y: 420 },  // 忠孝新生(O) — 與 BL14 轉乘
    O08:  { x: 620, y: 380 },  // 松江南京(O) — 與 G16 轉乘
    O09:  { x: 620, y: 350 },  // 行天宮
    O10:  { x: 580, y: 330 },
    O11:  { x: 520, y: 360 },  // 民權西路(O) — 與 R20 轉乘
    O12:  { x: 470, y: 340 },  // 大橋頭
    // 蘆洲支線（往西北）
    O50:  { x: 350, y: 280 },  // 蘆洲
    O53:  { x: 410, y: 310 },  // 三重

    // === 文湖線 (BR) — 東南到北偏東，高架 ===
    BR01: { x: 660, y: 700 },  // 動物園
    BR02: { x: 660, y: 670 },
    BR04: { x: 660, y: 630 },
    BR06: { x: 670, y: 590 },
    BR07: { x: 670, y: 560 },
    BR08: { x: 670, y: 540 },  // 大安(BR) — 與 R28 轉乘
    BR09: { x: 670, y: 420 },  // 忠孝復興(BR) — 與 BL15 轉乘
    BR10: { x: 670, y: 380 },  // 南京復興(BR) — 與 G17 轉乘
    BR11: { x: 700, y: 340 },
    BR12: { x: 730, y: 305 },  // 松山機場
    BR13: { x: 760, y: 275 },
    BR14: { x: 790, y: 250 },  // 劍南路
    BR15: { x: 830, y: 230 },
    BR16: { x: 870, y: 215 },
    BR17: { x: 910, y: 205 },
    BR18: { x: 950, y: 200 },  // 內湖
    BR24: { x: 990, y: 380 },  // 南港展覽館(BR) — 與 BL23 轉乘
  };

  // ============================================================
  // 路線定義 — 各線站點順序（用於畫線段）
  // ============================================================

  const LINE_PATHS = {
    BL: ['BL01','BL02','BL03','BL04','BL05','BL06','BL07','BL08','BL09','BL10',
         'BL11','BL12','BL13','BL14','BL15','BL16','BL17','BL18','BL19','BL20',
         'BL21','BL22','BL23'],
    R:  ['R02','R04','R05','R07','R09','R10','R11','R12','R13','R14','R15','R16',
         'R17','R18','R19','R20','R21','R22','R23','R24','R25','R26','R27','R28',
         'R29','R30','R31'],
    G:  ['G01','G02','G03','G04','G05','G07','G08','G09','G10','G11','G12','G13',
         'G14','G15','G16','G17','G18','G19','G22'],
    O:  ['O01','O02','O03','O04','O05','O06','O07','O08','O09','O10','O11','O12',
         'O53','O50'],
    BR: ['BR01','BR02','BR04','BR06','BR07','BR08','BR09','BR10','BR11','BR12',
         'BR13','BR14','BR15','BR16','BR17','BR18'],
    // 文湖線南港延伸（BR09→BR24 via BL22,BL23 路段）
    BR_EXT: ['BR10','BR11','BR12','BR13','BR14','BR15','BR16','BR17','BR18','BR24'],
  };

  // 轉乘站對應 — 共站ID mapping
  const TRANSFER_PAIRS = {
    'BL11': ['G13'],   // 西門
    'G13':  ['BL11'],
    'BL12': ['R23'],   // 台北車站
    'R23':  ['BL12'],
    'BL14': ['O07'],   // 忠孝新生
    'O07':  ['BL14'],
    'BL15': ['BR09'],  // 忠孝復興
    'BR09': ['BL15'],
    'R20':  ['O11'],   // 民權西路
    'O11':  ['R20'],
    'R22':  ['G15'],   // 中山
    'G15':  ['R22'],
    'R25':  ['G11'],   // 中正紀念堂
    'G11':  ['R25'],
    'R26':  ['O06'],   // 東門
    'O06':  ['R26'],
    'R28':  ['BR08'],  // 大安
    'BR08': ['R28'],
    'G10':  ['O05'],   // 古亭
    'O05':  ['G10'],
    'G16':  ['O08'],   // 松江南京
    'O08':  ['G16'],
    'G17':  ['BR10'],  // 南京復興
    'BR10': ['G17'],
    'BL22': [],        // 南港
    'BL23': ['BR24'],  // 南港展覽館
    'BR24': ['BL23'],
  };

  // 轉乘站列表（主站 ID，用於畫大圈）
  const TRANSFER_STATIONS = new Set([
    'BL07','BL08','BL11','BL12','BL14','BL15','BL22','BL23',
    'R11','R19','R20','R22','R25','R26','R28',
    'G10','G11','G13','G15','G16','G17',
    'O02','O05','O06','O07','O08','O11',
    'BR08','BR09','BR10','BR24',
  ]);

  // 站名（部分顯示，避免過密）
  const LABEL_STATIONS = new Set([
    'BL01','BL07','BL10','BL11','BL12','BL14','BL15','BL16','BL17','BL18','BL22','BL23',
    'R02','R11','R17','R18','R19','R20','R21','R22','R25','R26','R27','R28','R29','R30','R31',
    'G01','G08','G10','G14','G16','G17','G18','G22',
    'O01','O09','O12','O50','O53',
    'BR01','BR12','BR14','BR18','BR24',
  ]);

  // ============================================================
  // 站名標籤位置偏移
  // ============================================================
  const LABEL_OFFSETS = {
    // BL 線 — 大多放下方
    BL01: { dx: 0, dy: 18, anchor: 'middle' },
    BL07: { dx: 0, dy: 18, anchor: 'middle' },
    BL10: { dx: 0, dy: 18, anchor: 'middle' },
    BL11: { dx: -20, dy: -12, anchor: 'end' },
    BL12: { dx: 0, dy: -14, anchor: 'middle' },
    BL14: { dx: 0, dy: 18, anchor: 'middle' },
    BL15: { dx: 0, dy: 18, anchor: 'middle' },
    BL16: { dx: 0, dy: 18, anchor: 'middle' },
    BL17: { dx: 0, dy: 18, anchor: 'middle' },
    BL18: { dx: 0, dy: 18, anchor: 'middle' },
    BL22: { dx: 0, dy: 18, anchor: 'middle' },
    BL23: { dx: 0, dy: 18, anchor: 'middle' },
    // R 線
    R02:  { dx: 25, dy: 4, anchor: 'start' },
    R11:  { dx: 25, dy: 4, anchor: 'start' },
    R17:  { dx: 25, dy: 4, anchor: 'start' },
    R18:  { dx: 25, dy: 4, anchor: 'start' },
    R19:  { dx: 25, dy: 4, anchor: 'start' },
    R20:  { dx: -20, dy: 4, anchor: 'end' },
    R21:  { dx: 25, dy: 4, anchor: 'start' },
    R22:  { dx: 25, dy: 4, anchor: 'start' },
    R25:  { dx: 25, dy: 4, anchor: 'start' },
    R26:  { dx: 0, dy: -12, anchor: 'middle' },
    R27:  { dx: 0, dy: 18, anchor: 'middle' },
    R28:  { dx: 0, dy: 18, anchor: 'middle' },
    R29:  { dx: 0, dy: 18, anchor: 'middle' },
    R30:  { dx: 0, dy: 18, anchor: 'middle' },
    R31:  { dx: 0, dy: 18, anchor: 'middle' },
    // G 線
    G01:  { dx: -15, dy: 4, anchor: 'end' },
    G08:  { dx: -15, dy: 4, anchor: 'end' },
    G10:  { dx: -18, dy: -8, anchor: 'end' },
    G14:  { dx: -15, dy: 4, anchor: 'end' },
    G16:  { dx: 0, dy: -12, anchor: 'middle' },
    G17:  { dx: 0, dy: -12, anchor: 'middle' },
    G18:  { dx: 0, dy: -12, anchor: 'middle' },
    G22:  { dx: 0, dy: -12, anchor: 'middle' },
    // O 線
    O01:  { dx: -15, dy: 4, anchor: 'end' },
    O09:  { dx: 15, dy: 4, anchor: 'start' },
    O12:  { dx: -15, dy: 4, anchor: 'end' },
    O50:  { dx: -15, dy: 4, anchor: 'end' },
    O53:  { dx: -15, dy: 4, anchor: 'end' },
    // BR 線
    BR01: { dx: 15, dy: 4, anchor: 'start' },
    BR12: { dx: 15, dy: 4, anchor: 'start' },
    BR14: { dx: 15, dy: 4, anchor: 'start' },
    BR18: { dx: 15, dy: 4, anchor: 'start' },
    BR24: { dx: 0, dy: 18, anchor: 'middle' },
  };

  // ============================================================
  // 狀態管理
  // ============================================================
  let _svgEl = null;
  let _stationData = {};     // id → { name_zh, line, is_transfer_station, ... }
  let _selectedStation = null;
  let _highlightedStations = new Set();
  let _onSelectCallback = null;
  let _tooltip = null;

  // ============================================================
  // 初始化
  // ============================================================
  function init(containerId, stations, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 建立站點查找表
    stations.forEach(s => { _stationData[s.id] = s; });

    _onSelectCallback = options.onSelect || null;

    // 建立 SVG
    const width = options.width || 1050;
    const height = options.height || 760;

    container.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1050 760');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.maxWidth = width + 'px';
    svg.style.fontFamily = "'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
    _svgEl = svg;

    // 建立 tooltip
    _tooltip = document.createElement('div');
    _tooltip.className = 'mrt-map-tooltip';
    _tooltip.style.cssText = `
      position: fixed; display: none; pointer-events: none; z-index: 9999;
      background: rgba(30,30,30,0.92); color: #fff; border-radius: 10px;
      padding: 8px 14px; font-size: 13px; line-height: 1.5;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3); backdrop-filter: blur(4px);
      max-width: 220px; white-space: nowrap;
    `;
    document.body.appendChild(_tooltip);

    // 繪製圖例
    drawLegend(svg);
    // 繪製路線
    drawLines(svg);
    // 繪製轉乘連線
    drawTransferLinks(svg);
    // 繪製站點
    drawStations(svg);
    // 繪製站名標籤
    drawLabels(svg);

    container.appendChild(svg);
  }

  // ============================================================
  // 繪製圖例
  // ============================================================
  function drawLegend(svg) {
    const g = createSVGElement('g', { transform: 'translate(15, 20)' });
    const lines = Object.entries(LINE_NAMES);
    lines.forEach(([code, name], i) => {
      const y = i * 22;
      g.appendChild(createSVGElement('rect', {
        x: 0, y: y - 6, width: 30, height: 5, rx: 2.5,
        fill: LINE_COLORS[code],
      }));
      g.appendChild(createText(36, y, `${name}`, {
        'font-size': '11', fill: '#555', 'dominant-baseline': 'middle',
      }));
    });
    svg.appendChild(g);
  }

  // ============================================================
  // 繪製路線線段
  // ============================================================
  function drawLines(svg) {
    // 每條路線畫 polyline
    Object.entries(LINE_PATHS).forEach(([lineCode, stationIds]) => {
      const realLine = lineCode.replace('_EXT', '');
      const color = LINE_COLORS[realLine] || '#999';
      const points = stationIds
        .map(id => STATION_COORDS[id])
        .filter(Boolean)
        .map(c => `${c.x},${c.y}`)
        .join(' ');
      
      svg.appendChild(createSVGElement('polyline', {
        points,
        fill: 'none',
        stroke: color,
        'stroke-width': '5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-opacity': '0.85',
        class: `mrt-line mrt-line-${realLine}`,
      }));
    });

    // 南港展覽館延伸 BR 到 BL23 位置 via custom path
    const brExtPts = [
      STATION_COORDS['BR18'],
      { x: 990, y: 300 },
      STATION_COORDS['BR24'],
    ].filter(Boolean).map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: brExtPts,
      fill: 'none', stroke: LINE_COLORS.BR, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': '0.85',
    }));

    // O 線：大橋頭 → 三重 → 蘆洲
    const oExtPts = ['O12','O53','O50']
      .map(id => STATION_COORDS[id]).filter(Boolean)
      .map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: oExtPts,
      fill: 'none', stroke: LINE_COLORS.O, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': '0.85',
    }));

    // BR 大安→忠孝復興 (vertical connector BR08→BR09)
    const brConnPts = [STATION_COORDS['BR08'], STATION_COORDS['BR09']]
      .map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: brConnPts,
      fill: 'none', stroke: LINE_COLORS.BR, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-opacity': '0.85',
    }));

    // G 線 G15→G16 跳躍 (因為座標有間距)
    const gJumpPts = [STATION_COORDS['G15'], { x: 560, y: 390 }, STATION_COORDS['G16']]
      .map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: gJumpPts,
      fill: 'none', stroke: LINE_COLORS.G, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': '0.85',
    }));

    // O 線 O04→O05(古亭) 跳躍
    const oJump1 = [STATION_COORDS['O04'], STATION_COORDS['O05']]
      .map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: oJump1,
      fill: 'none', stroke: LINE_COLORS.O, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-opacity': '0.85',
    }));

    // O 線 O06→O07 (東門→忠孝新生) 
    const oJump2 = [STATION_COORDS['O06'], STATION_COORDS['O07']]
      .map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: oJump2,
      fill: 'none', stroke: LINE_COLORS.O, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-opacity': '0.85',
    }));

    // O 線 O10→O11 (中山國小→民權西路)
    const oJump3 = [STATION_COORDS['O10'], STATION_COORDS['O11']]
      .map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: oJump3,
      fill: 'none', stroke: LINE_COLORS.O, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-opacity': '0.85',
    }));

    // O 線 O11→O12 (民權西路→大橋頭)
    const oJump4 = [STATION_COORDS['O11'], STATION_COORDS['O12']]
      .map(c => `${c.x},${c.y}`).join(' ');
    svg.appendChild(createSVGElement('polyline', {
      points: oJump4,
      fill: 'none', stroke: LINE_COLORS.O, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-opacity': '0.85',
    }));
  }

  // ============================================================
  // 繪製轉乘連線（虛線白底圈）
  // ============================================================
  function drawTransferLinks(svg) {
    const drawn = new Set();
    Object.entries(TRANSFER_PAIRS).forEach(([from, tos]) => {
      tos.forEach(to => {
        const key = [from, to].sort().join('-');
        if (drawn.has(key)) return;
        drawn.add(key);
        const c1 = STATION_COORDS[from];
        const c2 = STATION_COORDS[to];
        if (!c1 || !c2) return;
        // 只有位置不同才畫連線
        if (c1.x !== c2.x || c1.y !== c2.y) {
          svg.appendChild(createSVGElement('line', {
            x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y,
            stroke: '#fff', 'stroke-width': '8', 'stroke-linecap': 'round',
          }));
          svg.appendChild(createSVGElement('line', {
            x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y,
            stroke: '#999', 'stroke-width': '3',
            'stroke-dasharray': '4,3', 'stroke-linecap': 'round',
          }));
        }
      });
    });
  }

  // ============================================================
  // 繪製站點圓圈
  // ============================================================
  function drawStations(svg) {
    const stationGroup = createSVGElement('g', { class: 'mrt-stations' });

    Object.entries(STATION_COORDS).forEach(([id, coord]) => {
      const stInfo = _stationData[id] || {};
      const lineCode = stInfo.line || id.replace(/\d+/g, '');
      const color = LINE_COLORS[lineCode] || '#999';
      const isTransfer = TRANSFER_STATIONS.has(id);
      const r = isTransfer ? 7 : 4.5;

      const g = createSVGElement('g', {
        class: `mrt-station-node`,
        'data-station-id': id,
        cursor: 'pointer',
      });

      // 隱形的較大點擊區域
      g.appendChild(createSVGElement('circle', {
        cx: coord.x, cy: coord.y, r: 14,
        fill: 'transparent', class: 'station-hitarea',
      }));

      // 高亮底圈 (推薦結果)
      g.appendChild(createSVGElement('circle', {
        cx: coord.x, cy: coord.y, r: r + 8,
        fill: 'transparent', stroke: 'transparent', 'stroke-width': '3',
        class: 'station-highlight-ring',
      }));

      // 選中底圈
      g.appendChild(createSVGElement('circle', {
        cx: coord.x, cy: coord.y, r: r + 5,
        fill: 'transparent', stroke: 'transparent', 'stroke-width': '2',
        class: 'station-selected-ring',
      }));

      if (isTransfer) {
        // 轉乘站：白底 + 彩色邊
        g.appendChild(createSVGElement('circle', {
          cx: coord.x, cy: coord.y, r: r,
          fill: '#fff', stroke: color, 'stroke-width': '2.5',
          class: 'station-dot',
        }));
      } else {
        // 一般站：實心圓
        g.appendChild(createSVGElement('circle', {
          cx: coord.x, cy: coord.y, r: r,
          fill: color, stroke: '#fff', 'stroke-width': '1.2',
          class: 'station-dot',
        }));
      }

      // 事件
      g.addEventListener('mouseenter', (e) => onStationHover(e, id, true));
      g.addEventListener('mouseleave', (e) => onStationHover(e, id, false));
      g.addEventListener('click', () => onStationClick(id));

      stationGroup.appendChild(g);
    });

    svg.appendChild(stationGroup);
  }

  // ============================================================
  // 繪製站名標籤
  // ============================================================
  function drawLabels(svg) {
    const labelsGroup = createSVGElement('g', { class: 'mrt-labels' });

    Object.entries(STATION_COORDS).forEach(([id, coord]) => {
      if (!LABEL_STATIONS.has(id)) return;
      const stInfo = _stationData[id] || {};
      const name = stInfo.name_zh || id;
      const offset = LABEL_OFFSETS[id] || { dx: 0, dy: 15, anchor: 'middle' };

      const text = createText(coord.x + offset.dx, coord.y + offset.dy, name, {
        'font-size': '9.5',
        'font-weight': TRANSFER_STATIONS.has(id) ? '600' : '400',
        fill: '#444',
        'text-anchor': offset.anchor,
        'dominant-baseline': 'middle',
        'pointer-events': 'none',
        class: `mrt-label mrt-label-${id}`,
      });
      labelsGroup.appendChild(text);
    });

    svg.appendChild(labelsGroup);
  }

  // ============================================================
  // 互動事件
  // ============================================================
  function onStationHover(event, stationId, isEnter) {
    if (!_tooltip) return;
    if (isEnter) {
      const st = _stationData[stationId];
      if (!st) { _tooltip.style.display = 'none'; return; }
      const lineColor = LINE_COLORS[st.line] || '#999';
      const lineName = LINE_NAMES[st.line] || st.line;
      let html = `
        <div style="font-weight:700;font-size:14px;margin-bottom:2px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${lineColor};margin-right:5px;vertical-align:middle;"></span>
          ${st.name_zh}
        </div>
        <div style="color:#aaa;font-size:11px;">${st.id} · ${lineName} · ${st.district || ''}</div>
      `;
      if (st.is_transfer_station) {
        html += `<div style="color:#FFD700;font-size:11px;margin-top:2px;">★ 轉乘站</div>`;
      }
      html += `<div style="color:#8be;font-size:11px;margin-top:3px;">點擊選為出發站</div>`;
      _tooltip.innerHTML = html;
      _tooltip.style.display = 'block';
      const rect = event.target.closest('g').getBoundingClientRect();
      _tooltip.style.left = (rect.left + rect.width / 2 - 60) + 'px';
      _tooltip.style.top = (rect.top - _tooltip.offsetHeight - 10) + 'px';
    } else {
      _tooltip.style.display = 'none';
    }
  }

  function onStationClick(stationId) {
    setSelected(stationId);
    if (_onSelectCallback) {
      const st = _stationData[stationId];
      _onSelectCallback(stationId, st);
    }
  }

  // ============================================================
  // 公開 API
  // ============================================================

  /** 設定選中的出發站 */
  function setSelected(stationId) {
    // 清除舊選中
    if (_svgEl) {
      _svgEl.querySelectorAll('.station-selected-ring').forEach(ring => {
        ring.setAttribute('fill', 'transparent');
        ring.setAttribute('stroke', 'transparent');
      });
    }
    _selectedStation = stationId;
    if (stationId && _svgEl) {
      const node = _svgEl.querySelector(`[data-station-id="${stationId}"] .station-selected-ring`);
      if (node) {
        node.setAttribute('fill', 'rgba(59,130,246,0.15)');
        node.setAttribute('stroke', '#3B82F6');
      }
    }
  }

  /** 清除選中 */
  function clearSelected() {
    setSelected(null);
  }

  /** 高亮推薦站點 */
  function highlightStations(stationIds, scores) {
    // 清除舊高亮
    clearHighlights();
    _highlightedStations = new Set(stationIds);

    stationIds.forEach((id, idx) => {
      if (!_svgEl) return;
      // 嘗試找對應站在地圖上的主ID
      const mapId = findMapId(id);
      if (!mapId) return;

      const node = _svgEl.querySelector(`[data-station-id="${mapId}"] .station-highlight-ring`);
      if (node) {
        const colors = ['#FFD700', '#FFA500', '#FF8C00', '#FF6347', '#FF4500'];
        const c = colors[idx] || '#FFD700';
        node.setAttribute('fill', c + '30');
        node.setAttribute('stroke', c);
        node.setAttribute('stroke-width', '3');
      }

      // 在站點旁顯示排名
      const coord = STATION_COORDS[mapId];
      if (coord) {
        const badge = createSVGElement('g', { class: 'mrt-rec-badge' });
        badge.appendChild(createSVGElement('circle', {
          cx: coord.x + 12, cy: coord.y - 12, r: 9,
          fill: '#3B82F6', stroke: '#fff', 'stroke-width': '1.5',
        }));
        badge.appendChild(createText(coord.x + 12, coord.y - 12, `${idx + 1}`, {
          'font-size': '10', fill: '#fff', 'font-weight': '700',
          'text-anchor': 'middle', 'dominant-baseline': 'central',
        }));
        _svgEl.appendChild(badge);
      }
    });
  }

  /** 清除高亮 */
  function clearHighlights() {
    _highlightedStations.clear();
    if (_svgEl) {
      _svgEl.querySelectorAll('.station-highlight-ring').forEach(ring => {
        ring.setAttribute('fill', 'transparent');
        ring.setAttribute('stroke', 'transparent');
      });
      _svgEl.querySelectorAll('.mrt-rec-badge').forEach(b => b.remove());
    }
  }

  /** 找到站在地圖上的座標ID（處理共站） */
  function findMapId(stationId) {
    if (STATION_COORDS[stationId]) return stationId;
    // 在 TRANSFER_PAIRS 中查找
    for (const [from, tos] of Object.entries(TRANSFER_PAIRS)) {
      if (from === stationId) return STATION_COORDS[from] ? from : null;
      if (tos.includes(stationId)) return STATION_COORDS[from] ? from : null;
    }
    return null;
  }

  /** 銷毀地圖 */
  function destroy() {
    if (_tooltip) {
      _tooltip.remove();
      _tooltip = null;
    }
    _svgEl = null;
    _stationData = {};
  }

  // ============================================================
  // SVG 工具函式
  // ============================================================
  function createSVGElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function createText(x, y, text, attrs = {}) {
    const el = createSVGElement('text', { x, y, ...attrs });
    el.textContent = text;
    return el;
  }

  // ============================================================
  // 公開介面
  // ============================================================
  return {
    init,
    setSelected,
    clearSelected,
    highlightStations,
    clearHighlights,
    destroy,
    findMapId,
    getCoords: () => STATION_COORDS,
    getLineColors: () => LINE_COLORS,
  };
})();
