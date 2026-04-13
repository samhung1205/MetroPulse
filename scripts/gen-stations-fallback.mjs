/**
 * 從 seed.sql 擷取 stations INSERT 列，產出 public/static/stations-fallback.json
 * 供 D1 尚未有資料時，首頁搜尋與路線圖仍能運作。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const seedPath = path.join(root, 'seed.sql');
const outPath = path.join(root, 'public', 'static', 'stations-fallback.json');

const sql = fs.readFileSync(seedPath, 'utf8');
const lines = sql.split('\n');

/** 僅匹配 stations 表列（line 須為 BL/R/G/O/BR/Y，避免誤抓 pagerank 等區塊） */
const rowRe =
  /^\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*'(BL|R|G|O|BR|Y)',\s*'([^']*)',\s*'([^']*)',\s*(\d+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)/;

const stations = [];
for (const rawLine of lines) {
  const t = rawLine.trim();
  if (!t.startsWith("('")) continue;
  const m = t.match(rowRe);
  if (!m) continue;
  const [
    ,
    id,
    name_zh,
    name_en,
    lineCode,
    line_name,
    line_color,
    station_number,
    latitude,
    longitude,
    is_transfer_station,
  ] = m;
  stations.push({
    id,
    name_zh,
    name_en: name_en || null,
    line: lineCode,
    line_name: line_name || null,
    line_color: line_color || null,
    station_number: Number(station_number),
    latitude: Number(latitude),
    longitude: Number(longitude),
    is_transfer_station: Number(is_transfer_station),
    transfer_lines: null,
    district: null,
    address: null,
  });
}

stations.sort((a, b) => (a.line === b.line ? a.station_number - b.station_number : a.line.localeCompare(b.line)));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(stations, null, 0), 'utf8');
console.log('Wrote', stations.length, 'stations to', path.relative(root, outPath));
