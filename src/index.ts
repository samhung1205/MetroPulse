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

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// 中介層
// ============================================================

// 啟用 CORS（開發與跨域存取）
app.use('/api/*', cors());

// ============================================================
// API 路由掛載
// ============================================================

app.route('/api/stations', stationsRoute);
app.route('/api/pagerank', pagerankRoute);
app.route('/api/recommend', recommendRoute);

// API 根路徑 — 服務狀態
app.get('/api', (c) => {
  return c.json({
    name: 'MRT Rank API',
    version: '1.0.0',
    description: '台北捷運智慧推薦系統 — 基於 PageRank 演算法',
    endpoints: {
      'GET /api/recommend': '核心推薦 API — 輸入出發站、時段、偏好，取得 Top N 推薦',
      'GET /api/recommend/options': '取得表單選項（站點、時段、偏好）',
      'GET /api/stations': '取得所有站點列表',
      'GET /api/stations/:id': '取得單一站點詳情',
      'GET /api/pagerank': '取得 PageRank 排名',
      'GET /api/pagerank/:stationId': '取得站點各時段 PageRank',
    },
    example: '/api/recommend?from=BL12&time_period=afternoon&preference=food&top_n=5',
  });
});

// ============================================================
// 前端頁面路由
// ============================================================

app.get('/', (c) => {
  return c.html(renderHomePage());
});

// ============================================================
// 前端 HTML 渲染
// ============================================================

