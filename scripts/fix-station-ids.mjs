/**
 * fix-station-ids.mjs
 * 將 seed.sql 中 BR/G/R 線的站號全面修正為官方 TRTC 編號，
 * 並以兩階段替換（old → TEMP → new）避免鏈式衝突。
 *
 * 官方依據：metro-classify.pdf
 *   BR: BR01-BR24（seed 舊 BR06-BR22 各少一號）
 *   G:  G01-G19（seed 舊 G07-G22 各多一號）
 *   R:  R02=象山→R28=淡水（seed 舊完全反向 R02=淡水→R31=象山）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(__dirname, '..', 'seed.sql');

// ============================================================
// 舊 ID → 新 ID 對照表（僅需更動的站號）
// ============================================================
const RENAME_MAP = {
  // ── BR 線：舊 BR06-BR22 各往後一號 ──
  'BR06': 'BR07',
  'BR07': 'BR08',
  'BR08': 'BR09',
  'BR09': 'BR10',
  'BR10': 'BR11',
  'BR11': 'BR12',
  'BR12': 'BR13',
  'BR13': 'BR14',
  'BR14': 'BR15',
  'BR15': 'BR16',
  'BR16': 'BR17',
  'BR17': 'BR18',
  'BR18': 'BR19',
  // 上次新增的 BR19-BR22 也要往後一號
  'BR19': 'BR20',
  'BR20': 'BR21',
  'BR21': 'BR22',
  'BR22': 'BR23',

  // ── G 線：舊 G07-G22 各往前一號 ──
  'G07': 'G06',
  'G08': 'G07',
  'G09': 'G08',
  'G10': 'G09',
  'G11': 'G10',
  'G12': 'G11',
  'G13': 'G12',
  'G14': 'G13',
  'G15': 'G14',
  'G16': 'G15',
  'G17': 'G16',
  'G18': 'G17',
  'G19': 'G18',
  'G22': 'G19',

  // ── R 線：完全反向 ──
  'R02': 'R28',  // 淡水
  'R04': 'R27',  // 紅樹林
  'R05': 'R26',  // 竹圍
  'R07': 'R25',  // 關渡
  'R09': 'R23',  // 復興崗
  'R10': 'R24',  // 忠義
  'R11': 'R22',  // 北投
  'R12': 'R21',  // 奇岩
  'R13': 'R20',  // 唭哩岸
  'R14': 'R19',  // 石牌
  'R15': 'R18',  // 明德
  'R16': 'R17',  // 芝山
  'R17': 'R16',  // 士林
  'R18': 'R15',  // 劍潭
  'R19': 'R14',  // 圓山
  'R20': 'R13',  // 民權西路
  'R21': 'R12',  // 雙連
  'R22': 'R11',  // 中山
  'R23': 'R10',  // 台北車站
  'R24': 'R09',  // 台大醫院
  'R25': 'R08',  // 中正紀念堂
  'R26': 'R07',  // 東門
  'R27': 'R06',  // 大安森林公園
  'R28': 'R05',  // 大安
  'R29': 'R04',  // 信義安和
  'R30': 'R03',  // 台北101/世貿
  'R31': 'R02',  // 象山
};

// ============================================================
// 兩階段安全替換
// 第一階段：舊 ID → '__TEMP_ID_n__'
// 第二階段：'__TEMP_ID_n__' → 新 ID
// 只替換 SQL 字串內的 quoted ID，如 'BR06'（含引號）
// ============================================================
let sql = fs.readFileSync(seedPath, 'utf8');

const tempMap = {}; // oldId → tempKey
const revTempMap = {}; // tempKey → newId

Object.entries(RENAME_MAP).forEach(([oldId, newId], i) => {
  const tempKey = `__TEMP_${i}__`;
  tempMap[oldId] = tempKey;
  revTempMap[tempKey] = newId;
});

// Phase 1: old quoted IDs → temp tokens (e.g., 'BR06' → '__TEMP_0__')
for (const [oldId, tempKey] of Object.entries(tempMap)) {
  // Match quoted station ID: 'XXXX' (with single quotes, as a word boundary via non-alphanumeric)
  const re = new RegExp(`'${oldId}'`, 'g');
  sql = sql.replace(re, `'${tempKey}'`);
}

// Phase 2: temp tokens → new quoted IDs
for (const [tempKey, newId] of Object.entries(revTempMap)) {
  const re = new RegExp(`'${tempKey}'`, 'g');
  sql = sql.replace(re, `'${newId}'`);
}

// ============================================================
// 寫回
// ============================================================
fs.writeFileSync(seedPath, sql, 'utf8');
console.log('✓ Station ID rename complete.');
console.log('  BR06-BR22 → BR07-BR23 (shift +1)');
console.log('  G07-G22   → G06-G19  (shift -1)');
console.log('  R02-R31   → R28-R02  (full reversal)');

// 驗證一些關鍵改動
const sample = [
  ["'BR07'", '六張犁（新）'],
  ["'BR10'", '忠孝復興（新）'],
  ["'G06'", '萬隆（新）'],
  ["'G19'", '松山（新）'],
  ["'R28'", '淡水（新）'],
  ["'R02'", '象山（新）'],
  ["'R10'", '台北車站（新）'],
];
sample.forEach(([id, name]) => {
  const count = (sql.match(new RegExp(id.replace(/'/g, "'"), 'g')) || []).length;
  console.log(`  ${id} (${name}): ${count} occurrences`);
});
