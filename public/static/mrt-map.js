/**
 * MRT Rank — 台北捷運互動式 SVG 路線圖 v5
 *
 * v5 更新（全面修正為官方 TRTC 站號）：
 * - 淡水信義線 R：反向修正（R02=象山→R28=淡水），新增 R22A 新北投支線
 * - 松山新店線 G：修正站號（G06=萬隆起正確計數），新增 G03A 小碧潭支線
 * - 文湖線 BR：修正站號（+1 補齊 BR03/BR05/BR06 麟光），東段延伸至 BR24
 * - 環狀線 Y：採官方 Y07（大坪林）~Y20（新北產業園區）完整編號
 * - 中和新蘆線 O / 板南線 BL：沿用前版（已正確）
 */

const MRTMap = (() => {
  const LINE_COLORS = {
    BL: '#0070BD',
    R:  '#E3002C',
    G:  '#1A803F',
    O:  '#F5A623',
    BR: '#C48C31',
    Y:  '#EDDC00',
  };

  const LINE_NAMES = {
    BL: '板南線', R: '淡水信義線', G: '松山新店線',
    O: '中和新蘆線', BR: '文湖線', Y: '環狀線',
  };

  // ============================================================
  // 站點座標（schematic，非 GPS）
  // viewBox: "-90 0 1240 820"
  // ============================================================
  const STATION_COORDS = {
    // ── 板南線 BL (y=430，水平主幹) ──
    BL01: { x:  55, y: 430 },
    BL02: { x: 100, y: 430 },
    BL03: { x: 145, y: 430 },
    BL04: { x: 190, y: 430 },
    BL05: { x: 233, y: 430 },
    BL06: { x: 276, y: 430 },
    BL07: { x: 318, y: 430 },  // 板橋（轉Y線）
    BL08: { x: 360, y: 430 },  // 新埔（轉Y線 新埔民生）
    BL09: { x: 400, y: 430 },
    BL10: { x: 440, y: 430 },
    BL11: { x: 480, y: 430 },  // 西門（轉G線）
    BL12: { x: 530, y: 430 },  // 台北車站（轉R線）
    BL13: { x: 580, y: 430 },
    BL14: { x: 630, y: 430 },  // 忠孝新生（轉O線）
    BL15: { x: 680, y: 430 },  // 忠孝復興（轉BR線）
    BL16: { x: 725, y: 430 },
    BL17: { x: 770, y: 430 },
    BL18: { x: 810, y: 430 },
    BL19: { x: 850, y: 430 },
    BL20: { x: 885, y: 430 },
    BL21: { x: 920, y: 430 },
    BL22: { x: 980, y: 430 },  // 南港（轉BR線）
    BL23: { x: 1030, y: 430 },  // 南港展覽館（轉BR線）

    // ── 淡水信義線 R（垂直主幹 x=530；R28 淡水在頂，R02 象山在右下）──
    R28:  { x: 210, y: 60 },  // 淡水（北端）
    R27:  { x: 260, y: 60 },  // 紅樹林
    R26:  { x: 310, y: 60 },  // 竹圍
    R25:  { x: 360, y: 60 },  // 關渡
    R24:  { x: 410, y: 60 },  // 忠義
    R23:  { x: 460, y: 60 },  // 復興崗
    R22:  { x: 510, y: 60 },  // 北投（轉 R22A 新北投）
    R22A: { x: 550, y: 60 },  // 新北投（支線，北投左側）
    R21:  { x: 530, y: 90 },  // 奇岩
    R20:  { x: 530, y: 115 },  // 唭哩岸
    R19:  { x: 530, y: 140 },  // 石牌
    R18:  { x: 530, y: 165 },  // 明德
    R17:  { x: 530, y: 190 },  // 芝山
    R16:  { x: 530, y: 220 },  // 士林
    R15:  { x: 530, y: 250 },  // 劍潭
    R14:  { x: 530, y: 280 },  // 圓山
    R13:  { x: 530, y: 320 },  // 民權西路（轉O線）
    R12:  { x: 530, y: 360 },  // 雙連
    R11:  { x: 530, y: 390 },  // 中山（轉G線）
    R10:  { x: 530, y: 430 },  // 台北車站（共站BL12）
    R09:  { x: 530, y: 470 },  // 台大醫院
    R08:  { x: 530, y: 510 },  // 中正紀念堂（轉G線）
    R07:  { x: 580, y: 510 },  // 東門（轉O線）
    R06:  { x: 630, y: 510 },  // 大安森林公園
    R05:  { x: 680, y: 510 },  // 大安（轉BR線）
    R04:  { x: 730, y: 510 },  // 信義安和
    R03:  { x: 780, y: 510 },  // 台北101/世貿
    R02:  { x: 830, y: 510 },  // 象山（南端）

    // ── 松山新店線 G（G01 新店→G19 松山，含 G03A 小碧潭支線）──
    G01:  { x: 645, y: 760 },  // 新店
    G02:  { x: 645, y: 730 },  // 新店區公所
    G03:  { x: 645, y: 700 },  // 七張（轉 G03A 小碧潭）
    G03A: { x: 620, y: 720 },  // 小碧潭支線（七張左下）
    G04:  { x: 645, y: 670 },  // 大坪林（轉Y線）
    G05:  { x: 645, y: 640 },  // 景美
    G06:  { x: 640, y: 610 },  // 萬隆
    G07:  { x: 620, y: 580 },  // 公館
    G08:  { x: 590, y: 560 },  // 台電大樓
    G09:  { x: 560, y: 540 },  // 古亭（轉O線）
    G10:  { x: 530, y: 510 },  // 中正紀念堂（轉R線）
    G11:  { x: 500, y: 470 },  // 小南門
    G12:  { x: 480, y: 430 },  // 西門（共站BL11）
    G13:  { x: 480, y: 390 },  // 北門
    G14:  { x: 530, y: 390 },  // 中山（共站R11）
    G15:  { x: 630, y: 390 },  // 松江南京（轉O線）
    G16:  { x: 700, y: 390 },  // 南京復興（轉BR線）
    G17:  { x: 750, y: 390 },  // 台北小巨蛋
    G18:  { x: 800, y: 390 },  // 南京三民
    G19:  { x: 850, y: 390 },  // 松山

    // ── 中和新蘆線 O — 中和線段（南勢角→大橋頭）──
    O01:  { x: 510, y: 710 },  // 南勢角
    O02:  { x: 510, y: 670 },  // 景安（轉Y線）
    O03:  { x: 510, y: 630 },  // 永安市場
    O04:  { x: 510, y: 590 },  // 頂溪
    O05:  { x: 560, y: 540 },  // 古亭（共站G09）
    O06:  { x: 580, y: 510 },  // 東門（共站R07）
    O07:  { x: 630, y: 430 },  // 忠孝新生（共站BL14）
    O08:  { x: 630, y: 390 },  // 松江南京（共站G15）
    O09:  { x: 630, y: 350 },  // 行天宮
    O10:  { x: 590, y: 320 },  // 中山國小
    O11:  { x: 530, y: 320 },  // 民權西路（轉R線）
    O12:  { x: 478, y: 320 },  // 大橋頭（分支點）

    // ── 蘆洲線分支（大橋頭→蘆洲，往西北）──
    O50:  { x: 438, y: 290 },  // 三重國小
    O51:  { x: 398, y: 260 },  // 三和國中
    O52:  { x: 358, y: 230 },  // 徐匯中學
    O53:  { x: 318, y: 200 },  // 三民高中
    O54:  { x: 278, y: 170 },  // 蘆洲（終點）

    // ── 新莊線分支（大橋頭→迴龍，往西南）──
    O13:  { x: 430, y: 320 },  // 台北橋
    O14:  { x: 382, y: 320 },  // 菜寮
    O15:  { x: 334, y: 320 },  // 三重
    O16:  { x: 286, y: 320 },  // 先嗇宮
    O17:  { x: 250, y: 320 },  // 頭前庄（轉Y線）
    O18:  { x: 205, y: 320 },  // 新莊
    O19:  { x: 162, y: 320 },  // 輔大
    O20:  { x: 118, y: 320 },  // 丹鳳
    O21:  { x:  78, y: 320 },  // 迴龍（終點）

    // ── 文湖線 BR（BR01~BR24，含 BR03/BR05/BR06 新站）──
    BR01: { x: 900, y: 720 },  // 動物園
    BR02: { x: 870, y: 695 },  // 木柵
    BR03: { x: 840, y: 670 },  // 萬芳社區（新）
    BR04: { x: 810, y: 645 },  // 萬芳醫院
    BR05: { x: 780, y: 620 },  // 辛亥（新）
    BR06: { x: 750, y: 595 },  // 麟光（新）
    BR07: { x: 720, y: 570 },  // 六張犁
    BR08: { x: 690, y: 545 },  // 科技大樓
    BR09: { x: 680, y: 510 },  // 大安（共站R05）
    BR10: { x: 680, y: 430 },  // 忠孝復興（共站BL15）
    BR11: { x: 700, y: 390 },  // 南京復興（共站G16）
    BR12: { x: 720, y: 340 },  // 中山國中
    BR13: { x: 735, y: 300 },  // 松山機場
    BR14: { x: 760, y: 250 },  // 大直
    BR15: { x: 790, y: 230 },  // 劍南路
    BR16: { x: 830, y: 230 },  // 西湖
    BR17: { x: 870, y: 230 },  // 港墘
    BR18: { x: 910, y: 230 },  // 文德
    BR19: { x: 950, y: 230 },  // 內湖
    // 東段延伸（大湖公園→南港展覽館）
    BR20: { x: 990, y: 270 },  // 大湖公園
    BR21: { x: 1030, y: 310 },  // 葫洲
    BR22: { x: 1030, y: 350 },  // 東湖
    BR23: { x: 1030, y: 390 },  // 南港軟體園區
    BR24: { x: 1030, y: 430 },  // 南港展覽館（共站BL23）
    // BR24: { x: 990, y: 392 },  // 南港展覽館（共站BL23）

    // ── 環狀線 Y（Y07大坪林→Y20新北產業園區）──
    // Y07 共用 G04（起點）；Y11/Y16/Y17 使用 Y 線專用座標，避免路徑鋸齒
    Y08:  { x: 620, y: 670 },  // 十四張 645 670
    Y09:  { x: 590, y: 670 },  // 秀朗橋
    Y10:  { x: 550, y: 670 },  // 景平
    Y11:  { x: 510, y: 670 },  // 景安（Y 線專用；O02 另顯示 O 線標籤）
    Y12:  { x: 460, y: 610 },  // 中和
    Y13:  { x: 420, y: 560 },  // 橋和
    Y14:  { x: 390, y: 520 },  // 中原
    Y15:  { x: 350, y: 480 },  // 板新
    Y16:  { x: 318, y: 430 },  // 板橋（Y 線專用；BL07 另顯示 BL 標籤）
    Y17:  { x: 330, y: 390 },  // 新埔民生（Y 線專用；BL08 另顯示 BL 標籤）
    Y18:  { x: 250, y: 320 },  // 頭前庄（轉O 線）
    Y19:  { x: 250, y: 280 },  // 幸福
    Y20:  { x: 250, y: 240 },  // 新北產業園區
  };

  // ============================================================
  // 路線順序
  // ============================================================
  const LINE_PATHS = {
    BL: ['BL01','BL02','BL03','BL04','BL05','BL06','BL07','BL08','BL09','BL10',
         'BL11','BL12','BL13','BL14','BL15','BL16','BL17','BL18','BL19','BL20',
         'BL21','BL22','BL23'],
    // 淡水信義線：北段垂直 + 南段斜出 + R22A 新北投支線
    R_N:  ['R28','R27','R26','R25','R24','R23','R22','R21','R20','R19','R18','R17',
           'R16','R15','R14','R13','R12','R11','R10'],
    R_S:  ['R10','R09','R08','R07','R06','R05','R04','R03','R02'],
    R_XB: ['R22','R22A'],
    // 松山新店線 + G03A 小碧潭支線
    G_S:  ['G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','G11','G12'],
    G_N:  ['G12','G13','G14','G15','G16','G17','G18','G19'],  // 從 G12 開始補上 G12→G13 缺口
    G_XB: ['G03','G03A'],
    // 中和新蘆線（三段）
    O_S:  ['O01','O02','O03','O04','O05','O06','O07'],
    O_N:  ['O07','O08','O09','O10','O11','O12'],
    O_LZ: ['O12','O50','O51','O52','O53','O54'],
    O_XZ: ['O12','O13','O14','O15','O16','O17','O18','O19','O20','O21'],
    // 文湖線（三段）
    BR_S: ['BR01','BR02','BR03','BR04','BR05','BR06','BR07','BR08','BR09'],
    BR_N: ['BR09','BR10','BR11','BR12','BR13','BR14','BR15','BR16','BR17','BR18','BR19'],
    BR_E: ['BR19','BR20','BR21','BR22','BR23','BR24'],
    // 環狀線：Y07(G04)→Y08~Y11→Y12~Y15→Y16→Y17→O17(Y18)→Y19→Y20
    Y: ['G04','Y08','Y09','Y10','Y11','Y12','Y13','Y14','Y15','Y16','Y17','O17','Y18','Y19','Y20'],
  };

  const TRANSFER_PAIRS = {
    'BL11': ['G12'],   'G12':  ['BL11'],
    'BL12': ['R10'],   'R10':  ['BL12'],
    'BL14': ['O07'],   'O07':  ['BL14'],
    'BL15': ['BR10'],  'BR10': ['BL15'],
    'BL07': ['Y16'],   'Y16':  ['BL07'],   // 板橋：BL↔Y
    'BL08': ['Y17'],   'Y17':  ['BL08'],   // 新埔民生：BL↔Y
    'R13':  ['O11'],   'O11':  ['R13'],
    'R11':  ['G14'],   'G14':  ['R11'],
    'R08':  ['G10'],   'G10':  ['R08'],
    'R07':  ['O06'],   'O06':  ['R07'],
    'R05':  ['BR09'],  'BR09': ['R05'],
    'G09':  ['O05'],   'O05':  ['G09'],
    'G15':  ['O08'],   'O08':  ['G15'],
    'G16':  ['BR11'],  'BR11': ['G16'],
    'O02':  ['Y11'],   'Y11':  ['O02'],    // 景安：O↔Y
    'O17':  ['Y18'],   'y18':  ['O17'],
    'BL22': [],
    'BL23': ['BR24'],  'BR24': ['BL23'],
    'G04':  [],        // 大坪林：Y 線起點（Y07=G04，同站無需連線）
  };

  const TRANSFER_STATIONS = new Set([
    'BL07','BL08','BL11','BL12','BL14','BL15','BL23',
    'R05','R07','R08','R10','R11','R13','R22',
    'G04','G09','G10','G12','G14','G15','G16',
    'O02','O05','O06','O07','O08','O11','O12','O17',
    'BR09','BR10','BR11','BR24',
    'Y11','Y16','Y17','Y18',   // Y 線專用轉乘節點
  ]);

  // 共站：隱藏次要標籤（只顯示主站標籤）
  const SKIP_LABEL = new Set([
    'R10',   // 台北車站（共站 BL12）
    'G12',   // 西門（共站 BL11）
    'O07',   // 忠孝新生（共站 BL14）
    'BR10',  // 忠孝復興（共站 BL15）
    'O11',   // 民權西路（R13 顯示）
    'G14',   // 中山（R11 顯示）
    'G10',   // 中正紀念堂（R08 顯示）
    'O06',   // 東門（R07 顯示）
    'BR09',  // 大安（R05 顯示）
    'O05',   // 古亭（G09 顯示）
    'O08',   // 松江南京（G15 顯示）
    'BR11',  // 南京復興（G16 顯示）
    'Y11',   // 景安（O02 顯示）
    'Y16',   // 板橋（BL07 顯示）
    'Y17',   // 新埔民生（BL08 顯示）
    'Y18',   // 頭前庄（O17 顯示）
    'BR24',  // 南港展覽館與 BL23 合併顯示
  ]);

  // ============================================================
  // 站名標籤偏移
  // ============================================================
  const LABEL_OFFSETS = {
    // ── 板南線 BL（交錯上下）──
    BL01: { dx:-18, dy:  0, anchor:'end',    idDy: 11 },
    BL02: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL03: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL04: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL05: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL06: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL07: { dx: -6, dy: 18, anchor:'middle', idDy: 11 },
    BL08: { dx:  3, dy:-18, anchor:'middle', idDy:-11 },
    BL09: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL10: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL11: { dx:  6, dy:-18, anchor:'start',  idDy:-11 },
    BL12: { dx:  6, dy:-18, anchor:'start',  idDy:-11 },
    BL13: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL14: { dx: -6, dy:-18, anchor:'end',    idDy:-11 },
    BL15: { dx: -6, dy: 18, anchor:'end',    idDy: 11 },
    BL16: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL17: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL18: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL19: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL20: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL21: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL22: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL23: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },

    // ── 淡水信義線 R（左右交錯；南段向下偏移）──
    R28:  { dx:-18, dy:  0, anchor:'end',    idDy: -11 },
    R27:  { dx:  0, dy:-20, anchor:'middle', idDy: -11 },
    R26:  { dx:  0, dy:-20, anchor:'middle', idDy: -11 },
    R25:  { dx:  0, dy:-20, anchor:'middle', idDy: -11 },
    R24:  { dx:  0, dy:-20, anchor:'middle', idDy: -11 },
    R23:  { dx:  0, dy:-20, anchor:'middle', idDy: -11 },
    R22:  { dx:  0, dy:-20, anchor:'middle', idDy: -11 },
    R22A: { dx: 18, dy: 0,  anchor:'start',  idDy: -11 },
    R21:  { dx:-18, dy: 0,  anchor:'end',    idDy: 11 },
    R20:  { dx: 18, dy: 0,  anchor:'start',  idDy: 11 },
    R19:  { dx:-18, dy: 0,  anchor:'end',    idDy: 11 },
    R18:  { dx: 18, dy: 0,  anchor:'start',  idDy: 11 },
    R17:  { dx:-18, dy: 0,  anchor:'end',    idDy: 11 },
    R16:  { dx: 18, dy: 0,  anchor:'start',  idDy: 11 },
    R15:  { dx:-18, dy: 0,  anchor:'end',    idDy: 11 },
    R14:  { dx: 18, dy: 0,  anchor:'start',  idDy: 11 },
    R13:  { dx: -8, dy:-12, anchor:'end',    idDy:-11 },
    R12:  { dx: 18, dy: 0,  anchor:'start',  idDy:-11 },
    R11:  { dx: -8, dy:-12, anchor:'end',    idDy:-11 },
    // R10 skipped（共站 BL12）
    R09:  { dx: 18, dy:  0, anchor:'start',  idDy: 11 },
    R08:  { dx:-18, dy:  0, anchor:'end',    idDy: 11 },
    R07:  { dx:  8, dy: 18, anchor:'start',  idDy: 11 },
    R06:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    R05:  { dx: -8, dy: 18, anchor:'end',    idDy: 11 },
    R04:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    R03:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    R02:  { dx: 20, dy:  0, anchor:'start',  idDy: 11 },

    // ── 松山新店線 G ──
    G01:  { dx:  0, dy:18, anchor:'middle',idDy: 11 },
    G02:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G03:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G03A: { dx:-18, dy: 0, anchor:'end',   idDy: 11 },
    G04:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G05:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G06:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G07:  { dx:-18, dy: 3, anchor:'end',   idDy: 11 },
    G08:  { dx: 18, dy:-3, anchor:'start', idDy:-11 },
    G09:  { dx:-18, dy: 0, anchor:'end',   idDy: 11 },
    // G10/G12/G14 skipped
    G11:  { dx:-18, dy: 0, anchor:'end',   idDy:-11 },
    G13:  { dx: -8, dy:-12, anchor:'end',  idDy:-11 },
    G15:  { dx: -8, dy:-18, anchor:'end',  idDy:-11 },
    G16:  { dx: -8, dy:-18, anchor:'end',  idDy:-11 },
    G17:  { dx:  0, dy:-18, anchor:'middle',idDy:-11 },
    G18:  { dx:  0, dy:-18, anchor:'middle',idDy:-11 },
    G19:  { dx:  0, dy:-18, anchor:'middle',idDy:-11 },

    // ── 中和新蘆線 O — 中和線主線段 ──
    O01:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    O02:  { dx:-18, dy:  0, anchor:'end',    idDy: 11 },
    O03:  { dx: 18, dy:  0, anchor:'start',  idDy: 11 },
    O04:  { dx: 18, dy:  3, anchor:'start',  idDy: 11 },
    // O05/O06/O07/O08/O11 skipped
    O09:  { dx:  8, dy: -8, anchor:'start',  idDy:-11 },
    O10:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O12:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },

    // ── 蘆洲線 O（標籤偏向右上，避免與新莊線重疊）──
    O50:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O51:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O52:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O53:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O54:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },

    // ── 新莊線 O（標籤交錯上下）──
    O13:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    O14:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    O15:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O16:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O17:  { dx:  8, dy: 18, anchor:'end',    idDy: 11 },
    O18:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    O19:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O20:  { dx:  0, dy: 19, anchor:'middle', idDy: 11 },
    O21:  { dx:-18, dy:  0, anchor:'end',    idDy: 11 },

    // ── 文湖線 BR ──
    BR01: { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    BR02: { dx:-18, dy: 3, anchor:'end',   idDy: 11 },
    BR03: { dx: 18, dy:-3, anchor:'start', idDy:-11 },
    BR04: { dx:-18, dy: 3, anchor:'end',   idDy: 11 },
    BR05: { dx: 18, dy:-3, anchor:'start', idDy:-11 },
    BR06: { dx:-18, dy: 3, anchor:'end',   idDy: 11 },
    BR07: { dx: 18, dy:-3, anchor:'start', idDy:-11 },
    BR08: { dx: 18, dy:-3, anchor:'start', idDy:-11 },
    // BR09/BR10/BR11 skipped
    BR12: { dx: 18, dy:-3, anchor:'start', idDy:-11 },
    BR13: { dx: 18, dy:-3, anchor:'start', idDy:-11 },
    BR14: { dx:-18, dy: 0, anchor:'end',   idDy:-11 },
    BR15: { dx:  0, dy:-18, anchor:'middle',idDy:-11 },
    BR16: { dx:  0, dy:-18, anchor:'middle',idDy:-11 },
    BR17: { dx:  0, dy:-18, anchor:'middle',idDy:-11 },
    BR18: { dx:  0, dy:-18, anchor:'middle',idDy:-11 },
    BR19: { dx:  0, dy:-18, anchor:'middle',idDy:-11 },
    BR20: { dx: 18, dy:-3,  anchor:'start', idDy:-11 },
    BR21: { dx: 18, dy:-3,  anchor:'start', idDy:-11 },
    BR22: { dx: 18, dy: 0,  anchor:'start', idDy:-11 },
    BR23: { dx:-18, dy: 0,  anchor:'end',   idDy:-11 },
    BR24: { dx:  0, dy: 22, anchor:'middle',idDy: 11 },

    // ── 環狀線 Y（外側標籤；Y11/Y16/Y17 在 SKIP_LABEL 不顯示）──
    Y08:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    Y09:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    Y10:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    Y11:  { dx:  0, dy:  0, anchor:'middle', idDy:  0 }, // SKIP_LABEL
    Y12:  { dx:-18, dy:  3, anchor:'end',    idDy: 11 },
    Y13:  { dx:-18, dy:  3, anchor:'end',    idDy: 11 },
    Y14:  { dx:-18, dy:  3, anchor:'end',    idDy: 11 },
    Y15:  { dx:-18, dy:  3, anchor:'end',    idDy: 11 },
    Y16:  { dx:  0, dy:  0, anchor:'middle', idDy:  0 }, // SKIP_LABEL
    Y17:  { dx:  0, dy:  0, anchor:'middle', idDy:  0 }, // SKIP_LABEL
    Y19:  { dx:-18, dy:  0, anchor:'end',    idDy: 11 },
    Y20:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
  };

  // Y 線站點顯示名稱（DB 未載入時的 fallback；Y11/Y16/Y17 雖 SKIP_LABEL 但 tooltip 仍需名稱）
  const Y_STATION_NAMES = {
    Y08: '十四張',
    Y09: '秀朗橋',
    Y10: '景平',
    Y11: '景安',
    Y12: '中和',
    Y13: '橋和',
    Y14: '中原',
    Y15: '板新',
    Y16: '板橋',
    Y17: '新埔民生',
    Y18: '頭前庄',
    Y19: '幸福',
    Y20: '新北產業園區',
  };

  // ============================================================
  // 狀態
  // ============================================================
  let _svgEl = null;
  let _stationData = {};
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

    stations.forEach(s => { _stationData[s.id] = s; });
    _onSelectCallback = options.onSelect || null;

    container.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-90 0 1240 820');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.maxWidth = (options.width || 1240) + 'px';
    svg.style.fontFamily = "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif";
    _svgEl = svg;

    _tooltip = document.createElement('div');
    _tooltip.className = 'mrt-map-tooltip';
    _tooltip.style.cssText = `
      position: fixed; display: none; pointer-events: none; z-index: 9999;
      background: rgba(20,20,20,0.93); color: #fff; border-radius: 10px;
      padding: 8px 14px; font-size: 13px; line-height: 1.6;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35); backdrop-filter: blur(4px);
      max-width: 260px; white-space: nowrap;
    `;
    document.body.appendChild(_tooltip);

    drawLegend(svg);
    drawLines(svg);
    drawTransferLinks(svg);
    drawStations(svg);
    drawLabels(svg);

    container.appendChild(svg);
  }

  // ============================================================
  // 圖例
  // ============================================================
  function drawLegend(svg) {
    const g = createSVGElement('g', { transform: 'translate(-80, 16)' });
    Object.entries(LINE_NAMES).forEach(([code, name], i) => {
      const y = i * 22;
      g.appendChild(createSVGElement('rect', {
        x: 0, y: y - 5, width: 26, height: 5, rx: 2.5,
        fill: LINE_COLORS[code],
      }));
      g.appendChild(createText(32, y, name, {
        'font-size': '10.5', fill: '#555', 'dominant-baseline': 'middle',
      }));
    });
    svg.appendChild(g);
  }

  // ============================================================
  // 路線線段
  // ============================================================
  function drawLines(svg) {
    function polyline(ids, code, extra = {}) {
      const color = LINE_COLORS[code] || '#999';
      const pts = ids
        .map(id => STATION_COORDS[id])
        .filter(Boolean)
        .map(c => `${c.x},${c.y}`)
        .join(' ');
      if (!pts) return;
      svg.appendChild(createSVGElement('polyline', {
        points: pts, fill: 'none', stroke: color,
        'stroke-width': '6', 'stroke-linecap': 'round',
        'stroke-linejoin': 'round', 'stroke-opacity': '0.9',
        ...extra,
      }));
    }

    function polylinePoints(points, code, extra = {}) {
      const color = LINE_COLORS[code] || '#999';
      svg.appendChild(createSVGElement('polyline', {
        points: points.map(([x, y]) => `${x},${y}`).join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': '6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-opacity': '0.9',
        ...extra,
      }));
    }

    // 環狀線先畫（在最底層）
    polyline(LINE_PATHS.Y, 'Y');

    // 板南線
    polyline(LINE_PATHS.BL, 'BL');

    // 淡水信義線
    polyline(LINE_PATHS.R_N, 'R');
    polyline(LINE_PATHS.R_S, 'R');
    polyline(LINE_PATHS.R_XB, 'R');  // 新北投支線

    // 松山新店線
    polyline(LINE_PATHS.G_S, 'G');
    polyline(LINE_PATHS.G_N, 'G');
    polyline(LINE_PATHS.G_XB, 'G'); // 小碧潭支線

    // 中和新蘆線（四段）
    polyline(LINE_PATHS.O_S,  'O');
    polyline(LINE_PATHS.O_N,  'O');
    polyline(LINE_PATHS.O_LZ, 'O');  // 蘆洲線
    polyline(LINE_PATHS.O_XZ, 'O');  // 新莊線

    // 文湖線（三段）
    polyline(LINE_PATHS.BR_S, 'BR');
    polyline(LINE_PATHS.BR_N, 'BR');
    polyline(LINE_PATHS.BR_E, 'BR');  // 東段（大湖公園→南港展覽館）

  }

  // ============================================================
  // 轉乘連線（虛線）
  // ============================================================
  function drawTransferLinks(svg) {
    const drawn = new Set();
    Object.entries(TRANSFER_PAIRS).forEach(([from, tos]) => {
      tos.forEach(to => {
        const key = [from, to].sort().join('-');
        if (drawn.has(key)) return;
        drawn.add(key);
        const c1 = STATION_COORDS[from], c2 = STATION_COORDS[to];
        if (!c1 || !c2 || (c1.x === c2.x && c1.y === c2.y)) return;
        svg.appendChild(createSVGElement('line', {
          x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y,
          stroke: '#fff', 'stroke-width': '9', 'stroke-linecap': 'round',
        }));
        svg.appendChild(createSVGElement('line', {
          x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y,
          stroke: '#aaa', 'stroke-width': '3.5',
          'stroke-dasharray': '4,3', 'stroke-linecap': 'round',
        }));
      });
    });
  }

  // ============================================================
  // 站點圓圈
  // ============================================================
  function drawStations(svg) {
    const allIds = new Set([
      ...Object.keys(STATION_COORDS),
      ...Object.values(LINE_PATHS).flat(),
    ]);
    allIds.forEach(id => {
      const coord = STATION_COORDS[id];
      if (!coord) return;
      const isTransfer = TRANSFER_STATIONS.has(id);
      const lineCode = id.replace(/[0-9A-Z_]+$/, '').replace(/[^A-Z]/g, '') || 'BL';
      const color = LINE_COLORS[lineCode] || '#999';
      const r = isTransfer ? 8 : 5;

      const circle = createSVGElement('circle', {
        cx: coord.x, cy: coord.y, r,
        fill: 'white', stroke: color, 'stroke-width': isTransfer ? 3 : 2,
        style: 'cursor:pointer',
        'data-id': id,
      });
      circle.addEventListener('click', () => handleStationClick(id));
      circle.addEventListener('mousemove', (e) => showTooltip(e, id));
      circle.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(circle);
    });
  }

  // ============================================================
  // 站名標籤
  // ============================================================
  function drawLabels(svg) {
    Object.entries(STATION_COORDS).forEach(([id, coord]) => {
      if (SKIP_LABEL.has(id)) return;
      const off = LABEL_OFFSETS[id] || { dx: 0, dy: -18, anchor: 'middle', idDy: -11 };
      const name = getStationName(id);
      if (!name) return;

      const tx = coord.x + off.dx;
      const ty = coord.y + off.dy;
      const lineCode = (id.match(/^[A-Z]+/) || ['BL'])[0];
      const color = LINE_COLORS[lineCode] || '#333';

      svg.appendChild(createText(tx, ty, name, {
        'font-size': '10', fill: color, 'text-anchor': off.anchor,
        'dominant-baseline': 'middle', 'font-weight': '500',
        'stroke': '#fff', 'stroke-width': '3', 'paint-order': 'stroke',
        'stroke-linejoin': 'round',
      }));
      svg.appendChild(createText(tx, ty + off.idDy, id, {
        'font-size': '8', fill: '#999', 'text-anchor': off.anchor,
        'dominant-baseline': 'middle',
        'stroke': '#fff', 'stroke-width': '2', 'paint-order': 'stroke',
        'stroke-linejoin': 'round',
      }));
    });
  }

  // ============================================================
  // 工具函式
  // ============================================================
  function getStationName(id) {
    if (_stationData[id]) return _stationData[id].name_zh;
    if (Y_STATION_NAMES[id]) return Y_STATION_NAMES[id];
    return id;
  }

  function handleStationClick(id) {
    _selectedStation = id;
    if (_onSelectCallback) _onSelectCallback(id, _stationData[id] || null);
    updateHighlight();
  }

  function showTooltip(e, id) {
    const name = getStationName(id);
    const data = _stationData[id];
    let html = `<strong>${name}</strong> <span style="opacity:0.6;font-size:11px">${id}</span>`;
    if (data) {
      html += `<br><span style="opacity:0.75">${data.line_name || ''}</span>`;
      if (data.district) html += ` · ${data.district}`;
    }
    _tooltip.innerHTML = html;
    _tooltip.style.display = 'block';
    _tooltip.style.left = (e.clientX + 14) + 'px';
    _tooltip.style.top  = (e.clientY - 10) + 'px';
  }

  function hideTooltip() {
    if (_tooltip) _tooltip.style.display = 'none';
  }

  function updateHighlight() {
    if (!_svgEl) return;
    _svgEl.querySelectorAll('circle[data-id]').forEach(el => {
      const id = el.getAttribute('data-id');
      const isSelected = id === _selectedStation;
      const isHighlighted = _highlightedStations.has(id);
      if (isSelected) {
        el.setAttribute('fill', LINE_COLORS[(id.match(/^[A-Z]+/) || ['BL'])[0]] || '#333');
        el.setAttribute('r', '10');
      } else if (isHighlighted) {
        el.setAttribute('fill', '#FFD700');
        el.setAttribute('r', TRANSFER_STATIONS.has(id) ? '9' : '6');
      } else {
        el.setAttribute('fill', 'white');
        el.setAttribute('r', TRANSFER_STATIONS.has(id) ? '8' : '5');
      }
    });
  }

  function highlight(stationIds) {
    _highlightedStations = new Set(stationIds);
    updateHighlight();
  }

  function selectStation(id) {
    if (STATION_COORDS[id]) {
      _selectedStation = id;
      updateHighlight();
    }
  }

  // 與首頁舊版呼叫介面相容，避免 UI 成功渲染後再因方法名稱不一致拋錯。
  function highlightStations(stationIds) {
    highlight(stationIds);
  }

  function setSelected(id) {
    selectStation(id);
  }

  function clearSelected() {
    _selectedStation = null;
    updateHighlight();
  }

  function createSVGElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function createText(x, y, text, attrs = {}) {
    const el = createSVGElement('text', { x, y, ...attrs });
    el.textContent = text;
    return el;
  }

  return {
    init,
    highlight,
    highlightStations,
    selectStation,
    setSelected,
    clearSelected,
  };
})();
