/**
 * MRT Rank — 台北捷運智慧推薦系統
 * 
 * 主應用入口：Hono + Cloudflare Pages
 * 
 * 基於 PageRank 演算法，結合人流轉移矩陣、偏好匹配與旅行成本，
 * 提供可解釋的捷運站點推薦服務。
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './lib/types';
import stationsRoute from './routes/stations';
import pagerankRoute from './routes/pagerank';
import recommendRoute from './routes/recommend';
import stationDetailRoute from './routes/station-detail';

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// 中介層
// ============================================================
app.use('/api/*', cors());

// ============================================================
// API 路由掛載
// ============================================================
app.route('/api/stations', stationsRoute);
app.route('/api/pagerank', pagerankRoute);
app.route('/api/recommend', recommendRoute);
app.route('/api/station-detail', stationDetailRoute);

// API 根路徑
app.get('/api', (c) => {
  return c.json({
    name: 'MRT Rank API',
    version: '1.1.0',
    description: '台北捷運智慧推薦系統 — 基於 PageRank 演算法',
    endpoints: {
      'GET /api/recommend': '核心推薦 API',
      'GET /api/recommend/options': '表單選項',
      'GET /api/stations': '站點列表',
      'GET /api/stations/:id': '站點詳情',
      'GET /api/station-detail/:id': '站點完整詳情（含 PageRank 時序、偏好雷達、連結）',
      'GET /api/pagerank': 'PageRank 排名',
      'GET /api/pagerank/:stationId': '站點各時段 PageRank',
    },
    example: '/api/recommend?from=BL12&time_period=afternoon&preference=food&top_n=5',
  });
});

// ============================================================
// 前端頁面路由
// ============================================================
app.get('/', (c) => c.html(renderHomePage()));
app.get('/station/:id', (c) => c.html(renderStationDetailPage(c.req.param('id'))));

// ============================================================
// 共用 HTML 元件
// ============================================================

function htmlHead(title: string, extra = ''): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script>
    tailwind.config = {
      theme: { extend: { colors: {
        'mrt-blue': '#0070BD', 'mrt-red': '#E3002C',
        'mrt-green': '#1A803F', 'mrt-orange': '#F5A623', 'mrt-brown': '#C48C31',
      }}}
    }
  </script>
  <style>
    @keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
    .fade-in-up { animation: fadeInUp 0.5s ease-out forwards; }
    .fade-in-up-delay-1 { animation-delay:0.1s; opacity:0; }
    .fade-in-up-delay-2 { animation-delay:0.2s; opacity:0; }
    .fade-in-up-delay-3 { animation-delay:0.3s; opacity:0; }
    .fade-in-up-delay-4 { animation-delay:0.4s; opacity:0; }
    .fade-in-up-delay-5 { animation-delay:0.5s; opacity:0; }
    .line-dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
    .score-bar { height:8px; border-radius:4px; transition:width 0.8s ease-out; }
    .option-card { transition:all 0.2s ease; cursor:pointer; }
    .option-card:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,0.1); }
    .option-card.selected { border-color:#3B82F6; background-color:#EFF6FF; }
    .spinner { border:3px solid #f3f3f3; border-top:3px solid #3B82F6; border-radius:50%; width:24px; height:24px; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .rec-card { transition:all 0.3s ease; border-left:4px solid transparent; }
    .rec-card:hover { transform:translateX(4px); box-shadow:0 4px 16px rgba(0,0,0,0.1); }
    .station-dropdown { max-height:300px; overflow-y:auto; }
    .station-dropdown::-webkit-scrollbar { width:6px; }
    .station-dropdown::-webkit-scrollbar-thumb { background-color:#CBD5E0; border-radius:3px; }
    ${extra}
  </style>
</head>`;
}

function htmlNav(active = 'home'): string {
  return `
  <nav class="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 no-underline">
        <span class="text-2xl">🚇</span>
        <h1 class="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          MRT Rank
        </h1>
        <span class="text-sm text-gray-500 hidden sm:inline">台北捷運智慧推薦系統</span>
      </a>
      <div class="flex items-center gap-4 text-sm text-gray-600">
        <a href="/#about" class="hover:text-blue-600 transition-colors">
          <i class="fas fa-info-circle mr-1"></i>演算法
        </a>
        <a href="/api" target="_blank" class="hover:text-blue-600 transition-colors">
          <i class="fas fa-code mr-1"></i>API
        </a>
      </div>
    </div>
  </nav>`;
}

function htmlFooter(): string {
  return `
  <footer class="text-center py-8 text-gray-400 text-sm">
    <p>MRT Rank — 台北捷運智慧推薦系統</p>
    <p class="mt-1">基於 PageRank 演算法的學術專題延伸作品</p>
  </footer>`;
}

// ============================================================
// 首頁（查詢 + 路線圖 + 推薦結果）
// ============================================================
function renderHomePage(): string {
  return `${htmlHead('MRT Rank — 台北捷運智慧推薦系統')}
<body class="bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen">
  ${htmlNav('home')}

  <!-- Hero -->
  <section class="max-w-6xl mx-auto px-4 pt-8 pb-4">
    <div class="text-center mb-6">
      <h2 class="text-3xl sm:text-4xl font-bold text-gray-800 mb-3">搭捷運，下一站去哪？</h2>
      <p class="text-gray-500 text-lg max-w-2xl mx-auto">
        基於 <span class="text-blue-600 font-semibold">PageRank 演算法</span>分析人流轉移模式，結合你的偏好，推薦最值得前往的捷運站
      </p>
    </div>
  </section>

  <!-- ===== 路線圖 + 查詢表單 雙欄佈局 ===== -->
  <section class="max-w-6xl mx-auto px-4 pb-6">
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">

      <!-- 左側：SVG 路線圖 -->
      <div class="lg:col-span-3 bg-white rounded-2xl shadow-lg p-4 relative overflow-hidden">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-bold text-gray-700"><i class="fas fa-map text-blue-500 mr-1"></i>捷運路線圖</h3>
          <span class="text-xs text-gray-400">點擊站點選擇出發站</span>
        </div>
        <div id="mrt-map-container" class="w-full" style="min-height:420px;"></div>
      </div>

      <!-- 右側：查詢表單 -->
      <div class="lg:col-span-2 bg-white rounded-2xl shadow-lg p-6">
        <!-- 出發站 -->
        <div class="mb-5">
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-map-marker-alt text-red-500 mr-1"></i>出發站
          </label>
          <div class="relative">
            <input type="text" id="station-search" placeholder="輸入站名或點擊地圖選擇..."
              class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all" autocomplete="off">
            <input type="hidden" id="selected-station-id" value="">
            <div id="station-dropdown" class="station-dropdown absolute w-full bg-white border border-gray-200 rounded-xl mt-1 shadow-lg hidden z-40"></div>
          </div>
          <div id="selected-station-badge" class="mt-2 hidden"></div>
        </div>

        <!-- 時段 -->
        <div class="mb-5">
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-clock text-blue-500 mr-1"></i>時段
          </label>
          <div class="grid grid-cols-2 gap-2" id="time-period-options">
            <button data-value="morning_peak" class="option-card px-3 py-2 border-2 border-gray-200 rounded-xl text-center text-sm">
              <div class="font-semibold text-xs">🌅 晨峰</div><div class="text-xs text-gray-500">07-09</div>
            </button>
            <button data-value="morning" class="option-card px-3 py-2 border-2 border-gray-200 rounded-xl text-center text-sm">
              <div class="font-semibold text-xs">☀️ 上午</div><div class="text-xs text-gray-500">09-12</div>
            </button>
            <button data-value="noon" class="option-card px-3 py-2 border-2 border-gray-200 rounded-xl text-center text-sm">
              <div class="font-semibold text-xs">🍱 午間</div><div class="text-xs text-gray-500">12-14</div>
            </button>
            <button data-value="afternoon" class="option-card selected px-3 py-2 border-2 border-blue-400 rounded-xl text-center text-sm bg-blue-50">
              <div class="font-semibold text-xs">🌤️ 下午</div><div class="text-xs text-gray-500">14-17</div>
            </button>
            <button data-value="evening_peak" class="option-card px-3 py-2 border-2 border-gray-200 rounded-xl text-center text-sm">
              <div class="font-semibold text-xs">🌇 晚峰</div><div class="text-xs text-gray-500">17-19</div>
            </button>
            <button data-value="night" class="option-card px-3 py-2 border-2 border-gray-200 rounded-xl text-center text-sm">
              <div class="font-semibold text-xs">🌙 夜間</div><div class="text-xs text-gray-500">19-23</div>
            </button>
          </div>
        </div>

        <!-- 偏好 -->
        <div class="mb-6">
          <label class="block text-sm font-semibold text-gray-700 mb-2">
            <i class="fas fa-heart text-pink-500 mr-1"></i>偏好
          </label>
          <div class="grid grid-cols-3 gap-2" id="preference-options">
            <button data-value="all" class="option-card selected px-2 py-2 border-2 border-blue-400 rounded-xl text-center text-xs bg-blue-50">
              <div class="text-lg">✨</div><div class="font-semibold">不限</div>
            </button>
            <button data-value="attraction" class="option-card px-2 py-2 border-2 border-gray-200 rounded-xl text-center text-xs">
              <div class="text-lg">🏛️</div><div class="font-semibold">景點</div>
            </button>
            <button data-value="food" class="option-card px-2 py-2 border-2 border-gray-200 rounded-xl text-center text-xs">
              <div class="text-lg">🍜</div><div class="font-semibold">美食</div>
            </button>
            <button data-value="shopping" class="option-card px-2 py-2 border-2 border-gray-200 rounded-xl text-center text-xs">
              <div class="text-lg">🛍️</div><div class="font-semibold">購物</div>
            </button>
            <button data-value="nightlife" class="option-card px-2 py-2 border-2 border-gray-200 rounded-xl text-center text-xs">
              <div class="text-lg">🌙</div><div class="font-semibold">夜生活</div>
            </button>
            <button data-value="family" class="option-card px-2 py-2 border-2 border-gray-200 rounded-xl text-center text-xs">
              <div class="text-lg">👨‍👩‍👧‍👦</div><div class="font-semibold">親子</div>
            </button>
          </div>
        </div>

        <button id="recommend-btn" onclick="submitRecommendation()"
          class="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-base hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed">
          <i class="fas fa-magic mr-2"></i>開始推薦
        </button>
      </div>
    </div>
  </section>

  <!-- ===== 推薦結果區 ===== -->
  <section id="results-section" class="max-w-6xl mx-auto px-4 pb-8 hidden">
    <div id="query-summary" class="mb-6"></div>
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div class="lg:col-span-3">
        <div id="recommendations-list"></div>
      </div>
      <div class="lg:col-span-2">
        <div id="chart-section" class="bg-white rounded-2xl shadow-lg p-5 hidden">
          <h3 class="text-base font-bold text-gray-800 mb-4"><i class="fas fa-chart-bar text-blue-500 mr-2"></i>分數分析</h3>
          <div class="space-y-5">
            <div><canvas id="score-chart" height="200"></canvas></div>
            <div><canvas id="breakdown-chart" height="200"></canvas></div>
          </div>
        </div>
        <div id="metadata-section" class="mt-4"></div>
      </div>
    </div>
  </section>

  <!-- ===== 演算法說明 ===== -->
  <section id="about" class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
      <h3 class="text-2xl font-bold text-gray-800 mb-6"><i class="fas fa-brain text-purple-500 mr-2"></i>推薦演算法說明</h3>
      <div class="space-y-6 text-gray-700">
        <div>
          <h4 class="font-bold text-lg mb-2">核心概念：PageRank 應用於捷運人流</h4>
          <p class="leading-relaxed">Google 的 PageRank 演算法透過「連結關係」評估網頁重要性。我們將相同概念應用於台北捷運：<strong>人流量就是連結</strong>，越多人從各站流向某一站，該站在該時段就越「重要」。</p>
        </div>
        <div class="bg-gray-50 rounded-xl p-4">
          <h4 class="font-bold mb-2">轉移機率矩陣</h4>
          <p class="font-mono text-sm bg-white rounded-lg p-3 border">p<sub>ij</sub> = &gamma; &times; (e<sub>ij</sub> / s<sub>i</sub>) + (1 - &gamma;) &times; (1 / n)</p>
          <ul class="mt-2 text-sm space-y-1">
            <li>e<sub>ij</sub>：時段內從站 i 到站 j 的人流量</li>
            <li>s<sub>i</sub>：站 i 出發的總人流</li>
            <li>&gamma; = 0.85：阻尼係數</li>
            <li>n：總站數</li>
          </ul>
        </div>
        <div class="bg-blue-50 rounded-xl p-4">
          <h4 class="font-bold mb-2">推薦分數公式</h4>
          <p class="font-mono text-sm bg-white rounded-lg p-3 border">Score(i&rarr;j) = w&sub1;&times;PR<sub>j</sub> + w&sub2;&times;p<sub>ij</sub> + w&sub3;&times;Pref<sub>j</sub> - w&sub4;&times;Cost<sub>ij</sub></p>
          <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-blue-500"></span>w1 = 0.30 — 熱門度</div>
            <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-green-500"></span>w2 = 0.25 — 連結性</div>
            <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-purple-500"></span>w3 = 0.30 — 偏好匹配</div>
            <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-red-500"></span>w4 = 0.15 — 旅行成本</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  ${htmlFooter()}

  <!-- Loading Overlay -->
  <div id="loading-overlay" class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 hidden">
    <div class="bg-white rounded-2xl p-8 shadow-2xl text-center">
      <div class="spinner mx-auto mb-4"></div>
      <p class="text-gray-700 font-semibold">正在計算推薦分數...</p>
      <p class="text-gray-400 text-sm mt-1">基於 PageRank 演算法分析中</p>
    </div>
  </div>

  <!-- SVG Map Module -->
  <script src="/static/mrt-map.js"></script>

  <script>
    // ============================================================
    // 全域狀態
    // ============================================================
    let allStations = [];
    let selectedStation = null;
    let selectedTimePeriod = 'afternoon';
    let selectedPreference = 'all';
    let scoreChart = null;
    let breakdownChart = null;

    const LINE_COLORS = { BL:'#0070BD', R:'#E3002C', G:'#1A803F', O:'#F5A623', BR:'#C48C31', Y:'#FFDB00' };

    // ============================================================
    // 初始化
    // ============================================================
    document.addEventListener('DOMContentLoaded', async () => {
      await loadStations();
      setupEventListeners();
      // 初始化 SVG 路線圖
      MRTMap.init('mrt-map-container', allStations, {
        onSelect: (stationId, stInfo) => {
          if (stInfo) {
            selectStation(stationId);
          }
        }
      });
    });

    async function loadStations() {
      try {
        const res = await fetch('/api/stations');
        const data = await res.json();
        if (data.success) allStations = data.stations;
      } catch (e) { console.error('Failed to load stations:', e); }
    }

    // ============================================================
    // 事件監聽
    // ============================================================
    function setupEventListeners() {
      const searchInput = document.getElementById('station-search');
      searchInput.addEventListener('input', (e) => {
        const kw = e.target.value.trim();
        kw.length > 0 ? showStationDropdown(kw) : hideStationDropdown();
      });
      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length > 0) showStationDropdown(searchInput.value.trim());
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#station-search') && !e.target.closest('#station-dropdown')) hideStationDropdown();
      });
      // 時段
      document.querySelectorAll('#time-period-options .option-card').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#time-period-options .option-card').forEach(b => {
            b.classList.remove('selected','border-blue-400','bg-blue-50');
            b.classList.add('border-gray-200');
          });
          btn.classList.add('selected','border-blue-400','bg-blue-50');
          btn.classList.remove('border-gray-200');
          selectedTimePeriod = btn.dataset.value;
        });
      });
      // 偏好
      document.querySelectorAll('#preference-options .option-card').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#preference-options .option-card').forEach(b => {
            b.classList.remove('selected','border-blue-400','bg-blue-50');
            b.classList.add('border-gray-200');
          });
          btn.classList.add('selected','border-blue-400','bg-blue-50');
          btn.classList.remove('border-gray-200');
          selectedPreference = btn.dataset.value;
        });
      });
    }

    // ============================================================
    // 站點搜尋與選擇
    // ============================================================
    function showStationDropdown(keyword) {
      const dropdown = document.getElementById('station-dropdown');
      const kw = keyword.toLowerCase();
      const filtered = allStations.filter(s =>
        s.name_zh.includes(keyword) ||
        (s.name_en && s.name_en.toLowerCase().includes(kw)) ||
        s.id.toLowerCase().includes(kw)
      ).slice(0, 15);

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="px-4 py-3 text-gray-400 text-sm">找不到符合的站點</div>';
      } else {
        dropdown.innerHTML = filtered.map(s => {
          const color = LINE_COLORS[s.line] || '#999';
          return \`<div class="px-4 py-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 transition-colors"
            onclick="selectStation('\${s.id}')">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:\${color}"></span>
            <span class="font-semibold">\${s.name_zh}</span>
            <span class="text-xs text-gray-400">\${s.id}</span>
            \${s.is_transfer_station ? '<span class="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">轉乘</span>' : ''}
          </div>\`;
        }).join('');
      }
      dropdown.classList.remove('hidden');
    }

    function hideStationDropdown() {
      document.getElementById('station-dropdown').classList.add('hidden');
    }

    function selectStation(stationId) {
      const station = allStations.find(s => s.id === stationId);
      if (!station) return;
      selectedStation = station;
      document.getElementById('selected-station-id').value = stationId;
      document.getElementById('station-search').value = station.name_zh;
      hideStationDropdown();
      const badge = document.getElementById('selected-station-badge');
      const color = LINE_COLORS[station.line] || '#999';
      badge.innerHTML = \`
        <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold text-white"
              style="background:\${color}">
          <i class="fas fa-map-pin"></i> \${station.name_zh} (\${station.id})
          <button onclick="clearStation()" class="ml-1 hover:opacity-70">&times;</button>
        </span>
        <a href="/station/\${station.id}" class="ml-2 text-xs text-blue-500 hover:text-blue-700 hover:underline">
          <i class="fas fa-external-link-alt mr-1"></i>站點詳情
        </a>\`;
      badge.classList.remove('hidden');
      // 同步地圖
      MRTMap.setSelected(stationId);
    }

    function clearStation() {
      selectedStation = null;
      document.getElementById('selected-station-id').value = '';
      document.getElementById('station-search').value = '';
      document.getElementById('selected-station-badge').classList.add('hidden');
      MRTMap.clearSelected();
    }

    // ============================================================
    // 推薦提交
    // ============================================================
    async function submitRecommendation() {
      if (!selectedStation) {
        alert('請先選擇出發站！');
        document.getElementById('station-search').focus();
        return;
      }
      const btn = document.getElementById('recommend-btn');
      const loading = document.getElementById('loading-overlay');
      btn.disabled = true;
      loading.classList.remove('hidden');
      try {
        const params = new URLSearchParams({
          from: selectedStation.id, time_period: selectedTimePeriod,
          preference: selectedPreference, top_n: '5',
        });
        const res = await fetch(\`/api/recommend?\${params}\`);
        const data = await res.json();
        if (data.success) {
          renderResults(data);
          // 在地圖上高亮推薦站
          const ids = data.recommendations.map(r => r.station.id);
          MRTMap.highlightStations(ids);
        } else {
          alert(\`推薦失敗：\${data.error}\`);
        }
      } catch (e) { alert('網路錯誤'); console.error(e); }
      finally { btn.disabled = false; loading.classList.add('hidden'); }
    }

    // ============================================================
    // 結果渲染
    // ============================================================
    function renderResults(data) {
      const section = document.getElementById('results-section');
      section.classList.remove('hidden');
      section.scrollIntoView({ behavior:'smooth', block:'start' });

      const q = data.query;
      document.getElementById('query-summary').innerHTML = \`
        <div class="bg-white rounded-xl p-4 shadow-sm flex flex-wrap items-center gap-3 text-sm">
          <span class="font-semibold text-gray-700">查詢條件：</span>
          <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full"><i class="fas fa-map-marker-alt mr-1"></i>\${q.from_station.name}</span>
          <span class="bg-green-100 text-green-700 px-3 py-1 rounded-full"><i class="fas fa-clock mr-1"></i>\${q.time_period_label}</span>
          <span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-full"><i class="fas fa-heart mr-1"></i>\${q.preference_label}</span>
          <span class="text-gray-400 ml-auto">共評估 \${data.metadata.total_stations_evaluated} 站</span>
        </div>\`;

      const recs = data.recommendations;
      if (recs.length === 0) {
        document.getElementById('recommendations-list').innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fas fa-search text-4xl mb-4"></i><p>沒有足夠資料</p></div>';
        return;
      }
      const maxScore = recs[0].total_score;
      document.getElementById('recommendations-list').innerHTML = recs.map((rec, i) => {
        const color = LINE_COLORS[rec.station.line] || '#999';
        const pct = maxScore > 0 ? (rec.total_score / maxScore * 100) : 0;
        const bd = rec.score_breakdown;
        return \`
          <div class="rec-card bg-white rounded-xl p-5 shadow-sm mb-4 fade-in-up fade-in-up-delay-\${i+1}" style="border-left-color:\${color}">
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-3">
                <span class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md" style="background:\${color}">\${rec.rank}</span>
                <div>
                  <h4 class="font-bold text-lg text-gray-800">
                    <a href="/station/\${rec.station.id}" class="hover:text-blue-600 transition-colors">\${rec.station.name_zh}</a>
                  </h4>
                  <div class="flex items-center gap-2 text-xs text-gray-500">
                    <span>\${rec.station.id}</span><span>\${rec.station.district || ''}</span>
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-2xl font-bold text-gray-800">\${rec.total_score.toFixed(2)}</div>
                <div class="text-xs text-gray-400">推薦分數</div>
              </div>
            </div>
            <div class="mb-3"><div class="w-full bg-gray-100 rounded-full h-2"><div class="score-bar bg-gradient-to-r from-blue-500 to-purple-500 rounded-full" style="width:\${pct}%"></div></div></div>
            <div class="flex flex-wrap gap-1.5 mb-3">
              \${rec.tags.map(t => '<span class="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">' + t + '</span>').join('')}
            </div>
            <div class="space-y-1 mb-3">\${rec.reasons.map(r => '<p class="text-sm text-gray-600">' + r + '</p>').join('')}</div>
            <details class="mt-2">
              <summary class="text-xs text-blue-500 cursor-pointer hover:text-blue-700 select-none"><i class="fas fa-chart-pie mr-1"></i>查看分數拆解</summary>
              <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div class="bg-blue-50 rounded-lg p-2.5 text-center">
                  <div class="text-blue-600 font-bold text-lg">\${(bd.popularity.weighted*100).toFixed(1)}%</div>
                  <div class="text-blue-500 mt-0.5">🔥 熱門度</div>
                </div>
                <div class="bg-green-50 rounded-lg p-2.5 text-center">
                  <div class="text-green-600 font-bold text-lg">\${(bd.connectivity.weighted*100).toFixed(1)}%</div>
                  <div class="text-green-500 mt-0.5">🔗 連結性</div>
                </div>
                <div class="bg-purple-50 rounded-lg p-2.5 text-center">
                  <div class="text-purple-600 font-bold text-lg">\${(bd.preference_match.weighted*100).toFixed(1)}%</div>
                  <div class="text-purple-500 mt-0.5">💜 偏好</div>
                </div>
                <div class="bg-red-50 rounded-lg p-2.5 text-center">
                  <div class="text-red-600 font-bold text-lg">-\${(bd.travel_cost.weighted*100).toFixed(1)}%</div>
                  <div class="text-red-500 mt-0.5">🚇 成本</div>
                </div>
              </div>
            </details>
          </div>\`;
      }).join('');

      renderCharts(recs);
      renderMetadata(data.metadata);
    }

    function renderCharts(recs) {
      const section = document.getElementById('chart-section');
      section.classList.remove('hidden');
      if (scoreChart) scoreChart.destroy();
      if (breakdownChart) breakdownChart.destroy();
      const labels = recs.map(r => r.station.name_zh);
      const colors = recs.map(r => LINE_COLORS[r.station.line] || '#999');

      scoreChart = new Chart(document.getElementById('score-chart'), {
        type:'bar', data:{ labels,
          datasets:[{ label:'推薦分數', data:recs.map(r=>r.total_score),
            backgroundColor:colors.map(c=>c+'80'), borderColor:colors, borderWidth:2, borderRadius:8 }]
        }, options:{ responsive:true, plugins:{ title:{display:true,text:'Top 5 推薦分數',font:{size:13}}, legend:{display:false}},
          scales:{ y:{beginAtZero:true,max:1}}}
      });

      breakdownChart = new Chart(document.getElementById('breakdown-chart'), {
        type:'bar', data:{ labels,
          datasets:[
            { label:'熱門度', data:recs.map(r=>r.score_breakdown.popularity.weighted), backgroundColor:'#3B82F680', borderColor:'#3B82F6', borderWidth:1 },
            { label:'連結性', data:recs.map(r=>r.score_breakdown.connectivity.weighted), backgroundColor:'#10B98180', borderColor:'#10B981', borderWidth:1 },
            { label:'偏好', data:recs.map(r=>r.score_breakdown.preference_match.weighted), backgroundColor:'#8B5CF680', borderColor:'#8B5CF6', borderWidth:1 },
            { label:'成本(扣)', data:recs.map(r=> -r.score_breakdown.travel_cost.weighted), backgroundColor:'#EF444480', borderColor:'#EF4444', borderWidth:1 },
          ]
        }, options:{ responsive:true, plugins:{title:{display:true,text:'維度拆解',font:{size:13}}},
          scales:{x:{stacked:true},y:{stacked:true}}}
      });
    }

    function renderMetadata(meta) {
      document.getElementById('metadata-section').innerHTML = \`
        <div class="bg-gray-50 rounded-xl p-4 text-xs text-gray-500">
          <div class="flex flex-wrap gap-4">
            <span><strong>演算法：</strong>\${meta.algorithm}</span>
            <span><strong>&gamma;：</strong>\${meta.gamma}</span>
            <span><strong>權重：</strong>w1=\${meta.weights.w1} w2=\${meta.weights.w2} w3=\${meta.weights.w3} w4=\${meta.weights.w4}</span>
          </div>
        </div>\`;
    }
  </script>
</body>
</html>`;
}

// ============================================================
// 站點詳情頁
// ============================================================
function renderStationDetailPage(stationId: string): string {
  return `${htmlHead('站點詳情 — MRT Rank', `
    .detail-card { background:#fff; border-radius:16px; box-shadow:0 2px 12px rgba(0,0,0,0.06); padding:24px; }
  `)}
<body class="bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen">
  ${htmlNav('detail')}

  <div class="max-w-5xl mx-auto px-4 py-8" id="detail-app">
    <!-- 載入中 -->
    <div id="detail-loading" class="text-center py-20">
      <div class="spinner mx-auto mb-4"></div>
      <p class="text-gray-500">載入站點資料中...</p>
    </div>

    <!-- 站點資訊（動態填入） -->
    <div id="detail-content" class="hidden"></div>
  </div>

  ${htmlFooter()}

  <script src="/static/mrt-map.js"></script>

  <script>
    const STATION_ID = '${stationId}';
    const LINE_COLORS = { BL:'#0070BD', R:'#E3002C', G:'#1A803F', O:'#F5A623', BR:'#C48C31' };
    let prChart = null;
    let radarChart = null;

    document.addEventListener('DOMContentLoaded', loadStationDetail);

    async function loadStationDetail() {
      try {
        const res = await fetch(\`/api/station-detail/\${STATION_ID}\`);
        const data = await res.json();
        if (!data.success) {
          document.getElementById('detail-loading').innerHTML = \`
            <div class="text-center py-20">
              <i class="fas fa-exclamation-triangle text-4xl text-yellow-400 mb-4"></i>
              <p class="text-gray-500">找不到站點：\${STATION_ID}</p>
              <a href="/" class="text-blue-500 hover:underline mt-2 inline-block">返回首頁</a>
            </div>\`;
          return;
        }
        document.getElementById('detail-loading').classList.add('hidden');
        document.getElementById('detail-content').classList.remove('hidden');
        renderStationDetail(data);
      } catch (e) {
        console.error(e);
        document.getElementById('detail-loading').innerHTML = '<p class="text-red-500 text-center py-20">載入失敗</p>';
      }
    }

    function renderStationDetail(data) {
      const { station, pagerank, preference, connections } = data;
      const lineColor = station.line_color || LINE_COLORS[station.line] || '#999';
      const container = document.getElementById('detail-content');

      // 上方 Header
      container.innerHTML = \`
        <!-- 麵包屑 -->
        <div class="mb-4 text-sm text-gray-500">
          <a href="/" class="hover:text-blue-600">首頁</a> / 
          <span class="text-gray-700 font-semibold">\${station.name_zh}</span>
        </div>

        <!-- 站點 Header -->
        <div class="detail-card mb-6 fade-in-up">
          <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div class="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg"
                 style="background:\${lineColor}">
              \${station.id}
            </div>
            <div class="flex-1">
              <h2 class="text-2xl font-bold text-gray-800">\${station.name_zh}</h2>
              <p class="text-gray-500">\${station.name_en || ''} &middot; \${station.line_name || station.line} &middot; \${station.district || ''}</p>
              <div class="flex flex-wrap gap-2 mt-2">
                \${station.is_transfer_station ? '<span class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold"><i class="fas fa-exchange-alt mr-1"></i>轉乘站</span>' : ''}
                \${pagerank.best_period ? \`<span class="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold"><i class="fas fa-fire mr-1"></i>最佳時段：\${pagerank.best_period.time_period_label}（排名 #\${pagerank.best_period.pr_rank || '?'}）</span>\` : ''}
              </div>
            </div>
            <a href="/?from=\${station.id}" class="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-sm font-semibold hover:shadow-lg transition-all no-underline">
              <i class="fas fa-magic mr-1"></i>以此站推薦
            </a>
          </div>
        </div>

        <!-- 圖表區：PR 時序 + 偏好雷達 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div class="detail-card fade-in-up fade-in-up-delay-1">
            <h3 class="text-base font-bold text-gray-700 mb-3">
              <i class="fas fa-chart-line text-blue-500 mr-1"></i>PageRank 各時段變化
            </h3>
            <canvas id="pr-time-chart" height="250"></canvas>
          </div>
          <div class="detail-card fade-in-up fade-in-up-delay-2">
            <h3 class="text-base font-bold text-gray-700 mb-3">
              <i class="fas fa-spider text-purple-500 mr-1"></i>偏好特徵雷達
            </h3>
            <canvas id="preference-radar" height="250"></canvas>
          </div>
        </div>

        <!-- 偏好標籤詳情 -->
        <div class="detail-card mb-6 fade-in-up fade-in-up-delay-3">
          <h3 class="text-base font-bold text-gray-700 mb-3">
            <i class="fas fa-tags text-pink-500 mr-1"></i>偏好標籤詳情
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" id="tag-details"></div>
        </div>

        <!-- 人流連結 -->
        <div class="detail-card mb-6 fade-in-up fade-in-up-delay-4">
          <h3 class="text-base font-bold text-gray-700 mb-3">
            <i class="fas fa-project-diagram text-green-500 mr-1"></i>主要人流連結
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 class="text-sm font-semibold text-gray-600 mb-2">🔵 從此站出發 → 目的站</h4>
              <div id="outbound-list" class="space-y-2"></div>
            </div>
            <div>
              <h4 class="text-sm font-semibold text-gray-600 mb-2">🔴 來源站 → 此站</h4>
              <div id="inbound-list" class="space-y-2"></div>
            </div>
          </div>
        </div>
      \`;

      // 繪製 PageRank 時序圖
      renderPRChart(pagerank.time_series, lineColor);
      // 繪製偏好雷達圖
      renderRadarChart(preference, lineColor);
      // 偏好標籤
      renderTagDetails(preference);
      // 人流連結
      renderConnections(connections);
    }

    function renderPRChart(timeSeries, lineColor) {
      const order = ['morning_peak','morning','noon','afternoon','evening_peak','night'];
      const sorted = order.map(p => timeSeries.find(t => t.time_period === p)).filter(Boolean);
      
      if (sorted.length === 0) {
        document.getElementById('pr-time-chart').parentElement.innerHTML += '<p class="text-gray-400 text-sm text-center py-4">此站無 PageRank 資料</p>';
        return;
      }

      prChart = new Chart(document.getElementById('pr-time-chart'), {
        type: 'line',
        data: {
          labels: sorted.map(s => s.time_period_label.split('(')[0].trim()),
          datasets: [{
            label: 'PageRank 值',
            data: sorted.map(s => s.pr_value),
            borderColor: lineColor,
            backgroundColor: lineColor + '20',
            fill: true,
            tension: 0.3,
            pointRadius: 6,
            pointHoverRadius: 9,
            pointBackgroundColor: lineColor,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => {
                  const d = sorted[ctx.dataIndex];
                  return d ? \`排名: #\${d.pr_rank || '?'}\` : '';
                }
              }
            }
          },
          scales: {
            y: { beginAtZero: true, title: { display: true, text: 'PageRank 值' } },
            x: { title: { display: true, text: '時段' } }
          }
        }
      });
    }

    function renderRadarChart(pref, lineColor) {
      radarChart = new Chart(document.getElementById('preference-radar'), {
        type: 'radar',
        data: {
          labels: pref.labels,
          datasets: [{
            label: '偏好分數',
            data: pref.scores,
            backgroundColor: lineColor + '30',
            borderColor: lineColor,
            borderWidth: 2,
            pointBackgroundColor: lineColor,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 5,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            r: {
              min: 0, max: 1,
              ticks: { stepSize: 0.2, backdropColor: 'transparent', font: { size: 10 } },
              pointLabels: { font: { size: 13, weight: 'bold' } },
            }
          }
        }
      });
    }

    function renderTagDetails(pref) {
      const emojis = { '景點': '🏛️', '美食': '🍜', '購物': '🛍️', '夜生活': '🌙', '親子': '👨‍👩‍👧‍👦' };
      const colors = { '景點': 'blue', '美食': 'orange', '購物': 'pink', '夜生活': 'purple', '親子': 'green' };
      const container = document.getElementById('tag-details');
      container.innerHTML = pref.labels.map((label, i) => {
        const score = pref.scores[i];
        const reason = pref.reasons[label] || '—';
        const c = colors[label] || 'gray';
        const pct = Math.round(score * 100);
        return \`
          <div class="bg-\${c}-50 rounded-xl p-3">
            <div class="flex items-center justify-between mb-1">
              <span class="font-semibold text-sm">\${emojis[label] || ''} \${label}</span>
              <span class="text-sm font-bold text-\${c}-600">\${pct}%</span>
            </div>
            <div class="w-full bg-\${c}-100 rounded-full h-2 mb-2">
              <div class="h-2 rounded-full bg-\${c}-400" style="width:\${pct}%"></div>
            </div>
            <p class="text-xs text-gray-600 leading-relaxed">\${reason}</p>
          </div>\`;
      }).join('');
    }

    function renderConnections(conn) {
      // Outbound
      const outEl = document.getElementById('outbound-list');
      if (conn.outbound.length === 0) {
        outEl.innerHTML = '<p class="text-gray-400 text-sm">無資料</p>';
      } else {
        // 按時段分組只取前幾筆
        const groups = {};
        conn.outbound.forEach(c => {
          if (!groups[c.time_period]) groups[c.time_period] = [];
          if (groups[c.time_period].length < 5) groups[c.time_period].push(c);
        });
        // 取 afternoon 為預設顯示
        const display = groups['afternoon'] || groups[Object.keys(groups)[0]] || [];
        outEl.innerHTML = display.map(c => {
          const color = c.line_color || LINE_COLORS[c.line] || '#999';
          return \`<div class="flex items-center gap-2 text-sm">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:\${color}"></span>
            <a href="/station/\${c.to_station_id}" class="font-semibold text-gray-700 hover:text-blue-600">\${c.name_zh}</a>
            <span class="text-gray-400 text-xs">\${c.to_station_id}</span>
            <span class="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">\${(c.transition_prob * 100).toFixed(1)}%</span>
          </div>\`;
        }).join('');
      }

      // Inbound
      const inEl = document.getElementById('inbound-list');
      if (conn.inbound.length === 0) {
        inEl.innerHTML = '<p class="text-gray-400 text-sm">無資料</p>';
      } else {
        const unique = {};
        conn.inbound.forEach(c => {
          if (!unique[c.from_station_id] || c.transition_prob > unique[c.from_station_id].transition_prob)
            unique[c.from_station_id] = c;
        });
        const display = Object.values(unique).sort((a,b) => b.transition_prob - a.transition_prob).slice(0, 5);
        inEl.innerHTML = display.map(c => {
          const color = c.line_color || LINE_COLORS[c.line] || '#999';
          return \`<div class="flex items-center gap-2 text-sm">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:\${color}"></span>
            <a href="/station/\${c.from_station_id}" class="font-semibold text-gray-700 hover:text-blue-600">\${c.name_zh}</a>
            <span class="text-gray-400 text-xs">\${c.from_station_id}</span>
            <span class="ml-auto text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">\${(c.transition_prob * 100).toFixed(1)}%</span>
          </div>\`;
        }).join('');
      }
    }
  </script>
</body>
</html>`;
}

export default app;
