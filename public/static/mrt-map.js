/**
 * MRT Rank — 台北捷運互動式 SVG 路線圖 v5
 *
 * v5 更新（全面修正為官方 TRTC 站號）：
 * - 淡水信義線 R：反向修正（R01=廣慈/奉天宮→R28=淡水），新增 R22A 新北投支線
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
    BL07: { x: 318, y: 430 },   // 板橋（轉Y線）
    BL08: { x: 360, y: 430 },   // 新埔（轉Y線 新埔民生）
    BL09: { x: 400, y: 430 },
    BL10: { x: 440, y: 430 },
    BL11: { x: 480, y: 430 },   // 西門（轉G線）
    BL12: { x: 530, y: 430 },   // 台北車站（轉R線）
    BL13: { x: 580, y: 430 },
    BL14: { x: 630, y: 430 },   // 忠孝新生（轉O線）
    BL15: { x: 710, y: 430 },   // 忠孝復興（轉BR線）
    BL16: { x: 760, y: 430 },
    BL17: { x: 810, y: 430 },
    BL18: { x: 850, y: 430 },   // 市政府
    BL19: { x: 890, y: 430 },   // 永春
    BL20: { x: 935, y: 430 },
    BL21: { x: 980, y: 430 },
    BL22: { x: 1020, y: 430 },  // 南港（轉BR線）
    BL23: { x: 1080, y: 430 },  // 南港展覽館（轉BR線）

    // ── 淡水信義線 R（垂直主幹 x=530；R28 淡水在頂，R01 廣慈/奉天宮在右下）──
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
    R07:  { x: 600, y: 510 },  // 東門（轉O線）
    R06:  { x: 650, y: 510 },  // 大安森林公園
    R05:  { x: 710, y: 510 },  // 大安（轉BR線）
    R04:  { x: 760, y: 510 },  // 信義安和
    R03:  { x: 825, y: 510 },  // 台北101/世貿
    R02:  { x: 900, y: 510 },  // 象山
    R01:  { x: 940, y: 510 },  // 廣慈/奉天宮（南端終點）

    // ── 松山新店線 G（G01 新店→G19 松山，含 G03A 小碧潭支線）──
    G01:  { x: 645, y: 760 },  // 新店
    G02:  { x: 645, y: 730 },  // 新店區公所
    G03:  { x: 645, y: 700 },  // 七張（轉 G03A 小碧潭）
    G03A: { x: 620, y: 720 },  // 小碧潭支線（七張左下）
    G04:  { x: 645, y: 670 },  // 大坪林（轉Y線）
    G05:  { x: 645, y: 640 },  // 景美
    G06:  { x: 645, y: 610 },  // 萬隆
    G07:  { x: 645, y: 580 },  // 公館
    G08:  { x: 600, y: 563 },  // 台電大樓
    G09:  { x: 560, y: 545 },  // 古亭（轉O線）
    G10:  { x: 530, y: 510 },  // 中正紀念堂（轉R線）
    G11:  { x: 480, y: 470 },  // 小南門
    G12:  { x: 480, y: 430 },  // 西門（共站BL11）
    G13:  { x: 480, y: 390 },  // 北門
    G14:  { x: 530, y: 390 },  // 中山（共站R11）
    G15:  { x: 630, y: 390 },  // 松江南京（轉O線）
    G16:  { x: 710, y: 390 },  // 南京復興（轉BR線）
    G17:  { x: 770, y: 390 },  // 台北小巨蛋
    G18:  { x: 830, y: 390 },  // 南京三民
    G19:  { x: 890, y: 390 },  // 松山

    // ── 中和新蘆線 O — 中和線段（南勢角→大橋頭）──
    O01:  { x: 510, y: 710 },  // 南勢角
    O02:  { x: 510, y: 670 },  // 景安（轉Y線）
    O03:  { x: 510, y: 630 },  // 永安市場
    O04:  { x: 510, y: 590 },  // 頂溪
    O05:  { x: 560, y: 545 },  // 古亭（共站G09）
    O06:  { x: 600, y: 510 },  // 東門（共站R07）
    O07:  { x: 630, y: 430 },  // 忠孝新生（共站BL14）
    O08:  { x: 630, y: 390 },  // 松江南京（共站G15）
    O09:  { x: 630, y: 340 },  // 行天宮
    O10:  { x: 590, y: 320 },  // 中山國小
    O11:  { x: 530, y: 320 },  // 民權西路（轉R線）
    O12:  { x: 478, y: 320 },  // 大橋頭（分支點）

    // ── 蘆洲線分支（大橋頭→蘆洲，往西北）──
    O50:  { x: 410, y: 275 },  // 三重國小
    O51:  { x: 370, y: 245 },  // 三和國中
    O52:  { x: 330, y: 215 },  // 徐匯中學
    O53:  { x: 290, y: 185 },  // 三民高中
    O54:  { x: 250, y: 155 },  // 蘆洲（終點）

    // ── 新莊線分支（大橋頭→迴龍，往西南）──
    O13:  { x: 430, y: 320 },  // 台北橋
    O14:  { x: 382, y: 320 },  // 菜寮
    O15:  { x: 334, y: 320 },  // 三重
    O16:  { x: 286, y: 320 },  // 先嗇宮
    O17:  { x: 250, y: 320 },  // 頭前庄（轉Y線）
    O18:  { x: 190, y: 320 },  // 新莊
    O19:  { x: 150, y: 320 },  // 輔大
    O20:  { x: 110, y: 320 },  // 丹鳳
    O21:  { x:  70, y: 320 },  // 迴龍（終點）

    // ── 文湖線 BR（BR01~BR24，含 BR03/BR05/BR06 新站）──
    BR01: { x: 910, y: 730 },  // 動物園
    BR02: { x: 880, y: 705 },  // 木柵
    BR03: { x: 850, y: 680 },  // 萬芳社區（新）
    BR04: { x: 820, y: 655 },  // 萬芳醫院
    BR05: { x: 790, y: 630 },  // 辛亥（新）
    BR06: { x: 760, y: 605 },  // 麟光（新）
    BR07: { x: 730, y: 580 },  // 六張犁
    BR08: { x: 710, y: 550 },  // 科技大樓
    BR09: { x: 710, y: 510 },  // 大安（共站R05）
    BR10: { x: 710, y: 430 },  // 忠孝復興（共站BL15）
    BR11: { x: 710, y: 390 },  // 南京復興（共站G16）
    BR12: { x: 710, y: 330 },  // 中山國中
    BR13: { x: 710, y: 280 },  // 松山機場
    BR14: { x: 710, y: 240 },  // 大直
    BR15: { x: 790, y: 220 },  // 劍南路
    BR16: { x: 840, y: 220 },  // 西湖
    BR17: { x: 890, y: 220 },  // 港墘
    BR18: { x: 940, y: 220 },  // 文德
    BR19: { x: 990, y: 220 },  // 內湖
    // 東段延伸（大湖公園→南港展覽館）
    BR20: { x: 1040, y: 260 },  // 大湖公園
    BR21: { x: 1080, y: 310 },  // 葫洲
    BR22: { x: 1080, y: 350 },  // 東湖
    BR23: { x: 1080, y: 390 },  // 南港軟體園區
    BR24: { x: 1080, y: 430 },  // 南港展覽館（共站BL23）
    // BR24: { x: 990, y: 392 },  // 南港展覽館（共站BL23）

    // ── 環狀線 Y（Y07大坪林→Y20新北產業園區）──
    // Y07 共用 G04（起點）；Y11/Y16/Y17 使用 Y 線專用座標，避免路徑鋸齒
    Y08:  { x: 615, y: 670 },  // 十四張 645 670
    Y09:  { x: 580, y: 670 },  // 秀朗橋
    Y10:  { x: 545, y: 670 },  // 景平
    Y11:  { x: 510, y: 670 },  // 景安（Y 線專用；O02 另顯示 O 線標籤）
    Y12:  { x: 460, y: 610 },  // 中和
    Y13:  { x: 420, y: 560 },  // 橋和
    Y14:  { x: 390, y: 520 },  // 中原
    Y15:  { x: 350, y: 480 },  // 板新
    Y16:  { x: 318, y: 430 },  // 板橋（Y 線專用；BL07 另顯示 BL 標籤）
    Y17:  { x: 318, y: 380 },  // 新埔民生（Y 線專用；BL08 另顯示 BL 標籤）
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
    R_S:  ['R10','R09','R08','R07','R06','R05','R04','R03','R02','R01'],
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
    BL02: { dx:  0, dy:-16, anchor:'middle', idDy:-11 },
    BL03: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL04: { dx:  0, dy:-16, anchor:'middle', idDy:-11 },
    BL05: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL06: { dx:  0, dy:-16, anchor:'middle', idDy:-11 },
    BL07: { dx: -6, dy: 18, anchor:'end',    idDy: 11 },
    BL08: { dx:  6, dy:-16, anchor:'middle', idDy:-11 },
    BL09: { dx:  0, dy: 15, anchor:'middle', idDy: 11 },
    BL10: { dx:  0, dy:-15, anchor:'middle', idDy:-11 },
    BL11: { dx:  6, dy:-15, anchor:'start',  idDy:-11 },
    BL12: { dx: 10, dy:-15, anchor:'start',  idDy:-11 },
    BL13: { dx:  0, dy: 15, anchor:'middle', idDy: 11 },
    BL14: { dx: 12, dy:-15, anchor:'start',  idDy:-11 },
    BL15: { dx: -6, dy: 18, anchor:'end',    idDy: 11 },
    BL16: { dx:  0, dy:-15, anchor:'middle', idDy:-11 },
    BL17: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL18: { dx:  0, dy:-15, anchor:'middle', idDy:-11 },
    BL19: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL20: { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    BL21: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL22: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    BL23: { dx:  0, dy: 18, anchor:'middle', idDy: 11 },

    // ── 淡水信義線 R（左右交錯；南段向下偏移）──
    R28:  { dx:-14, dy:  0, anchor:'end',    idDy: -11 },
    R27:  { dx:  0, dy:-18, anchor:'middle', idDy: -11 },
    R26:  { dx:  0, dy:-18, anchor:'middle', idDy: -11 },
    R25:  { dx:  0, dy:-18, anchor:'middle', idDy: -11 },
    R24:  { dx:  0, dy:-18, anchor:'middle', idDy: -11 },
    R23:  { dx:  0, dy:-18, anchor:'middle', idDy: -11 },
    R22:  { dx:  0, dy:-18, anchor:'middle', idDy: -11 },
    R22A: { dx: 14, dy: 0,  anchor:'start',  idDy: -11 },
    R21:  { dx:-12, dy: 0,  anchor:'end',    idDy: 11 },
    R20:  { dx: 12, dy: 0,  anchor:'start',  idDy: 11 },
    R19:  { dx:-12, dy: 0,  anchor:'end',    idDy: 11 },
    R18:  { dx: 12, dy: 0,  anchor:'start',  idDy: 11 },
    R17:  { dx:-12, dy: 0,  anchor:'end',    idDy: 11 },
    R16:  { dx: 12, dy: 0,  anchor:'start',  idDy: 11 },
    R15:  { dx:-12, dy: 0,  anchor:'end',    idDy: 11 },
    R14:  { dx: 12, dy: 0 , anchor:'start',  idDy:-11 },
    R13:  { dx: -8, dy:-20, anchor:'end',    idDy:-11 },
    R12:  { dx: 12, dy: 0,  anchor:'start',  idDy:-11 },
    R11:  { dx: -8, dy:-12, anchor:'end',    idDy:-11 },
    // R10 skipped（共站 BL12）
    R09:  { dx: 12, dy:  2, anchor:'start',  idDy: 11 },
    R08:  { dx:-18, dy:  0, anchor:'end',    idDy: 11 },
    R07:  { dx:  4, dy: 18, anchor:'middle', idDy: 11 },
    R06:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    R05:  { dx: -8, dy: 18, anchor:'end',    idDy: 11 },
    R04:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    R03:  { dx: 12, dy:-18, anchor:'middle', idDy:-11 },
    R02:  { dx: 12, dy:-18, anchor:'middle', idDy:-11 },
    R01:  { dx: 20, dy:  0, anchor:'start',  idDy: 11 },

    // ── 松山新店線 G ──
    G01:  { dx:  0, dy:18, anchor:'middle',idDy: 11 },
    G02:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G03:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G03A: { dx:-18, dy: 0, anchor:'end',   idDy: 11 },
    G04:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G05:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G06:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G07:  { dx: 18, dy: 0, anchor:'start', idDy: 11 },
    G08:  { dx: 12, dy:-5, anchor:'start', idDy:-11 },
    G09:  { dx:-18, dy: 0, anchor:'end',   idDy: 11 },
    // G10/G12/G14 skipped
    G11:  { dx:-18, dy: 0, anchor:'end',   idDy:-11 },
    G13:  { dx: -8, dy:-12, anchor:'end',  idDy:-11 },
    G15:  { dx: -8, dy:-18, anchor:'end',  idDy:-11 },
    G16:  { dx: -8, dy:-18, anchor:'end',  idDy:-11 },
    G17:  { dx: -4, dy:-18, anchor:'middle',idDy:-11 },
    G18:  { dx:  4, dy:-18, anchor:'middle',idDy:-11 },
    G19:  { dx:  0, dy:-18, anchor:'middle',idDy:-11 },

    // ── 中和新蘆線 O — 中和線主線段 ──
    O01:  { dx:  0, dy: 18, anchor:'middle', idDy: 11 },
    O02:  { dx:-18, dy:  0, anchor:'end',    idDy: 11 },
    O03:  { dx: 16, dy:  0, anchor:'start',  idDy: 11 },
    O04:  { dx: 18, dy:  3, anchor:'start',  idDy: 11 },
    // O05/O06/O07/O08/O11 skipped
    O09:  { dx:  8, dy: -8, anchor:'start',  idDy:-11 },
    O10:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O12:  { dx:  0, dy: 20, anchor:'middle', idDy: 11 },

    // ── 蘆洲線 O（標籤偏向右上，避免與新莊線重疊）──
    O50:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O51:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O52:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O53:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },
    O54:  { dx: 15, dy: -8, anchor:'start', idDy:-11 },

    // ── 新莊線 O（標籤交錯上下）──
    O13:  { dx:  0, dy: 20, anchor:'middle', idDy: 11 },
    O14:  { dx:  0, dy: 20, anchor:'middle', idDy: 11 },
    O15:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O16:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O17:  { dx:  5, dy: 20, anchor:'end',    idDy: 11 },
    O18:  { dx:  0, dy: 20, anchor:'middle', idDy: 11 },
    O19:  { dx:  0, dy:-18, anchor:'middle', idDy:-11 },
    O20:  { dx:  0, dy: 20, anchor:'middle', idDy: 11 },
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
    Y17:  { dx: 16, dy:  0, anchor:'start',  idDy:-11 }, // secondary transfer label kept clear of BL08
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
  let _containerEl = null;
  let _stationData = {};
  let _selectedStation = null;
  let _draftStation = null;
  let _highlightedStations = new Set();
  let _onSelectCallback = null;
  let _tooltip = null;
  let _stationChoice = null;
  let _choiceOpener = null;
  let _stationGroups = [];
  let _groupByStationId = new Map();
  let _panFrame = null;
  let _pendingView = null;
  let _pointerState = null;
  let _suppressNextStationClick = false;

  const OVERVIEW = Object.freeze({ x: -10, y: 0, width: 1140, height: 820 });
  const MAX_ZOOM = 4;
  const ZOOM_STEP = 1.35;
  let _view = { ...OVERVIEW };

  // ============================================================
  // 初始化
  // ============================================================
  function init(containerId, stations, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    _containerEl = container;

    const tokens = getComputedStyle(document.documentElement);
    Object.keys(LINE_COLORS).forEach(code => {
      const token = tokens.getPropertyValue('--mp-line-' + code.toLowerCase()).trim();
      if (token) LINE_COLORS[code] = token;
    });
    _stationData = {};
    stations.forEach(s => { _stationData[s.id] = s; });
    _onSelectCallback = options.onSelect || null;
    _stationGroups = buildStationGroups();
    _groupByStationId = new Map();
    _stationGroups.forEach(group => group.ids.forEach(id => _groupByStationId.set(id, group)));
    _view = { ...OVERVIEW };

    container.innerHTML = '';
    container.classList.add('mrt-map-root');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBoxText(_view));
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', '捷運路線示意圖。可用地圖按鈕縮放與重設；鍵盤選站請使用出發站搜尋。');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.maxWidth = (options.width || 1240) + 'px';
    svg.style.fontFamily = "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', sans-serif";
    _svgEl = svg;

    if (_tooltip) _tooltip.remove();
    _tooltip = document.createElement('div');
    _tooltip.className = 'mrt-map-tooltip';
    document.body.appendChild(_tooltip);

    if (!options.externalLegend) drawLegend(svg);
    drawLines(svg);
    drawTransferLinks(svg);
    drawStations(svg);
    drawLabels(svg);
    drawHitTargets(svg);
    setupPointerPan(svg);

    container.appendChild(svg);
    createStationChoice(container);
    updateHighlight();
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
    polyline(LINE_PATHS.Y, 'Y', { stroke: '#687780', 'stroke-width': '9' });
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
    _stationGroups.forEach(group => {
      const isTransfer = group.ids.length > 1 || group.ids.some(id => TRANSFER_STATIONS.has(id));
      const lineCode = stationLine(group.ids[0]);
      const color = group.ids.length > 1 ? '#172B32' : (LINE_COLORS[lineCode] || '#999');
      const circle = createSVGElement('circle', {
        cx: group.x, cy: group.y, r: isTransfer ? 8 : 5,
        fill: 'white', stroke: color, 'stroke-width': isTransfer ? 3 : 2,
        'data-id': group.ids[0],
        'data-station-marker': group.key,
        'data-station-ids': group.ids.join(' '),
        'pointer-events': 'none',
      });
      svg.appendChild(circle);
    });
  }

  // ============================================================
  // 站名標籤
  // ============================================================
  function drawLabels(svg) {
    _stationGroups.forEach(group => {
      const id = group.ids.find(candidate => !SKIP_LABEL.has(candidate)) || group.ids[0];
      const coord = STATION_COORDS[id];
      const off = LABEL_OFFSETS[id] || { dx: 0, dy: -18, anchor: 'middle', idDy: -11 };
      const name = getStationName(id);
      if (!name) return;

      const tx = coord.x + off.dx;
      const ty = coord.y + off.dy;
      const labelGroup = createSVGElement('g', {
        'class': 'mrt-station-label',
        'data-station-label': group.key,
        'data-station-ids': group.ids.join(' '),
        'pointer-events': 'none',
      });

      labelGroup.appendChild(createText(tx, ty, name, {
        'class': 'mrt-station-name',
        'font-size': '12', fill: '#172B32', 'text-anchor': off.anchor,
        'dominant-baseline': 'middle', 'font-weight': '500',
        'stroke': '#fff', 'stroke-width': '3', 'paint-order': 'stroke',
        'stroke-linejoin': 'round', 'pointer-events': 'none',
      }));
      // Preserve the approved overview label width. Co-located secondary IDs are
      // exposed by the explicit station picker and accessible hit-target name.
      labelGroup.appendChild(createText(tx, ty + off.idDy, id, {
        'class': 'mrt-station-code',
        'font-size': '9', fill: '#52626A', 'text-anchor': off.anchor,
        'dominant-baseline': 'middle',
        'stroke': '#fff', 'stroke-width': '2', 'paint-order': 'stroke',
        'stroke-linejoin': 'round',
      }));
      svg.appendChild(labelGroup);
    });
  }

  // ============================================================
  // 工具函式
  // ============================================================
  function stationLine(id) {
    return (id.match(/^[A-Z]+/) || ['BL'])[0];
  }

  function buildStationGroups() {
    const groups = new Map();
    Object.entries(STATION_COORDS).forEach(([id, coord]) => {
      const key = coord.x + ':' + coord.y;
      if (!groups.has(key)) groups.set(key, { key, x: coord.x, y: coord.y, ids: [] });
      groups.get(key).ids.push(id);
    });
    return Array.from(groups.values()).map(group => ({
      ...group,
      ids: group.ids.sort((a, b) => Number(SKIP_LABEL.has(a)) - Number(SKIP_LABEL.has(b))),
    }));
  }

  function viewBoxText(view) {
    return [view.x, view.y, view.width, view.height].map(value => Number(value.toFixed(3))).join(' ');
  }

  function clampView(view) {
    const minWidth = OVERVIEW.width / MAX_ZOOM;
    const width = Math.min(OVERVIEW.width, Math.max(minWidth, view.width));
    const height = width * (OVERVIEW.height / OVERVIEW.width);
    const maxX = OVERVIEW.x + OVERVIEW.width - width;
    const maxY = OVERVIEW.y + OVERVIEW.height - height;
    return {
      x: Math.min(maxX, Math.max(OVERVIEW.x, view.x)),
      y: Math.min(maxY, Math.max(OVERVIEW.y, view.y)),
      width,
      height,
    };
  }

  function applyView(view) {
    if (!_svgEl) return;
    _view = clampView(view);
    _svgEl.setAttribute('viewBox', viewBoxText(_view));
    const zoom = OVERVIEW.width / _view.width;
    _svgEl.classList.toggle('is-map-detail', zoom >= 1.55);
    if (_containerEl) {
      _containerEl.dataset.zoom = zoom.toFixed(2);
      _containerEl.dispatchEvent(new CustomEvent('mrtmapviewchange', { detail: getViewState() }));
    }
  }

  function queueView(view) {
    _pendingView = view;
    if (_panFrame) return;
    _panFrame = requestAnimationFrame(() => {
      _panFrame = null;
      if (_pendingView) applyView(_pendingView);
      _pendingView = null;
    });
  }

  function zoomBy(multiplier) {
    const nextWidth = _view.width / multiplier;
    const nextHeight = nextWidth * (OVERVIEW.height / OVERVIEW.width);
    const centerX = _view.x + _view.width / 2;
    const centerY = _view.y + _view.height / 2;
    applyView({
      x: centerX - nextWidth / 2,
      y: centerY - nextHeight / 2,
      width: nextWidth,
      height: nextHeight,
    });
    closeStationChoice({ restoreFocus: false });
    hideTooltip();
  }

  function zoomIn() {
    zoomBy(ZOOM_STEP);
  }

  function zoomOut() {
    zoomBy(1 / ZOOM_STEP);
  }

  function resetView() {
    applyView({ ...OVERVIEW });
    closeStationChoice({ restoreFocus: false });
    hideTooltip();
  }

  function getViewState() {
    return {
      zoom: OVERVIEW.width / _view.width,
      minZoom: 1,
      maxZoom: MAX_ZOOM,
      isOverview: Math.abs(_view.width - OVERVIEW.width) < 0.5,
    };
  }

  function setupPointerPan(svg) {
    svg.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      _pointerState = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startView: { ..._view },
        dragged: false,
      };
    });
    svg.addEventListener('pointermove', event => {
      if (!_pointerState || _pointerState.id !== event.pointerId) return;
      const dx = event.clientX - _pointerState.x;
      const dy = event.clientY - _pointerState.y;
      if (!_pointerState.dragged && Math.hypot(dx, dy) < 6) return;
      if (!_pointerState.dragged) {
        _pointerState.dragged = true;
        svg.setPointerCapture(event.pointerId);
      }
      svg.classList.add('is-panning');
      closeStationChoice({ restoreFocus: false });
      hideTooltip();
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      event.preventDefault();
      queueView({
        ..._pointerState.startView,
        x: _pointerState.startView.x - (dx / rect.width) * _pointerState.startView.width,
        y: _pointerState.startView.y - (dy / rect.height) * _pointerState.startView.height,
      });
    });
    const finishPointer = event => {
      if (!_pointerState || _pointerState.id !== event.pointerId) return;
      if (_pointerState.dragged) {
        _suppressNextStationClick = true;
        setTimeout(() => { _suppressNextStationClick = false; }, 0);
      }
      svg.classList.remove('is-panning');
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      _pointerState = null;
    };
    svg.addEventListener('pointerup', finishPointer);
    svg.addEventListener('pointercancel', finishPointer);
  }

  function drawHitTargets(svg) {
    const layer = createSVGElement('g', { 'class': 'mrt-station-hit-layer' });
    _stationGroups.forEach(group => {
      const isTransfer = group.ids.length > 1 || group.ids.some(id => TRANSFER_STATIONS.has(id));
      const hit = createSVGElement('circle', {
        cx: group.x,
        cy: group.y,
        r: isTransfer ? 15 : 12,
        fill: 'transparent',
        'class': 'mrt-station-hit',
        'data-station-target': group.key,
        'data-station-ids': group.ids.join(' '),
        'tabindex': '-1',
        'role': 'button',
        'aria-label': getStationName(group.ids[0]) + '，站碼 ' + group.ids.join('、'),
      });
      hit.addEventListener('click', event => handleStationGroupClick(event, group));
      hit.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleStationGroupClick(event, group);
        }
      });
      hit.addEventListener('pointerenter', event => showTooltip(event, group));
      hit.addEventListener('pointermove', event => showTooltip(event, group));
      hit.addEventListener('pointerleave', hideTooltip);
      layer.appendChild(hit);
    });
    svg.appendChild(layer);
  }

  function createStationChoice(container) {
    const choice = document.createElement('div');
    choice.className = 'mrt-station-choice';
    choice.hidden = true;
    choice.setAttribute('role', 'dialog');
    choice.setAttribute('aria-modal', 'false');
    choice.setAttribute('aria-labelledby', 'mrt-station-choice-title');
    choice.innerHTML = '<div class="mrt-station-choice-heading"><div><h3 id="mrt-station-choice-title"></h3><p>此轉乘節點對應多個站碼，請明確選擇。</p></div><button type="button" class="mrt-station-choice-close" aria-label="關閉轉乘站選擇">關閉</button></div><div class="mrt-station-choice-options"></div>';
    choice.querySelector('.mrt-station-choice-close').addEventListener('click', () => closeStationChoice());
    choice.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeStationChoice();
      }
    });
    container.appendChild(choice);
    _stationChoice = choice;
  }

  function openStationChoice(group, opener) {
    if (!_stationChoice) return;
    _choiceOpener = opener || null;
    const primary = group.ids.find(id => _stationData[id]) || group.ids[0];
    _stationChoice.querySelector('h3').textContent = getStationName(primary);
    const options = _stationChoice.querySelector('.mrt-station-choice-options');
    options.replaceChildren();
    group.ids.forEach(id => {
      const button = document.createElement('button');
      const line = stationLine(id);
      button.type = 'button';
      button.className = 'mrt-station-choice-option';
      button.disabled = !_stationData[id];
      button.setAttribute('aria-label', id + ' ' + (LINE_NAMES[line] || '路線未知') + (button.disabled ? '，目前無法選取' : ''));
      const code = document.createElement('span');
      code.className = 'mp-route-badge';
      code.dataset.route = line;
      code.textContent = id;
      const name = document.createElement('span');
      name.textContent = LINE_NAMES[line] || '路線未知';
      button.append(code, name);
      options.appendChild(button);
      button.addEventListener('click', () => {
        const returnFocus = _choiceOpener;
        closeStationChoice({ restoreFocus: false });
        chooseStation(id);
        if (returnFocus && typeof returnFocus.focus === 'function') {
          requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
        }
      });
    });
    _stationChoice.hidden = false;
    const first = options.querySelector('button:not(:disabled)') || _stationChoice.querySelector('button');
    requestAnimationFrame(() => first.focus());
  }

  function closeStationChoice({ restoreFocus = true } = {}) {
    if (!_stationChoice || _stationChoice.hidden) return;
    _stationChoice.hidden = true;
    if (restoreFocus && _choiceOpener && typeof _choiceOpener.focus === 'function') _choiceOpener.focus({ preventScroll: true });
    _choiceOpener = null;
  }

  function getStationName(id) {
    if (_stationData[id]) return _stationData[id].name_zh;
    if (Y_STATION_NAMES[id]) return Y_STATION_NAMES[id];
    if (id === 'R01') return '廣慈/奉天宮';
    return id;
  }

  function handleStationGroupClick(event, group) {
    if (_suppressNextStationClick) return;
    hideTooltip();
    if (group.ids.length > 1) {
      openStationChoice(group, event.currentTarget);
      return;
    }
    chooseStation(group.ids[0]);
  }

  function chooseStation(id) {
    _draftStation = id;
    if (_onSelectCallback) _onSelectCallback(id, _stationData[id] || null);
    updateHighlight();
  }

  function showTooltip(e, group) {
    if (!_tooltip || (_stationChoice && !_stationChoice.hidden) || (_pointerState && _pointerState.dragged)) return;
    const primary = group.ids.find(id => _stationData[id]) || group.ids[0];
    const data = _stationData[primary];
    _tooltip.textContent = getStationName(primary) + ' · ' + group.ids.join(' / ') + (data?.district ? ' · ' + data.district : '');
    _tooltip.style.display = 'block';
    _tooltip.style.left = (e.clientX + 14) + 'px';
    _tooltip.style.top  = (e.clientY - 10) + 'px';
  }

  function hideTooltip() {
    if (_tooltip) _tooltip.style.display = 'none';
  }

  function updateHighlight() {
    if (!_svgEl) return;
    _svgEl.querySelectorAll('[data-state-marker]').forEach(el => el.remove());
    const ranks = Array.from(_highlightedStations);
    const rankByGroup = new Map();
    ranks.forEach((id, index) => {
      const group = _groupByStationId.get(id);
      if (group && !rankByGroup.has(group.key)) rankByGroup.set(group.key, index + 1);
    });
    _stationGroups.forEach(group => {
      const isSelected = group.ids.includes(_selectedStation);
      const isDraft = group.ids.includes(_draftStation) && _draftStation !== _selectedStation;
      const rank = rankByGroup.get(group.key);
      const label = _svgEl.querySelector('[data-station-label="' + group.key + '"]');
      if (label) {
        label.classList.toggle('is-origin', isSelected);
        label.classList.toggle('is-draft', isDraft);
        label.classList.toggle('is-recommendation', !!rank);
      }
      if (rank && !isSelected) {
        _svgEl.appendChild(createSVGElement('circle', {
          cx: group.x, cy: group.y, r: 10, fill: '#FFFFFF', stroke: '#172B32', 'stroke-width': 2,
          'data-state-marker': 'recommendation', 'pointer-events': 'none',
        }));
        _svgEl.appendChild(createText(group.x, group.y, String(rank), {
          'data-state-marker': 'recommendation', 'font-size': '10', 'font-weight': '700', fill: '#172B32',
          'text-anchor': 'middle', 'dominant-baseline': 'central', 'pointer-events': 'none',
        }));
      }
      if (isSelected) {
        _svgEl.appendChild(createSVGElement('circle', {
          cx: group.x, cy: group.y, r: 10, fill: '#172B32', stroke: '#FFFFFF', 'stroke-width': 2,
          'data-state-marker': 'origin', 'pointer-events': 'none',
        }));
        appendStateTag(group, '出發', 'origin');
      } else if (isDraft) {
        _svgEl.appendChild(createSVGElement('circle', {
          cx: group.x, cy: group.y, r: 11, fill: '#FFFFFF', stroke: '#172B32', 'stroke-width': 2,
          'data-state-marker': 'draft', 'pointer-events': 'none',
        }));
        appendStateTag(group, '預選', 'draft');
      }
    });
    // Keep station names above state overlays, matching the approved map's
    // original marker-then-label paint order.
    _svgEl.querySelectorAll('[data-station-label]').forEach(label => _svgEl.appendChild(label));
  }

  function appendStateTag(group, text, type) {
    const id = group.ids.find(candidate => !SKIP_LABEL.has(candidate)) || group.ids[0];
    const off = LABEL_OFFSETS[id] || { dx: 0, dy: -18 };
    let x = group.x + 12;
    let y = group.y - 27;
    if (Math.abs(off.dx) > Math.abs(off.dy)) {
      x = off.dx < 0 ? group.x + 12 : group.x - 42;
      y = group.y - 8;
    } else if (off.dy < 0) {
      y = group.y + 11;
    }
    const tag = createSVGElement('g', { 'data-state-marker': type, 'class': 'mrt-state-tag mrt-state-tag-' + type, 'pointer-events': 'none' });
    tag.appendChild(createSVGElement('rect', { x, y, width: 30, height: 16, rx: 3 }));
    tag.appendChild(createText(x + 15, y + 8, text, {
      'font-size': '9', 'font-weight': '700', 'text-anchor': 'middle', 'dominant-baseline': 'central',
    }));
    _svgEl.appendChild(tag);
  }

  function highlight(stationIds) {
    _highlightedStations = new Set(stationIds);
    updateHighlight();
  }

  function selectStation(id) {
    if (STATION_COORDS[id]) {
      _selectedStation = id;
      if (_draftStation === id) _draftStation = null;
      updateHighlight();
    }
  }

  function setDraft(id) {
    _draftStation = STATION_COORDS[id] ? id : null;
    updateHighlight();
  }

  function clearDraft() {
    _draftStation = null;
    closeStationChoice({ restoreFocus: false });
    updateHighlight();
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
    setDraft,
    clearDraft,
    zoomIn,
    zoomOut,
    resetView,
    getViewState,
    closeStationChoice,
  };
})();