function renderHomePage(): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MRT Rank — 台北捷運智慧推薦系統</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            'mrt-blue': '#0070BD',
            'mrt-red': '#E3002C',
            'mrt-green': '#1A803F',
            'mrt-orange': '#F5A623',
            'mrt-brown': '#C48C31',
          }
        }
      }
    }
  </script>
  <style>
    /* 自定義動畫 */
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .fade-in-up { animation: fadeInUp 0.5s ease-out forwards; }
    .fade-in-up-delay-1 { animation-delay: 0.1s; opacity: 0; }
    .fade-in-up-delay-2 { animation-delay: 0.2s; opacity: 0; }
    .fade-in-up-delay-3 { animation-delay: 0.3s; opacity: 0; }
    .fade-in-up-delay-4 { animation-delay: 0.4s; opacity: 0; }
    .fade-in-up-delay-5 { animation-delay: 0.5s; opacity: 0; }

    /* 路線色標 */
    .line-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .line-BL { background-color: #0070BD; }
    .line-R { background-color: #E3002C; }
    .line-G { background-color: #1A803F; }
    .line-O { background-color: #F5A623; }
    .line-BR { background-color: #C48C31; }

    /* 分數條 */
    .score-bar {
      height: 8px;
      border-radius: 4px;
      transition: width 0.8s ease-out;
    }
    
    /* 選項卡片 hover */
    .option-card {
      transition: all 0.2s ease;
      cursor: pointer;
    }
    .option-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .option-card.selected {
      ring: 2px;
      border-color: #3B82F6;
      background-color: #EFF6FF;
    }

    /* Loading spinner */
    .spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #3B82F6;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* 推薦卡片 */
    .rec-card {
      transition: all 0.3s ease;
      border-left: 4px solid transparent;
    }
    .rec-card:hover {
      transform: translateX(4px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    }

    /* 搜尋下拉 */
    .station-dropdown {
      max-height: 300px;
      overflow-y: auto;
    }
    .station-dropdown::-webkit-scrollbar {
      width: 6px;
    }
    .station-dropdown::-webkit-scrollbar-thumb {
      background-color: #CBD5E0;
      border-radius: 3px;
    }
  </style>
</head>
<body class="bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen">

  <!-- ===== 頂部導覽列 ===== -->
  <nav class="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-2xl">🚇</span>
        <h1 class="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          MRT Rank
        </h1>
        <span class="text-sm text-gray-500 hidden sm:inline">台北捷運智慧推薦系統</span>
      </div>
      <div class="flex items-center gap-4 text-sm text-gray-600">
        <a href="#about" class="hover:text-blue-600 transition-colors">
          <i class="fas fa-info-circle mr-1"></i>演算法說明
        </a>
        <a href="/api" target="_blank" class="hover:text-blue-600 transition-colors">
          <i class="fas fa-code mr-1"></i>API
        </a>
      </div>
    </div>
  </nav>

  <!-- ===== Hero 區塊 ===== -->
  <section class="max-w-6xl mx-auto px-4 pt-8 pb-4">
    <div class="text-center mb-8">
      <h2 class="text-3xl sm:text-4xl font-bold text-gray-800 mb-3">
        搭捷運，下一站去哪？
      </h2>
      <p class="text-gray-500 text-lg max-w-2xl mx-auto">
        基於 <span class="text-blue-600 font-semibold">PageRank 演算法</span>分析人流轉移模式，
        結合你的偏好，推薦最值得前往的捷運站
      </p>
    </div>
  </section>

  <!-- ===== 查詢表單 ===== -->
  <section class="max-w-4xl mx-auto px-4 pb-8">
    <div class="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
      
      <!-- Step 1: 出發站 -->
      <div class="mb-6">
        <label class="block text-sm font-semibold text-gray-700 mb-2">
          <i class="fas fa-map-marker-alt text-red-500 mr-1"></i>
          出發站
        </label>
        <div class="relative">
          <input 
            type="text" 
            id="station-search" 
            placeholder="輸入站名搜尋，如：台北車站、西門、101..."
            class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all text-lg"
            autocomplete="off"
          >
          <input type="hidden" id="selected-station-id" value="">
          <div id="station-dropdown" class="station-dropdown absolute w-full bg-white border border-gray-200 rounded-xl mt-1 shadow-lg hidden z-40">
          </div>
        </div>
        <div id="selected-station-badge" class="mt-2 hidden">
        </div>
      </div>

      <!-- Step 2: 時段 -->
      <div class="mb-6">
        <label class="block text-sm font-semibold text-gray-700 mb-2">
          <i class="fas fa-clock text-blue-500 mr-1"></i>
          時段
        </label>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3" id="time-period-options">
          <button data-value="morning_peak" class="option-card px-4 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="font-semibold">🌅 晨峰</div>
            <div class="text-xs text-gray-500">07:00-09:00</div>
          </button>
          <button data-value="morning" class="option-card px-4 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="font-semibold">☀️ 上午</div>
            <div class="text-xs text-gray-500">09:00-12:00</div>
          </button>
          <button data-value="noon" class="option-card px-4 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="font-semibold">🍱 午間</div>
            <div class="text-xs text-gray-500">12:00-14:00</div>
          </button>
          <button data-value="afternoon" class="option-card selected px-4 py-3 border-2 border-blue-400 rounded-xl text-center text-sm bg-blue-50">
            <div class="font-semibold">🌤️ 下午</div>
            <div class="text-xs text-gray-500">14:00-17:00</div>
          </button>
          <button data-value="evening_peak" class="option-card px-4 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="font-semibold">🌇 晚峰</div>
            <div class="text-xs text-gray-500">17:00-19:00</div>
          </button>
          <button data-value="night" class="option-card px-4 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="font-semibold">🌙 夜間</div>
            <div class="text-xs text-gray-500">19:00-23:00</div>
          </button>
        </div>
      </div>

      <!-- Step 3: 偏好 -->
      <div class="mb-8">
        <label class="block text-sm font-semibold text-gray-700 mb-2">
          <i class="fas fa-heart text-pink-500 mr-1"></i>
          偏好類型
        </label>
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-3" id="preference-options">
          <button data-value="all" class="option-card selected px-3 py-3 border-2 border-blue-400 rounded-xl text-center text-sm bg-blue-50">
            <div class="text-xl mb-1">✨</div>
            <div class="font-semibold text-xs">不限</div>
          </button>
          <button data-value="attraction" class="option-card px-3 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="text-xl mb-1">🏛️</div>
            <div class="font-semibold text-xs">景點</div>
          </button>
          <button data-value="food" class="option-card px-3 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="text-xl mb-1">🍜</div>
            <div class="font-semibold text-xs">美食</div>
          </button>
          <button data-value="shopping" class="option-card px-3 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="text-xl mb-1">🛍️</div>
            <div class="font-semibold text-xs">購物</div>
          </button>
          <button data-value="nightlife" class="option-card px-3 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="text-xl mb-1">🌙</div>
            <div class="font-semibold text-xs">夜生活</div>
          </button>
          <button data-value="family" class="option-card px-3 py-3 border-2 border-gray-200 rounded-xl text-center text-sm hover:border-blue-400">
            <div class="text-xl mb-1">👨‍👩‍👧‍👦</div>
            <div class="font-semibold text-xs">親子</div>
          </button>
        </div>
      </div>

      <!-- 推薦按鈕 -->
      <button 
        id="recommend-btn"
        class="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold text-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
        onclick="submitRecommendation()"
      >
        <i class="fas fa-magic mr-2"></i>
        開始推薦
      </button>
    </div>
  </section>

  <!-- ===== 推薦結果區 ===== -->
  <section id="results-section" class="max-w-4xl mx-auto px-4 pb-8 hidden">
    
    <!-- 查詢條件摘要 -->
    <div id="query-summary" class="mb-6"></div>

    <!-- 推薦卡片 -->
    <div id="recommendations-list"></div>

    <!-- 分數分佈圖表 -->
    <div id="chart-section" class="mt-8 bg-white rounded-2xl shadow-lg p-6 hidden">
      <h3 class="text-lg font-bold text-gray-800 mb-4">
        <i class="fas fa-chart-bar text-blue-500 mr-2"></i>推薦分數分析
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <canvas id="score-chart" height="250"></canvas>
        </div>
        <div>
          <canvas id="breakdown-chart" height="250"></canvas>
        </div>
      </div>
    </div>

    <!-- 演算法說明 -->
    <div id="metadata-section" class="mt-6"></div>
  </section>

  <!-- ===== 演算法說明區 ===== -->
  <section id="about" class="max-w-4xl mx-auto px-4 py-12">
    <div class="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
      <h3 class="text-2xl font-bold text-gray-800 mb-6">
        <i class="fas fa-brain text-purple-500 mr-2"></i>推薦演算法說明
      </h3>
      
      <div class="space-y-6 text-gray-700">
        <div>
          <h4 class="font-bold text-lg mb-2">核心概念：PageRank 應用於捷運人流</h4>
          <p class="leading-relaxed">
            Google 的 PageRank 演算法透過「連結關係」評估網頁重要性。
            我們將相同概念應用於台北捷運：<strong>人流量就是連結</strong>，
            越多人從各站流向某一站，該站在該時段就越「重要」。
          </p>
        </div>

        <div class="bg-gray-50 rounded-xl p-4">
          <h4 class="font-bold mb-2">轉移機率矩陣</h4>
          <p class="font-mono text-sm bg-white rounded-lg p-3 border">
            p<sub>ij</sub> = γ × (e<sub>ij</sub> / s<sub>i</sub>) + (1 - γ) × (1 / n)
          </p>
          <ul class="mt-2 text-sm space-y-1">
            <li>• <code>e<sub>ij</sub></code>：時段內從站 i 到站 j 的人流量</li>
            <li>• <code>s<sub>i</sub></code>：站 i 出發的總人流</li>
            <li>• <code>γ = 0.85</code>：阻尼係數 (Damping Factor)</li>
            <li>• <code>n</code>：總站數</li>
          </ul>
        </div>

        <div class="bg-blue-50 rounded-xl p-4">
          <h4 class="font-bold mb-2">推薦分數公式</h4>
          <p class="font-mono text-sm bg-white rounded-lg p-3 border">
            Score(i→j) = w₁×PR<sub>j</sub> + w₂×p<sub>ij</sub> + w₃×Pref<sub>j</sub> - w₄×Cost<sub>ij</sub>
          </p>
          <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-blue-500"></span>
              <span>w₁ = 0.30 — 時段熱門度</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-green-500"></span>
              <span>w₂ = 0.25 — 人流連結性</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-purple-500"></span>
              <span>w₃ = 0.30 — 偏好匹配度</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-red-500"></span>
              <span>w₄ = 0.15 — 旅行成本</span>
            </div>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-lg mb-2">可解釋性設計</h4>
          <p class="leading-relaxed">
            每個推薦結果都會展示<strong>分數拆解</strong>，
            清楚說明熱門度、連結性、偏好匹配與旅行成本各佔多少，
            讓使用者理解「為什麼推薦這一站」。
            這是<strong>規則式推薦</strong>的優勢——完全透明、可調整。
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== Footer ===== -->
  <footer class="text-center py-8 text-gray-400 text-sm">
    <p>MRT Rank — 台北捷運智慧推薦系統</p>
    <p class="mt-1">基於 PageRank 演算法的學術專題延伸作品</p>
  </footer>

  <!-- ===== Loading Overlay ===== -->
  <div id="loading-overlay" class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 hidden">
    <div class="bg-white rounded-2xl p-8 shadow-2xl text-center">
      <div class="spinner mx-auto mb-4"></div>
      <p class="text-gray-700 font-semibold">正在計算推薦分數...</p>
      <p class="text-gray-400 text-sm mt-1">基於 PageRank 演算法分析中</p>
    </div>
  </div>

  <!-- ===== 前端 JavaScript ===== -->
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

    // 路線顏色
    const LINE_COLORS = {
      BL: '#0070BD', R: '#E3002C', G: '#1A803F',
      O: '#F5A623', BR: '#C48C31', Y: '#FFDB00'
    };

    // ============================================================
    // 初始化
    // ============================================================
    document.addEventListener('DOMContentLoaded', async () => {
      await loadStations();
      setupEventListeners();
    });

    async function loadStations() {
      try {
        const res = await fetch('/api/stations');
        const data = await res.json();
        if (data.success) {
          allStations = data.stations;
        }
      } catch (e) {
        console.error('Failed to load stations:', e);
      }
    }

    // ============================================================
    // 事件監聽
    // ============================================================
    function setupEventListeners() {
      // 站點搜尋
      const searchInput = document.getElementById('station-search');
      searchInput.addEventListener('input', (e) => {
        const keyword = e.target.value.trim();
        if (keyword.length > 0) {
          showStationDropdown(keyword);
        } else {
          hideStationDropdown();
        }
      });

      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length > 0) {
          showStationDropdown(searchInput.value.trim());
        }
      });

      // 點擊外部關閉下拉
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#station-search') && !e.target.closest('#station-dropdown')) {
          hideStationDropdown();
        }
      });

      // 時段選擇
      document.querySelectorAll('#time-period-options .option-card').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#time-period-options .option-card').forEach(b => {
            b.classList.remove('selected', 'border-blue-400', 'bg-blue-50');
            b.classList.add('border-gray-200');
          });
          btn.classList.add('selected', 'border-blue-400', 'bg-blue-50');
          btn.classList.remove('border-gray-200');
          selectedTimePeriod = btn.dataset.value;
        });
      });

      // 偏好選擇
      document.querySelectorAll('#preference-options .option-card').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#preference-options .option-card').forEach(b => {
            b.classList.remove('selected', 'border-blue-400', 'bg-blue-50');
            b.classList.add('border-gray-200');
          });
          btn.classList.add('selected', 'border-blue-400', 'bg-blue-50');
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
          return \`
            <div class="px-4 py-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 transition-colors"
                 onclick="selectStation('\${s.id}')">
              <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: \${color}"></span>
              <span class="font-semibold">\${s.name_zh}</span>
              <span class="text-xs text-gray-400">\${s.id}</span>
              \${s.is_transfer_station ? '<span class="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">轉乘站</span>' : ''}
            </div>
          \`;
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

      // 顯示已選站點 badge
      const badge = document.getElementById('selected-station-badge');
      const color = LINE_COLORS[station.line] || '#999';
      badge.innerHTML = \`
        <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold text-white" 
              style="background-color: \${color}">
          <i class="fas fa-map-pin"></i>
          \${station.name_zh} (\${station.id})
          <button onclick="clearStation()" class="ml-1 hover:opacity-70">&times;</button>
        </span>
      \`;
      badge.classList.remove('hidden');
    }

    function clearStation() {
      selectedStation = null;
      document.getElementById('selected-station-id').value = '';
      document.getElementById('station-search').value = '';
      document.getElementById('selected-station-badge').classList.add('hidden');
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
          from: selectedStation.id,
          time_period: selectedTimePeriod,
          preference: selectedPreference,
          top_n: '5',
        });

        const res = await fetch(\`/api/recommend?\${params}\`);
        const data = await res.json();

        if (data.success) {
          renderResults(data);
        } else {
          alert(\`推薦失敗：\${data.error}\`);
        }
      } catch (e) {
        alert('網路錯誤，請稍後再試');
        console.error(e);
      } finally {
        btn.disabled = false;
        loading.classList.add('hidden');
      }
    }

    // ============================================================
    // 結果渲染
    // ============================================================
    function renderResults(data) {
      const section = document.getElementById('results-section');
      section.classList.remove('hidden');
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // 查詢摘要
      const q = data.query;
      document.getElementById('query-summary').innerHTML = \`
        <div class="bg-white rounded-xl p-4 shadow-sm flex flex-wrap items-center gap-3 text-sm">
          <span class="font-semibold text-gray-700">查詢條件：</span>
          <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full">
            <i class="fas fa-map-marker-alt mr-1"></i>\${q.from_station.name}
          </span>
          <span class="bg-green-100 text-green-700 px-3 py-1 rounded-full">
            <i class="fas fa-clock mr-1"></i>\${q.time_period_label}
          </span>
          <span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-full">
            <i class="fas fa-heart mr-1"></i>\${q.preference_label}
          </span>
          <span class="text-gray-400 ml-auto">
            共評估 \${data.metadata.total_stations_evaluated} 站
          </span>
        </div>
      \`;

      // 推薦列表
      const recs = data.recommendations;
      if (recs.length === 0) {
        document.getElementById('recommendations-list').innerHTML = \`
          <div class="text-center py-12 text-gray-400">
            <i class="fas fa-search text-4xl mb-4"></i>
            <p>目前沒有足夠的資料產生推薦</p>
          </div>
        \`;
        return;
      }

      const maxScore = recs[0].total_score;
      
      document.getElementById('recommendations-list').innerHTML = recs.map((rec, i) => {
        const color = LINE_COLORS[rec.station.line] || '#999';
        const scorePercent = maxScore > 0 ? (rec.total_score / maxScore * 100) : 0;
        const bd = rec.score_breakdown;

        return \`
          <div class="rec-card bg-white rounded-xl p-5 shadow-sm mb-4 fade-in-up fade-in-up-delay-\${i+1}"
               style="border-left-color: \${color}">
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-3">
                <span class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md"
                      style="background-color: \${color}">
                  \${rec.rank}
                </span>
                <div>
                  <h4 class="font-bold text-lg text-gray-800">\${rec.station.name_zh}</h4>
                  <div class="flex items-center gap-2 text-xs text-gray-500">
                    <span>\${rec.station.id}</span>
                    <span>•</span>
                    <span>\${rec.station.district || ''}</span>
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-2xl font-bold text-gray-800">\${rec.total_score.toFixed(2)}</div>
                <div class="text-xs text-gray-400">推薦分數</div>
              </div>
            </div>

            <!-- 分數條 -->
            <div class="mb-3">
              <div class="w-full bg-gray-100 rounded-full h-2">
                <div class="score-bar bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                     style="width: \${scorePercent}%"></div>
              </div>
            </div>

            <!-- 標籤 -->
            <div class="flex flex-wrap gap-1.5 mb-3">
              \${rec.tags.map(tag => \`
                <span class="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">\${tag}</span>
              \`).join('')}
            </div>

            <!-- 推薦理由 -->
            <div class="space-y-1 mb-3">
              \${rec.reasons.map(r => \`
                <p class="text-sm text-gray-600">\${r}</p>
              \`).join('')}
            </div>

            <!-- 分數拆解（可展開） -->
            <details class="mt-2">
              <summary class="text-xs text-blue-500 cursor-pointer hover:text-blue-700 select-none">
                <i class="fas fa-chart-pie mr-1"></i>查看分數拆解
              </summary>
              <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div class="bg-blue-50 rounded-lg p-2.5 text-center">
                  <div class="text-blue-600 font-bold text-lg">\${(bd.popularity.weighted * 100).toFixed(1)}%</div>
                  <div class="text-blue-500 mt-0.5">🔥 熱門度</div>
                  <div class="text-gray-400">原始: \${bd.popularity.raw}</div>
                </div>
                <div class="bg-green-50 rounded-lg p-2.5 text-center">
                  <div class="text-green-600 font-bold text-lg">\${(bd.connectivity.weighted * 100).toFixed(1)}%</div>
                  <div class="text-green-500 mt-0.5">🔗 連結性</div>
                  <div class="text-gray-400">原始: \${bd.connectivity.raw}</div>
                </div>
                <div class="bg-purple-50 rounded-lg p-2.5 text-center">
                  <div class="text-purple-600 font-bold text-lg">\${(bd.preference_match.weighted * 100).toFixed(1)}%</div>
                  <div class="text-purple-500 mt-0.5">💜 偏好</div>
                  <div class="text-gray-400">匹配: \${(bd.preference_match.raw * 100).toFixed(0)}%</div>
                </div>
                <div class="bg-red-50 rounded-lg p-2.5 text-center">
                  <div class="text-red-600 font-bold text-lg">-\${(bd.travel_cost.weighted * 100).toFixed(1)}%</div>
                  <div class="text-red-500 mt-0.5">🚇 成本</div>
                  <div class="text-gray-400">距離: \${bd.travel_cost.raw}</div>
                </div>
              </div>
            </details>
          </div>
        \`;
      }).join('');

      // 繪製圖表
      renderCharts(recs);
      
      // 顯示演算法 metadata
      renderMetadata(data.metadata);
    }

    // ============================================================
    // 圖表繪製
    // ============================================================
    function renderCharts(recs) {
      const chartSection = document.getElementById('chart-section');
      chartSection.classList.remove('hidden');

      // 銷毀舊圖表
      if (scoreChart) scoreChart.destroy();
      if (breakdownChart) breakdownChart.destroy();

      const labels = recs.map(r => r.station.name_zh);
      const colors = recs.map(r => LINE_COLORS[r.station.line] || '#999');

      // 圖表1: 總分比較
      scoreChart = new Chart(document.getElementById('score-chart'), {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: '推薦分數',
            data: recs.map(r => r.total_score),
            backgroundColor: colors.map(c => c + '80'),
            borderColor: colors,
            borderWidth: 2,
            borderRadius: 8,
          }]
        },
        options: {
          responsive: true,
          plugins: {
            title: { display: true, text: 'Top 5 推薦分數', font: { size: 14 } },
            legend: { display: false },
          },
          scales: {
            y: { beginAtZero: true, max: 1 },
          }
        }
      });

      // 圖表2: 分數拆解堆疊圖
      breakdownChart = new Chart(document.getElementById('breakdown-chart'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: '熱門度',
              data: recs.map(r => r.score_breakdown.popularity.weighted),
              backgroundColor: '#3B82F680',
              borderColor: '#3B82F6',
              borderWidth: 1,
            },
            {
              label: '連結性',
              data: recs.map(r => r.score_breakdown.connectivity.weighted),
              backgroundColor: '#10B98180',
              borderColor: '#10B981',
              borderWidth: 1,
            },
            {
              label: '偏好匹配',
              data: recs.map(r => r.score_breakdown.preference_match.weighted),
              backgroundColor: '#8B5CF680',
              borderColor: '#8B5CF6',
              borderWidth: 1,
            },
            {
              label: '旅行成本 (扣)',
              data: recs.map(r => -r.score_breakdown.travel_cost.weighted),
              backgroundColor: '#EF444480',
              borderColor: '#EF4444',
              borderWidth: 1,
            },
          ]
        },
        options: {
          responsive: true,
          plugins: {
            title: { display: true, text: '分數維度拆解', font: { size: 14 } },
          },
          scales: {
            x: { stacked: true },
            y: { stacked: true },
          }
        }
      });
    }

    function renderMetadata(meta) {
      document.getElementById('metadata-section').innerHTML = \`
        <div class="bg-gray-50 rounded-xl p-4 text-xs text-gray-500">
          <div class="flex flex-wrap gap-4">
            <span><strong>演算法：</strong>\${meta.algorithm}</span>
            <span><strong>Damping Factor (γ)：</strong>\${meta.gamma}</span>
            <span><strong>權重：</strong>w₁=\${meta.weights.w1} w₂=\${meta.weights.w2} w₃=\${meta.weights.w3} w₄=\${meta.weights.w4}</span>
          </div>
        </div>
      \`;
    }
  </script>

</body>
</html>`;
}

export default app;
