/**
 * MetroPulse — 台北捷運智慧推薦系統
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
import analyticsRoute from './routes/analytics';

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// 中介層
// ============================================================
app.use('/api/*', cors());

/** 子路由 /api/stations 等需要 D1；排除 GET /api 說明端點 */
app.use(async (c, next) => {
  const p = c.req.path;
  if (!p.startsWith('/api/')) return next();
  /** 僅靜態選項、不依賴 D1 */
  if (p === '/api/pagerank/periods') return next();
  if (c.env.mrt_rank_db) return next();
  return c.json(
    {
      success: false,
      error:
        'D1 綁定缺失：執行環境中沒有 mrt_rank_db（c.env.mrt_rank_db 為空）。',
      hint: '請至 Cloudflare Dashboard → Workers & Pages → 你的專案 → Settings → Functions → D1 database bindings，綁定資料庫 mrt-rank-db，且「變數名稱」必須與程式一致：mrt_rank_db。',
    },
    503
  );
});

// ============================================================
// API 路由掛載
// ============================================================
app.route('/api/stations', stationsRoute);
app.route('/api/pagerank', pagerankRoute);
app.route('/api/recommend', recommendRoute);
app.route('/api/station-detail', stationDetailRoute);
app.route('/api/analytics', analyticsRoute);

// API 根路徑
app.get('/api', (c) => {
  return c.json({
    name: 'MetroPulse API',
    version: '2.0.0',
    description: '台北捷運智慧推薦系統 — 基於 PageRank 演算法（含真實旅運量資料）',
    endpoints: {
      'GET /api/recommend': '核心推薦 API（?data_mode=auto|real|synthetic）',
      'GET /api/recommend/options': '表單選項',
      'GET /api/stations': '站點列表',
      'GET /api/stations/:id': '站點詳情',
      'GET /api/station-detail/:id': '站點完整詳情（含 PageRank 時序、偏好雷達、連結）',
      'GET /api/pagerank': 'PageRank 排名',
      'GET /api/pagerank/:stationId': '站點各時段 PageRank',
      'GET /api/analytics/months': '已匯入月份列表',
      'GET /api/analytics/latest': '最新月份摘要',
      'GET /api/analytics/pagerank': '真實 PageRank 排名（?year=&month=&period=&top_n=）',
      'GET /api/analytics/flow': '起站 OD 流量（?from=&year=&month=&period=）',
      'GET /api/analytics/trends': '站點 PR 趨勢（?station=&period=）',
    },
    example: '/api/recommend?from=BL12&time_period=afternoon&preference=food&top_n=5',
  });
});

// ============================================================
// 前端頁面路由
// ============================================================
app.get('/', (c) => c.html(renderHomePage()));
app.get('/station/:id', (c) => c.html(renderStationDetailPage(c.req.param('id'))));
app.get('/analytics', (c) => c.html(renderAnalyticsPage()));

// ============================================================
// 共用 HTML 元件
// ============================================================

function mpFontLinks(): string {
  return `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap" rel="stylesheet">
  <link href="/static/styles.css" rel="stylesheet">
`;
}

function tailwindRuntimeConfig(): string {
  return `<script>
    tailwind.config = {
      theme: { extend: { colors: {
        'mrt-blue': '#0070BD', 'mrt-red': '#E3002C',
        'mrt-green': '#1A803F', 'mrt-orange': '#F5A623', 'mrt-brown': '#C48C31',
      }}}
    }
  </script>`;
}

/** 共用 <head>：設計標記見 /public/static/styles.css */
function htmlHead(title: string, extra = '', extraHead = ''): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${mpFontLinks()}
  <script src="https://cdn.tailwindcss.com"></script>
  ${tailwindRuntimeConfig()}
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  ${extraHead}
  ${extra ? `<style>\n${extra}\n</style>` : ''}
</head>`;
}

/** 共用線性圖示：單一 inline symbol sprite，不增加 runtime dependency。 */
function iconSprite(): string {
  return `<svg class="mp-icon-sprite" width="0" height="0" aria-hidden="true" focusable="false">
    <symbol id="mp-icon-map-pin" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></symbol>
    <symbol id="mp-icon-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
    <symbol id="mp-icon-map" viewBox="0 0 24 24"><path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3zM8 3v15M16 6v15"/></symbol>
    <symbol id="mp-icon-compass" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9z"/></symbol>
    <symbol id="mp-icon-landmark" viewBox="0 0 24 24"><path d="m3 9 9-6 9 6M5 10h14M6 10v7m4-7v7m4-7v7m4-7v7M4 21h16M3 17h18"/></symbol>
    <symbol id="mp-icon-utensils" viewBox="0 0 24 24"><path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M16 3v18M16 3c3 2 4 5 4 8h-4"/></symbol>
    <symbol id="mp-icon-shopping-bag" viewBox="0 0 24 24"><path d="M5 8h14l-1 13H6zM9 9V6a3 3 0 0 1 6 0v3"/></symbol>
    <symbol id="mp-icon-moon" viewBox="0 0 24 24"><path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z"/></symbol>
    <symbol id="mp-icon-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></symbol>
    <symbol id="mp-icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="mp-icon-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
    <symbol id="mp-icon-rotate-ccw" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></symbol>
    <symbol id="mp-icon-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
    <symbol id="mp-icon-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></symbol>
    <symbol id="mp-icon-chevron-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
    <symbol id="mp-icon-search-x" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8.5 8.5l5 5m0-5-5 5"/></symbol>
    <symbol id="mp-icon-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-4L3 10M3 4v6h6M4 13a8 8 0 0 0 14.9 4L21 14m0 6v-6h-6"/></symbol>
    <symbol id="mp-icon-alert" viewBox="0 0 24 24"><path d="M10.3 4.1 2.7 17.2A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.8L13.7 4.1a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/></symbol>
    <symbol id="mp-icon-ranking" viewBox="0 0 24 24"><path d="M10 6h11M10 12h11M10 18h11M4 4h1v4M4 8h2M6 18H4c0-1 2-2 2-3s-.7-1.5-2-1.5"/></symbol>
    <symbol id="mp-icon-chart" viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></symbol>
    <symbol id="mp-icon-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></symbol>
  </svg>`;
}

function iconUse(name: string, size = 18, className = ''): string {
  const classes = ['mp-icon', className].filter(Boolean).join(' ');
  return `<svg class="${classes}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#mp-icon-${name}"></use></svg>`;
}

function htmlNav(active: 'home' | 'analytics' | 'detail' = 'home', variant: 'light' | 'dark' = 'light'): string {
  return `${iconSprite()}
  <nav class="mp-header" aria-label="主要導覽" data-tone="${variant}">
    <div class="mp-header-inner">
      <a href="/" class="mp-wordmark"><span class="mp-wordmark-name">Metro<span>Pulse</span></span><span class="mp-wordmark-sub">台北捷運智慧推薦</span></a>
      <div class="mp-nav-links">
        <a href="/" ${active === 'home' ? 'aria-current="page"' : ''}>開始推薦</a>
        <a href="/analytics" ${active === 'analytics' ? 'aria-current="page"' : ''}>旅運量分析</a>
        <a href="${active === 'home' ? '#about' : '/#about'}">推薦方法</a>
      </div>
    </div>
  </nav>`;
}

function htmlFooter(isHome = false): string {
  return `<footer class="mp-footer"><div class="mp-container">
    <p>MetroPulse — 台北捷運智慧推薦</p>
    <p>基於 PageRank 與旅運資料的可解釋推薦；學術專題延伸作品。</p>
    <a href="${isHome ? '#about' : '/#about'}">推薦方法</a><a href="/api">API 說明</a>
  </div></footer>`;
}

// ============================================================
// 首頁（查詢 + 路線圖 + 推薦結果）
// ============================================================
function renderHomePage(): string {
  return `${htmlHead(
    'MetroPulse — 台北捷運智慧推薦',
    '',
    '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css" crossorigin="anonymous">'
  )}
<body class="mp-home mp-font mp-page antialiased">
  <a class="mp-query-skip" href="#station-search">跳至推薦查詢</a>
  ${htmlNav('home', 'light')}
  <main id="main-content">

  <!-- 查詢優先：所有裝置共用同一份表單與 state -->
  <section class="mp-query-intro">
    <h1 class="mp-h1">搭捷運，下一站去哪？</h1>
    <p>選擇出發站、時段與偏好，找出值得探索的站點。</p>
  </section>

  <section class="mp-query-layout" aria-label="設定推薦條件">
    <form id="query-panel" class="mp-query-panel" novalidate aria-labelledby="query-title">
      <h2 id="query-title" class="mp-query-title">設定你的下一站</h2>
      <div class="mp-query-field" id="origin-field">
        <label for="station-search" class="mp-inline-icon-label">${iconUse('map-pin')}<span>出發站</span></label>
        <div class="mp-query-search-row">
          <div class="mp-query-combobox">
            <input type="text" id="station-search" class="mp-query-control" placeholder="搜尋站名或代碼"
              autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list"
              aria-expanded="false" aria-controls="station-dropdown" aria-required="true"
              aria-describedby="origin-hint origin-error">
            <input type="hidden" id="selected-station-id" value="">
            <div id="station-dropdown" role="listbox" aria-label="站點建議" class="mp-query-suggestions" hidden></div>
          </div>
          <button type="button" id="clear-station" class="mp-query-secondary" aria-label="清除出發站" disabled>清除</button>
        </div>
        <p id="origin-hint" class="mp-query-help">輸入中文、英文或站碼，再從清單選取。</p>
        <p id="origin-error" class="mp-query-error" role="alert" hidden></p>
        <div id="selected-station-badge" class="mp-query-origin" hidden></div>
        <p id="station-search-status" class="mp-query-help" role="status" aria-live="polite" aria-atomic="true"></p>
        <p id="stations-data-status" class="mp-query-help" role="status" aria-live="polite">正在載入站點清單…</p>
        <button type="button" id="retry-stations" class="mp-query-secondary" hidden>${iconUse('refresh')}<span>重新載入站點</span></button>
      </div>

      <div class="mp-query-field">
        <label for="time-period-options" class="mp-inline-icon-label">${iconUse('clock')}<span>時段</span></label>
        <select id="time-period-options" class="mp-query-control" name="time_period">
          <option value="morning_peak">晨峰 07:00–09:00</option>
          <option value="morning">上午 09:00–12:00</option>
          <option value="noon">午間 12:00–14:00</option>
          <option value="afternoon" selected>下午 14:00–17:00</option>
          <option value="evening_peak">晚峰 17:00–19:00</option>
          <option value="night">夜間 19:00–23:00</option>
        </select>
      </div>

      <fieldset class="mp-query-field">
        <legend><span class="mp-inline-icon-label">${iconUse('compass')}<span>偏好</span></span></legend>
        <div id="preference-options" class="mp-query-preferences">
          <label class="mp-query-chip"><input type="radio" name="preference" value="all" checked><span class="mp-query-chip-content">${iconUse('compass', 16)}<span>不限</span></span></label>
          <label class="mp-query-chip"><input type="radio" name="preference" value="attraction"><span class="mp-query-chip-content">${iconUse('landmark', 16)}<span>景點</span></span></label>
          <label class="mp-query-chip"><input type="radio" name="preference" value="food"><span class="mp-query-chip-content">${iconUse('utensils', 16)}<span>美食</span></span></label>
          <label class="mp-query-chip"><input type="radio" name="preference" value="shopping"><span class="mp-query-chip-content">${iconUse('shopping-bag', 16)}<span>購物</span></span></label>
          <label class="mp-query-chip"><input type="radio" name="preference" value="nightlife"><span class="mp-query-chip-content">${iconUse('moon', 16)}<span>夜生活</span></span></label>
          <label class="mp-query-chip"><input type="radio" name="preference" value="family"><span class="mp-query-chip-content">${iconUse('users', 16)}<span>親子</span></span></label>
        </div>
      </fieldset>

      <p id="query-changed" class="mp-query-notice" role="status" hidden>條件已變更，請重新查詢</p>
      <button type="submit" id="recommend-btn" class="mp-query-primary" aria-busy="false">查看推薦</button>
      <p id="query-status" class="mp-query-help" role="status" aria-live="polite" aria-atomic="true"></p>
      <div id="query-error" class="mp-query-error-box" hidden>
        <p class="mp-state-line">${iconUse('alert')}<span id="query-error-message" role="alert"></span></p>
        <button type="button" id="retry-recommend" class="mp-query-secondary">${iconUse('refresh')}<span>重試推薦</span></button>
      </div>
    </form>

    <aside class="mp-query-map-panel" aria-label="從路線圖選站">
      <button type="button" id="map-toggle" class="mp-query-secondary mp-query-map-toggle" aria-expanded="false" aria-controls="map-area">從路線圖選站</button>
      <div id="map-area" class="mp-query-map-area" hidden>
        <div class="mp-map-mode-header">
          <h2 id="map-heading" class="mp-query-title mp-heading-with-icon" tabindex="-1">${iconUse('map')}<span>從路線圖選站</span></h2>
          <button type="button" id="close-map" class="mp-query-secondary mp-query-map-close" aria-label="關閉路線圖並返回查詢">返回查詢</button>
        </div>
        <p class="mp-query-help mp-map-instructions">放大後可拖曳查看路網。手機選站後需明確確認；也可返回表單搜尋站名。</p>
        <div class="mp-map-toolbar" role="group" aria-label="路線圖檢視控制">
          <button type="button" id="map-zoom-in" class="mp-query-secondary" aria-label="放大路線圖">${iconUse('plus', 16)}<span>放大</span></button>
          <button type="button" id="map-zoom-out" class="mp-query-secondary" aria-label="縮小路線圖">${iconUse('minus', 16)}<span>縮小</span></button>
          <button type="button" id="map-reset" class="mp-query-secondary" aria-label="重設並顯示完整路網">${iconUse('rotate-ccw', 16)}<span>重設全圖</span></button>
        </div>
        <p id="map-view-status" class="mp-query-help" role="status" aria-live="polite">目前顯示完整路網。</p>
        <div class="mp-map-legend" aria-label="捷運路線圖例">
          <span><b class="mp-route-badge" data-route="BL">BL</b>板南線</span><span><b class="mp-route-badge" data-route="R">R</b>淡水信義線</span><span><b class="mp-route-badge" data-route="G">G</b>松山新店線</span><span><b class="mp-route-badge" data-route="O">O</b>中和新蘆線</span><span><b class="mp-route-badge" data-route="BR">BR</b>文湖線</span><span><b class="mp-route-badge" data-route="Y">Y</b>環狀線</span>
        </div>
        <div id="mrt-map-container" class="mp-query-map-canvas"></div>
        <p class="mp-query-help">路線示意，非實際地理比例。深色「出發」為已確認起站，數字為推薦名次；「預選」尚未改變查詢。密集站點需放大，或使用站名搜尋。</p>
        <div id="map-selection" class="mp-map-selection" aria-live="polite">
          <p id="map-selection-preview">尚未預選站點。</p>
          <div>
            <button type="button" id="confirm-map-station" class="mp-query-primary" disabled>使用此站</button>
            <button type="button" id="cancel-map-draft" class="mp-query-secondary" disabled>取消預選</button>
          </div>
        </div>
        <button type="button" id="map-search-alternative" class="mp-query-secondary mp-map-search-alternative">改用站名搜尋</button>
      </div>
    </aside>
  </section>

  <section id="results-section" class="mp-results mp-container hidden" tabindex="-1" aria-labelledby="results-heading">
    <div class="mp-results-heading-row">
      <h2 id="results-heading" class="mp-query-results-heading" tabindex="-1">本次推薦結果</h2>
      <button type="button" id="edit-query" class="mp-query-secondary">修改查詢條件</button>
    </div>
    <p id="results-stale-note" class="mp-query-notice" hidden>條件已變更，請重新查詢；以下保留上次查詢結果。</p>
    <div id="query-summary"></div>
    <div id="metadata-section"></div>
    <ol id="recommendations-list" class="mp-recommendations" aria-label="推薦站點排名"></ol>
    <details id="chart-section" class="mp-comparison hidden">
      <summary>${iconUse('chart')}<span>比較本次推薦分數</span></summary>
      <p>使用固定 0–1 尺度，僅比較本次候選的排序分數；不是個人喜愛機率，也不宜跨查詢比較。</p>
      <div class="mp-chart-frame"><canvas id="score-chart" role="img" aria-label="本次推薦排序分數；等價數值見上方推薦清單"></canvas></div>
    </details>
  </section>

  <section id="about" class="mp-method mp-container" aria-labelledby="method-heading">
    <h2 id="method-heading">推薦方法</h2>
    <p class="mp-method-lead">先理解「為什麼是這一站」，再看分數怎麼來。MetroPulse 結合捷運人流網路、站點標籤與交通成本，提供可追溯的推薦排序。</p>
    <div class="mp-method-section">
      <h3>推薦分數怎麼來？</h3>
      <div class="mp-method-body">
        <p>熱門度、與出發站的連結性、偏好匹配加分；旅行成本扣分。分數只用來排列本次候選，0.79 不代表 79% 適合你。</p>
        <div class="mp-formula" id="formula-score" aria-label="推薦分數等於正規化熱門度、人流連結及偏好的加權和，減去正規化旅行成本">
          <span>Score(i → j, t, pref) =</span>
          <span>w₁ × norm(PRⱼ(t))</span>
          <span>+ w₂ × norm(transitionᵢⱼ(t))</span>
          <span>+ w₃ × PreferenceMatch(j, pref)</span>
          <span>− w₄ × norm(TravelCost(i, j))</span>
        </div>
        <p class="mp-method-note">預設權重依序為 0.30、0.25、0.30、0.15。每項加權分量先取四位小數；加減後若為負值則截為 0，再取兩位小數作為排序分數。同分沿用引擎的既有排序。</p>
        <dl class="mp-definitions">
          <div><dt>熱門度 PR</dt><dd>站點在指定時段的人流網路重要性，不是即時擁擠程度。</dd></div>
          <div><dt>連結值 transition</dt><dd>出發站與候選站之間的人流連結。正規化值描述本次候選中的相對連結性，不是旅客前往機率。</dd></div>
          <div><dt>PreferenceMatch</dt><dd>使用既有站點標籤評分；選「不限」時取標籤平均。它本來就在 0–1 之間，不再做候選間 Min-Max 正規化。</dd></div>
          <div><dt>TravelCost</dt><dd>使用既有交通成本評分；高成本會扣分。成本評分本身無法還原可靠的站數、轉乘或時間。</dd></div>
        </dl>
        <details class="mp-method-details">
          <summary>正規化與資料不足如何處理？</summary>
          <div class="mp-formula" id="formula-norm" aria-label="正規化值等於 x 減最小值，再除以最大值減最小值"><span>norm(x) = (x − x_min) ÷ (x_max − x_min)</span></div>
          <p>範圍取自排除出發站後的全部候選，不只是顯示的 Top 5。若所有值相同，norm 回傳 0.5；一般結果限制在 0–1。更換條件可能改變候選範圍，因此分數不適合跨次比較。</p>
          <p>目前引擎在 PR／連結缺漏時代入 0、交通成本缺漏時代入 0.5；指定偏好無標籤時代入 0.1，「不限」且完全無標籤時代入 0.3。API 未提供逐欄缺漏標記，因此回傳的 0 不一定代表已觀測到零流量。介面遇到未提供的數值會顯示「未知」，不再額外補 0。</p>
        </details>
      </div>
    </div>
    <div class="mp-method-section">
      <h3>PageRank 研究模型</h3>
      <div class="mp-method-body">
        <p>研究將捷運站視為節點、站間人流視為連結；透過含阻尼的轉移矩陣與 Power Method 計算 PageRank。</p>
        <div class="mp-formula" id="formula-pagerank" aria-label="模型轉移機率 p ij 等於 gamma 乘以 e ij 除以 s i，加上一減 gamma 乘以一除以 n">
          <span>pᵢⱼ = γ × (eᵢⱼ / sᵢ) + (1 − γ) × (1 / n)</span>
        </div>
        <dl class="mp-definitions mp-model-terms">
          <div><dt>eᵢⱼ</dt><dd>從站 i 到站 j 的旅客流量。</dd></div>
          <div><dt>sᵢ</dt><dd>站 i 的總出站流量。</dd></div>
          <div><dt>γ = 0.85</dt><dd>研究模型的阻尼係數。</dd></div>
          <div><dt>n</dt><dd>模型中的站點數。</dd></div>
        </dl>
      </div>
    </div>
    <div class="mp-method-section">
      <h3>目前推薦資料來源</h3>
      <div class="mp-method-body">
        <p>每次查詢的資料模式與月份顯示在結果摘要。使用真實資料模式時，推薦服務取已匯入月份的 PageRank；人流連結值由該起站、月份與時段的 OD 流量占比取得，並不是在每次查詢時重新套用上方含 γ 的研究公式。</p>
        <p>只有找到對應資料的候選欄位才會被真實 PR／OD 值覆蓋，其餘可能保留既有資料。偏好與交通資訊包含標籤或估計，現有 API 也無逐站、逐欄的來源證明；「使用真實資料」不代表所有欄位都是真實觀測。</p>
        <p>這是歷史資料的探索工具，不提供即時人潮、營運狀態或已核實的旅程時間。完整地圖與交通資料核對將在後續版本處理。</p>
        <a class="mp-text-link" href="/api">查看 API 說明</a>
      </div>
    </div>
  </section>

  </main>
  ${htmlFooter(true)}

  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js" crossorigin="anonymous"></script>
  <script src="/static/method-math.js"></script>
  <!-- SVG Map Module -->
  <script src="/static/mrt-map.js"></script>

  <script>
    // ============================================================
    // 全域狀態
    // ============================================================
    // Draft controls, committed station and submitted results have separate ownership.
    let allStations = [];
    let usingStationsFallback = false;
    let stationsLoading = false;
    let scoreChart = null;
    let breakdownChart = null;
    const queryState = {
      draftInput: '', committedOrigin: null,
      draftQuery: { timePeriod: 'afternoon', preference: 'all' },
      submittedQuery: null, currentRequest: null, requestSequence: 0, phase: 'idle'
    };
    let suggestions = [];
    let activeSuggestion = -1;
    let composing = false;
    let compositionJustEnded = false;
    let mapOpen = false;
    let mapReady = false;
    let mapDraftOrigin = null;
    let mapReturnFocus = null;
    let mapBodyScrollY = 0;
    let mapBodyLocked = false;
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const byId = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', async () => {
      setupEventListeners();
      updateMapVisibility();
      desktopQuery.addEventListener('change', handleMapBreakpointChange);
      const nav = document.querySelector('nav');
      const updateOffset = () => document.body.style.setProperty('--mp-query-scroll-offset', (nav ? nav.getBoundingClientRect().height + 20 : 20) + 'px');
      updateOffset();
      if (nav && typeof ResizeObserver !== 'undefined') new ResizeObserver(updateOffset).observe(nav);
      applyQueryFromUrl();
      await loadStations();
      // Do not overwrite a station the user started entering while the list loaded.
      const fromId = new URLSearchParams(window.location.search).get('from');
      const restoreResults = new URLSearchParams(window.location.search).get('restore') === 'recommendations';
      if (fromId && !queryState.draftInput && !queryState.committedOrigin) {
        const selected = selectStation(fromId);
        if (selected && restoreResults) submitRecommendation();
      }
    });

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async function fetchStationList(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Station list unavailable');
        return await response.json();
      } finally { clearTimeout(timeout); }
    }

    async function loadStations() {
      if (stationsLoading) return;
      stationsLoading = true;
      byId('retry-stations').disabled = true;
      byId('stations-data-status').textContent = '正在載入站點清單…';
      let nextStations = [];
      usingStationsFallback = false;
      try {
        const data = await fetchStationList('/api/stations');
        if (data.success && Array.isArray(data.stations)) nextStations = data.stations;
      } catch (_) { /* Keep the existing built-in station-list fallback. */ }
      if (!nextStations.length) {
        try {
          const fallback = await fetchStationList('/static/stations-fallback.json');
          if (Array.isArray(fallback) && fallback.length) {
            nextStations = fallback;
            usingStationsFallback = true;
          }
        } catch (_) { /* Surface a recoverable inline state below. */ }
      }
      allStations = nextStations;
      stationsLoading = false;
      byId('retry-stations').disabled = false;
      byId('retry-stations').hidden = !!allStations.length && !usingStationsFallback;
      byId('stations-data-status').textContent = !allStations.length
        ? '站點清單暫時無法載入，請重新載入後選站。'
        : usingStationsFallback ? '目前使用內建站點清單；推薦服務是否可用，將於查詢時確認。' : '';
      if (typeof MRTMap !== 'undefined') {
        MRTMap.init('mrt-map-container', allStations, { externalLegend: true, onSelect: (id) => {
          const station = allStations.find(item => item.id === id);
          if (!station) {
            byId('stations-data-status').textContent = '這個站點目前無法選取，請使用站名搜尋。';
            queueMicrotask(syncMapSelection);
            return;
          }
          if (desktopQuery.matches) {
            selectStation(id);
            MRTMap.clearDraft();
            byId('map-view-status').textContent = '已將 ' + station.name_zh + ' ' + station.id + ' 設為出發站。';
          } else {
            mapDraftOrigin = station;
            MRTMap.setDraft(id);
            renderMapDraft();
          }
        } });
        mapReady = true;
        syncMapSelection();
        updateMapControls();
      } else {
        byId('mrt-map-container').textContent = '路線圖暫時無法載入，請使用站名搜尋。';
      }
      if (document.activeElement === byId('station-search')) showStationDropdown();
    }

    function applyQueryFromUrl() {
      // Preserve station-detail deep links as an explicit preselection.
      const params = new URLSearchParams(window.location.search);
      const time = Array.from(byId('time-period-options').options).find(o => o.value === params.get('time_period'));
      if (time) {
        byId('time-period-options').value = time.value;
        queryState.draftQuery.timePeriod = time.value;
      }
      const preference = Array.from(document.querySelectorAll('input[name="preference"]')).find(radio => radio.value === params.get('preference'));
      if (preference) {
        preference.checked = true;
        queryState.draftQuery.preference = preference.value;
      }
    }

    function setupEventListeners() {
      const input = byId('station-search');
      byId('query-panel').addEventListener('submit', event => {
        event.preventDefault();
        if (!composing && !compositionJustEnded) submitRecommendation();
      });
      input.addEventListener('compositionstart', () => { composing = true; closeSuggestions(); });
      input.addEventListener('compositionend', () => {
        composing = false;
        compositionJustEnded = true;
        setTimeout(() => { compositionJustEnded = false; }, 0);
        handleOriginInput();
      });
      input.addEventListener('input', handleOriginInput);
      input.addEventListener('focus', () => { if (!composing && !queryState.committedOrigin) showStationDropdown(); });
      input.addEventListener('keydown', event => {
        if (composing || compositionJustEnded || event.isComposing || event.keyCode === 229) {
          if (event.key === 'Enter') event.preventDefault();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (byId('station-dropdown').hidden) showStationDropdown();
          if (!suggestions.length) return;
          activeSuggestion = event.key === 'ArrowDown'
            ? (activeSuggestion + 1) % suggestions.length
            : (activeSuggestion <= 0 ? suggestions.length - 1 : activeSuggestion - 1);
          updateActiveSuggestion();
        } else if (event.key === 'Enter' && !byId('station-dropdown').hidden) {
          event.preventDefault();
          if (activeSuggestion >= 0) selectStation(suggestions[activeSuggestion].id);
          else if (!queryState.committedOrigin) showOriginError('請從站點建議選取出發站。');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeSuggestions();
        } else if (event.key === 'Tab') closeSuggestions();
      });
      input.addEventListener('blur', () => { setTimeout(() => {
        if (document.activeElement !== input) closeSuggestions();
      }, 0); });
      byId('station-dropdown').addEventListener('mousedown', event => event.preventDefault());
      byId('station-dropdown').addEventListener('click', event => {
        const option = event.target.closest('[role="option"]');
        if (option) selectStation(option.dataset.stationId);
      });
      document.addEventListener('click', event => {
        if (!byId('origin-field').contains(event.target)) closeSuggestions();
      });
      byId('clear-station').addEventListener('click', clearStation);
      byId('time-period-options').addEventListener('change', event => {
        queryState.draftQuery.timePeriod = event.target.value;
        queryChanged();
      });
      byId('preference-options').addEventListener('change', event => {
        if (event.target.matches('input[name="preference"]')) {
          queryState.draftQuery.preference = event.target.value;
          queryChanged();
        }
      });
      byId('retry-stations').addEventListener('click', loadStations);
      byId('retry-recommend').addEventListener('click', submitRecommendation);
      byId('edit-query').addEventListener('click', () => focusAndReveal(input));
      byId('map-toggle').addEventListener('click', openMapMode);
      byId('close-map').addEventListener('click', () => closeMapMode());
      byId('map-search-alternative').addEventListener('click', () => {
        if (desktopQuery.matches) focusAndReveal(input);
        else closeMapMode({ focusTarget: input });
      });
      byId('confirm-map-station').addEventListener('click', confirmMapStation);
      byId('cancel-map-draft').addEventListener('click', cancelMapDraft);
      byId('map-zoom-in').addEventListener('click', () => changeMapView('in'));
      byId('map-zoom-out').addEventListener('click', () => changeMapView('out'));
      byId('map-reset').addEventListener('click', () => changeMapView('reset'));
      byId('mrt-map-container').addEventListener('mrtmapviewchange', updateMapControls);
      byId('map-area').addEventListener('keydown', handleMapModeKeydown);
    }

    function updateMapVisibility() {
      const visible = desktopQuery.matches || mapOpen;
      byId('map-area').hidden = !visible;
      byId('map-toggle').setAttribute('aria-expanded', String(visible));
      if (desktopQuery.matches) {
        byId('map-area').removeAttribute('role');
        byId('map-area').removeAttribute('aria-modal');
        byId('map-area').removeAttribute('aria-labelledby');
      } else if (mapOpen) {
        byId('map-area').setAttribute('role', 'dialog');
        byId('map-area').setAttribute('aria-modal', 'true');
        byId('map-area').setAttribute('aria-labelledby', 'map-heading');
      }
      renderMapDraft();
    }

    function handleMapBreakpointChange() {
      if (desktopQuery.matches && mapOpen) {
        mapOpen = false;
        mapDraftOrigin = null;
        if (mapReady) MRTMap.clearDraft();
        unlockMapBody();
      }
      updateMapVisibility();
      updateMapControls();
    }

    function openMapMode() {
      if (desktopQuery.matches) return;
      mapReturnFocus = document.activeElement;
      mapDraftOrigin = queryState.committedOrigin;
      mapOpen = true;
      if (mapReady) {
        MRTMap.closeStationChoice({ restoreFocus: false });
        MRTMap.setDraft(mapDraftOrigin ? mapDraftOrigin.id : null);
      }
      lockMapBody();
      updateMapVisibility();
      requestAnimationFrame(() => byId('map-heading').focus({ preventScroll: true }));
    }

    function closeMapMode({ focusTarget = null } = {}) {
      if (!desktopQuery.matches) {
        mapOpen = false;
        mapDraftOrigin = null;
        if (mapReady) {
          MRTMap.closeStationChoice({ restoreFocus: false });
          MRTMap.clearDraft();
          syncMapSelection();
        }
        updateMapVisibility();
        unlockMapBody();
        const target = focusTarget || mapReturnFocus || byId('map-toggle');
        mapReturnFocus = null;
        requestAnimationFrame(() => focusAndReveal(target));
      }
    }

    function confirmMapStation() {
      if (!mapDraftOrigin) return;
      const selected = mapDraftOrigin;
      if (!selectStation(selected.id)) return;
      byId('station-search-status').textContent = '已從路線圖選取 ' + selected.name_zh + '，站碼 ' + selected.id + '。';
      closeMapMode({ focusTarget: byId('station-search') });
    }

    function cancelMapDraft() {
      mapDraftOrigin = queryState.committedOrigin;
      if (mapReady) MRTMap.setDraft(mapDraftOrigin ? mapDraftOrigin.id : null);
      renderMapDraft();
      byId('map-view-status').textContent = queryState.committedOrigin
        ? '已取消預選；出發站仍是 ' + queryState.committedOrigin.name_zh + '。'
        : '已取消預選；尚未設定出發站。';
    }

    function renderMapDraft() {
      const selection = byId('map-selection');
      if (!selection) return;
      selection.hidden = desktopQuery.matches;
      const changed = !!mapDraftOrigin && (!queryState.committedOrigin || mapDraftOrigin.id !== queryState.committedOrigin.id);
      byId('map-selection-preview').textContent = mapDraftOrigin
        ? (changed ? '預選：' : '目前出發站：') + mapDraftOrigin.name_zh + ' · ' + mapDraftOrigin.id
        : '尚未預選站點。請在地圖點選，或改用站名搜尋。';
      byId('confirm-map-station').disabled = !mapDraftOrigin || !changed;
      byId('cancel-map-draft').disabled = !changed;
    }

    function changeMapView(action) {
      if (!mapReady) return;
      if (action === 'in') MRTMap.zoomIn();
      else if (action === 'out') MRTMap.zoomOut();
      else MRTMap.resetView();
      const state = MRTMap.getViewState();
      byId('map-view-status').textContent = action === 'reset' || state.isOverview
        ? '目前顯示完整路網。'
        : '地圖已縮放至 ' + Math.round(state.zoom * 100) + '%；可拖曳查看其他區域。';
      updateMapControls();
    }

    function updateMapControls() {
      if (!mapReady || typeof MRTMap === 'undefined') return;
      const state = MRTMap.getViewState();
      byId('map-zoom-in').disabled = state.zoom >= state.maxZoom - 0.01;
      byId('map-zoom-out').disabled = state.zoom <= state.minZoom + 0.01;
    }

    function handleMapModeKeydown(event) {
      if (desktopQuery.matches || !mapOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMapMode();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(byId('map-area').querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
        .filter(element => !element.hidden && element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const currentIndex = focusable.indexOf(document.activeElement);
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (currentIndex < 0 || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    function setMapBackgroundInert(inert) {
      document.querySelectorAll('.mp-header, .mp-footer, .mp-query-skip, .mp-query-intro, #query-panel, #results-section, #about, #map-toggle')
        .forEach(element => { element.inert = inert; });
    }

    function lockMapBody() {
      if (mapBodyLocked) return;
      mapBodyScrollY = window.scrollY;
      document.body.style.top = '-' + mapBodyScrollY + 'px';
      document.body.classList.add('mp-map-mode-open');
      setMapBackgroundInert(true);
      mapBodyLocked = true;
    }

    function unlockMapBody() {
      if (!mapBodyLocked) return;
      document.body.classList.remove('mp-map-mode-open');
      setMapBackgroundInert(false);
      document.body.style.removeProperty('top');
      window.scrollTo(0, mapBodyScrollY);
      mapBodyLocked = false;
    }

    function focusAndReveal(element) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    }

    function handleOriginInput() {
      queryState.draftInput = byId('station-search').value;
      // Any manual edit invalidates the previous commitment, even if text is later restored.
      queryState.committedOrigin = null;
      syncOriginControl();
      queryChanged();
      clearOriginError();
      if (!composing) showStationDropdown();
    }

    function showStationDropdown() {
      const filter = queryState.draftInput.trim().toLowerCase();
      suggestions = allStations.filter(station => !filter || station.name_zh.includes(filter)
        || (station.name_en || '').toLowerCase().includes(filter) || station.id.toLowerCase().includes(filter));
      activeSuggestion = -1;
      const list = byId('station-dropdown');
      list.replaceChildren();
      for (const [index, station] of suggestions.entries()) {
        const option = document.createElement('div');
        option.id = 'station-option-' + index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.dataset.stationId = station.id;
        option.textContent = station.name_zh + ' · ' + station.id + ' · ' + (station.name_en || '');
        list.append(option);
      }
      list.hidden = !suggestions.length;
      byId('station-search').setAttribute('aria-expanded', String(!list.hidden));
      byId('station-search').removeAttribute('aria-activedescendant');
      byId('station-search-status').textContent = suggestions.length
        ? '找到 ' + suggestions.length + ' 個站點，使用上下方向鍵選擇，Enter 確認。'
        : stationsLoading ? '正在載入站點…' : allStations.length ? '找不到符合的站點，請換個站名或代碼。' : '';
    }

    function updateActiveSuggestion() {
      const options = byId('station-dropdown').children;
      Array.from(options).forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestion)));
      const active = options[activeSuggestion];
      if (active) {
        byId('station-search').setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }

    function closeSuggestions() {
      byId('station-dropdown').hidden = true;
      byId('station-search').setAttribute('aria-expanded', 'false');
      byId('station-search').removeAttribute('aria-activedescendant');
      activeSuggestion = -1;
      byId('station-search-status').textContent = '';
    }

    function selectStation(id) {
      const station = allStations.find(item => item.id === id);
      if (!station) return false;
      queryState.committedOrigin = station;
      queryState.draftInput = station.name_zh;
      byId('station-search').value = queryState.draftInput;
      closeSuggestions();
      syncOriginControl();
      clearOriginError();
      queryChanged();
      byId('station-search-status').textContent = '已選取 ' + station.name_zh + '，站碼 ' + station.id + '。';
      return true;
    }

    function clearStation() {
      queryState.draftInput = '';
      queryState.committedOrigin = null;
      byId('station-search').value = '';
      syncOriginControl();
      clearOriginError();
      queryChanged();
      byId('station-search').focus({ preventScroll: true });
      closeSuggestions();
      byId('station-search-status').textContent = '已清除出發站。';
    }

    function syncOriginControl() {
      const station = queryState.committedOrigin;
      byId('selected-station-id').value = station ? station.id : '';
      byId('clear-station').disabled = !queryState.draftInput && !station;
      const badge = byId('selected-station-badge');
      badge.replaceChildren();
      badge.hidden = !station;
      if (station) {
        const label = document.createElement('span');
        label.textContent = '已選：' + station.name_zh + ' · ' + station.id;
        const link = document.createElement('a');
        link.href = '/station/' + encodeURIComponent(station.id);
        link.textContent = '站點詳情';
        badge.append(label, link);
      }
      syncMapSelection();
    }

    function syncMapSelection() {
      if (!mapReady) return;
      if (queryState.committedOrigin) MRTMap.setSelected(queryState.committedOrigin.id);
      else MRTMap.clearSelected();
    }

    function clearOriginError() {
      byId('origin-error').hidden = true;
      byId('origin-error').textContent = '';
      byId('station-search').removeAttribute('aria-invalid');
    }

    function showOriginError(message) {
      byId('origin-error').textContent = message;
      byId('origin-error').hidden = false;
      byId('station-search').setAttribute('aria-invalid', 'true');
      focusAndReveal(byId('station-search'));
    }

    function matchesDraft(snapshot) {
      return !!snapshot && !!queryState.committedOrigin
        && snapshot.from_station.id === queryState.committedOrigin.id
        && snapshot.time_period === queryState.draftQuery.timePeriod
        && snapshot.preference === queryState.draftQuery.preference;
    }

    function queryChanged() {
      const request = queryState.currentRequest;
      if (request && !matchesDraft(request.snapshot)) {
        queryState.currentRequest = null;
        clearTimeout(request.timeout);
        request.controller.abort();
        queryState.phase = 'idle';
        byId('query-status').textContent = '條件已變更，先前查詢已取消。';
      }
      const changed = !!queryState.submittedQuery && !matchesDraft(queryState.submittedQuery);
      byId('query-changed').hidden = !changed;
      byId('results-stale-note').hidden = !changed;
      byId('query-error').hidden = true;
      updateSubmitState();
    }

    function updateSubmitState() {
      const loading = !!queryState.currentRequest;
      byId('recommend-btn').setAttribute('aria-busy', String(loading));
      byId('recommend-btn').disabled = loading;
      byId('recommend-btn').textContent = loading ? '正在查詢…' : '查看推薦';
      byId('retry-recommend').disabled = loading;
    }

    function clearResults() {
      if (scoreChart) scoreChart.destroy();
      if (breakdownChart) breakdownChart.destroy();
      scoreChart = null;
      breakdownChart = null;
      ['recommendations-list', 'query-summary', 'metadata-section'].forEach(id => byId(id).replaceChildren());
      byId('chart-section').classList.add('hidden');
      byId('results-section').classList.add('hidden');
      byId('results-stale-note').hidden = true;
      if (mapReady) MRTMap.highlightStations([]);
    }

    async function submitRecommendation() {
      if (composing || compositionJustEnded) return;
      if (!queryState.committedOrigin) {
        showOriginError('請輸入站名，並從建議清單或路線圖選取出發站。');
        return;
      }
      if (queryState.currentRequest && matchesDraft(queryState.currentRequest.snapshot)) return;
      closeSuggestions();
      clearOriginError();
      const timeControl = byId('time-period-options');
      const checkedPreference = document.querySelector('input[name="preference"]:checked');
      const snapshot = Object.freeze({
        from_station: Object.freeze({ id: queryState.committedOrigin.id, name: queryState.committedOrigin.name_zh }),
        time_period: queryState.draftQuery.timePeriod,
        time_period_label: timeControl.selectedOptions[0].textContent,
        preference: queryState.draftQuery.preference,
        preference_label: checkedPreference.nextElementSibling.textContent,
        top_n: 5
      });
      const request = { id: ++queryState.requestSequence, snapshot, controller: new AbortController(), timeout: null, timedOut: false };
      queryState.currentRequest = request;
      queryState.submittedQuery = snapshot;
      queryState.phase = 'loading';
      clearResults();
      byId('query-error').hidden = true;
      byId('query-changed').hidden = true;
      byId('query-status').textContent = '正在查詢推薦站點…';
      updateSubmitState();
      request.timeout = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, 20000);
      const isCurrent = () => queryState.currentRequest === request && matchesDraft(snapshot);
      try {
        const params = new URLSearchParams({ from: snapshot.from_station.id, time_period: snapshot.time_period, preference: snapshot.preference, top_n: String(snapshot.top_n) });
        const response = await fetch('/api/recommend?' + params, { signal: request.controller.signal });
        const data = await response.json();
        if (!isCurrent()) return;
        if (!response.ok || !data.success || !Array.isArray(data.recommendations)) throw new Error('Recommendation unavailable');
        renderResults(data, snapshot);
        queryState.phase = data.recommendations.length ? 'success' : 'empty';
        if (mapReady) MRTMap.highlightStations(data.recommendations.map(rec => rec.station.id));
        byId('query-status').textContent = data.recommendations.length ? '已找到 ' + data.recommendations.length + ' 個推薦站點。' : '這次查詢沒有推薦結果。';
        focusAndReveal(byId('results-heading'));
      } catch (error) {
        if (!isCurrent()) return;
        clearResults();
        queryState.phase = 'error';
        byId('query-status').textContent = '';
        byId('query-error').hidden = false;
        byId('query-error-message').textContent = request.timedOut
          ? '查詢等候時間較長，條件已保留，請重試。'
          : '暫時無法取得推薦，條件已保留。請確認連線後重試。';
      } finally {
        clearTimeout(request.timeout);
        if (queryState.currentRequest === request) {
          queryState.currentRequest = null;
          updateSubmitState();
        }
      }
    }

    // ============================================================
    // 結果渲染
    // ============================================================
    // Presentation only: ranking and all numerical values remain owned by the API.
    function numberText(value, digits = 2) {
      return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '未知';
    }

    const ROUTE_NAMES = { BL: '板南線', R: '淡水信義線', G: '松山新店線', O: '中和新蘆線', BR: '文湖線', Y: '環狀線' };
    function routeBadges(station) {
      let transfers = [];
      try { transfers = Array.isArray(station.transfer_lines) ? station.transfer_lines : JSON.parse(station.transfer_lines || '[]'); } catch (_) { /* Unknown transfer data stays unknown. */ }
      const codes = [...new Set([station.line, ...(Array.isArray(transfers) ? transfers : [])])].filter(code => Object.hasOwn(ROUTE_NAMES, code));
      return codes.length ? codes.map(code => '<span class="mp-route-badge" data-route="' + code + '" aria-label="' + code + ' ' + ROUTE_NAMES[code] + '">' + code + '</span>').join('') : '<span class="mp-route-unknown">路線未知</span>';
    }

    function stationReason(rec, snapshot) {
      // Match only the exact legacy reason prefixes emitted by recommender.ts.
      // No broad Unicode/emoji removal, and no parsing unverified travel estimates.
      const icons = { attraction: '🏛️', food: '🍜', shopping: '🛍️', nightlife: '🌙', family: '👨‍👩‍👧‍👦' };
      const prefix = icons[snapshot.preference] + ' ' + snapshot.preference_label + '匹配度 ';
      const reason = (Array.isArray(rec.reasons) ? rec.reasons : []).find(reason => typeof reason === 'string' && reason.startsWith(prefix));
      if (reason && reason.includes('：')) return snapshot.preference_label + '：' + reason.slice(reason.indexOf('：') + 1);
      const tags = (Array.isArray(rec.tags) ? rec.tags : []).filter(tag => typeof tag === 'string');
      return tags.length ? '站點標籤：' + tags.join('、') + '。可從這些特色開始探索。' : '目前缺少具體站點特色說明，可展開評分依據了解排序。';
    }

    function scoreEvidence(rec) {
      const breakdown = rec.score_breakdown || {};
      const dimensions = [['popularity', '熱門度 PR'], ['connectivity', '人流連結'], ['preference_match', '偏好匹配'], ['travel_cost', '旅行成本']];
      return dimensions.map(([key, label]) => {
        const dim = breakdown[key] || {};
        const contribution = typeof dim.weighted === 'number' && Number.isFinite(dim.weighted)
          ? (dim.weighted === 0 ? '0.0000' : (key === 'travel_cost' ? '−' : '+') + numberText(dim.weighted, 4)) : '未知';
        return '<div class="mp-evidence-row"><h4>' + label + '</h4><dl>' +
          '<div><dt>原始值 raw</dt><dd>' + numberText(dim.raw, 4) + '</dd></div>' +
          '<div><dt>' + (key === 'preference_match' ? '標籤值（未再正規化）' : '正規化 normalized') + '</dt><dd>' + numberText(dim.normalized) + '</dd></div>' +
          '<div><dt>權重 weight</dt><dd>' + numberText(dim.weight) + '</dd></div>' +
          '<div><dt>加權分量 contribution</dt><dd>' + contribution + '</dd></div></dl></div>';
      }).join('');
    }

    function detailContextHref(stationId, snapshot) {
      const params = new URLSearchParams({
        context: 'recommendation',
        from: snapshot.from_station.id,
        time_period: snapshot.time_period,
        preference: snapshot.preference
      });
      return '/station/' + encodeURIComponent(stationId) + '?' + params.toString();
    }

    function renderResults(data, snapshot) {
      const recs = data.recommendations;
      byId('results-section').classList.remove('hidden');
      byId('results-heading').textContent = recs.length ? '本次推薦結果' : '目前沒有推薦結果';
      byId('query-summary').innerHTML = '<dl class="mp-query-summary"><div><dt>出發站</dt><dd>' + escapeHtml(snapshot.from_station.name) + ' <span>' + escapeHtml(snapshot.from_station.id) + '</span></dd></div><div><dt>時段</dt><dd>' + escapeHtml(snapshot.time_period_label) + '</dd></div><div><dt>偏好</dt><dd>' + escapeHtml(snapshot.preference_label) + '</dd></div></dl>';
      if (!recs.length) {
        byId('recommendations-list').innerHTML = '<li class="mp-query-empty">${iconUse('search-x')}<span>這組條件目前沒有推薦站點。請修改時段、偏好或出發站後再查詢。</span></li>';
        return;
      }
      renderMetadata(data.metadata || {});
      byId('recommendations-list').innerHTML = recs.map((rec, index) => {
        const station = rec.station || {};
        const connectivity = rec.score_breakdown?.connectivity?.normalized;
        const context = typeof connectivity === 'number' && Number.isFinite(connectivity) && connectivity >= 0.5
          ? '<p class="mp-rec-context">與出發站的人流連結在本次候選中較高。</p>' : '';
        return '<li class="mp-recommendation' + (index === 0 ? ' mp-recommendation-first' : '') + '" value="' + escapeHtml(rec.rank) + '">' +
          '<div class="mp-rec-rank" aria-label="排名 ' + escapeHtml(rec.rank) + '">' + escapeHtml(rec.rank) + '</div>' +
          '<article aria-labelledby="rec-name-' + index + '"><div class="mp-rec-station">' +
          '<div class="mp-route-badges">' + routeBadges(station) + '</div><h3 id="rec-name-' + index + '">' + escapeHtml(station.name_zh || '站名未知') + '</h3>' +
          '<p class="mp-rec-station-meta">' + escapeHtml(station.id || '站碼未知') + (station.district ? ' · ' + escapeHtml(station.district) : '') + '</p></div>' +
          '<p class="mp-rec-reason">' + escapeHtml(stationReason(rec, snapshot)) + '</p>' + context +
          '<p class="mp-rec-travel"><strong>交通負擔</strong>　資料不足；尚無可核實的站數、轉乘與時間資訊。</p>' +
          '<p class="mp-rec-score"><span>推薦排序分數</span> <strong>' + numberText(rec.total_score) + '</strong></p>' +
          '<a class="mp-text-link mp-rec-detail mp-icon-link" href="' + escapeHtml(detailContextHref(station.id, snapshot)) + '">查看' + escapeHtml(station.name_zh || '站點') + '詳情${iconUse('arrow-right', 16)}</a>' +
          '<details class="mp-score-evidence"><summary>${iconUse('chevron-down', 18, 'mp-disclosure-icon')}<span>查看評分依據</span></summary><p>以下是 API 回傳的計算值。連結正規化值代表「本次候選中的相對連結性」，不是旅客前往機率。</p>' + scoreEvidence(rec) +
          '<p>加權分量相加、扣除旅行成本後，負值截為 0，再取兩位小數。偏好數值是標籤評分，不是個人喜愛機率；缺漏代入與四捨五入詳見<a href="#about">推薦方法</a>。</p></details></article></li>';
      }).join('');
      if (typeof Chart !== 'undefined') renderCharts(recs);
    }

    function renderCharts(recs) {
      byId('chart-section').classList.remove('hidden');
      byId('chart-section').open = false;
      if (scoreChart) scoreChart.destroy();
      const styles = getComputedStyle(document.documentElement);
      scoreChart = new Chart(byId('score-chart'), {
        type: 'bar',
        data: { labels: recs.map(rec => rec.station.name_zh), datasets: [{
          label: '推薦排序分數',
          data: recs.map(rec => typeof rec.total_score === 'number' && Number.isFinite(rec.total_score) ? rec.total_score : null),
          backgroundColor: styles.getPropertyValue('--mp-accent').trim(), borderRadius: 0, barThickness: 20
        }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '排序分數 ' + numberText(ctx.parsed.x) } } },
          scales: {
            x: { min: 0, max: 1, ticks: { color: styles.getPropertyValue('--mp-text-muted').trim() }, grid: { color: styles.getPropertyValue('--mp-border').trim() } },
            y: { ticks: { color: styles.getPropertyValue('--mp-text').trim(), font: { size: 14, family: 'Noto Sans TC, sans-serif' } }, grid: { display: false } }
          }
        }
      });
      byId('chart-section').ontoggle = () => { if (byId('chart-section').open && scoreChart) scoreChart.resize(); };
    }

    function renderMetadata(meta) {
      const month = typeof meta.data_month === 'string' && meta.data_month.trim() ? meta.data_month.trim() : null;
      let source = '資料來源未知；月份未知。';
      if (meta.data_source === 'real') source = month ? '依 ' + month + ' 旅運資料' : '使用旅運資料；月份未知。';
      else if (meta.data_source === 'synthetic') source = '使用合成示範資料；不代表實際旅運觀測。';
      else if (month) source = '資料來源未知；API 標示月份：' + month + '。';
      const count = typeof meta.total_stations_evaluated === 'number' && Number.isFinite(meta.total_stations_evaluated) ? String(meta.total_stations_evaluated) : '未知';
      byId('metadata-section').innerHTML = '<div class="mp-data-note"><p>' + escapeHtml(source) + '</p><p>部分偏好與交通資訊來自既有標籤或估計資料。</p></div><p class="mp-score-note">候選資料：' + escapeHtml(count) + ' 筆站碼。分數用於本次排序，不是適合你的機率。<a href="#about">了解推薦方法</a></p>';
    }
  </script>
</body>
</html>`;
}

// ============================================================
// 站點詳情頁
// ============================================================
function renderStationDetailPage(stationId: string): string {
  return `${htmlHead('站點詳情 — MetroPulse')}
<body class="mp-detail mp-font mp-page antialiased">
  <a class="mp-skip-link" href="#main-content">跳至站點內容</a>
  ${htmlNav('detail', 'light')}

  <main class="mp-detail-shell mp-container" id="main-content">
    <nav class="mp-context-nav" aria-label="返回推薦">
      <a id="detail-back-link" class="mp-text-link" href="/">返回開始推薦</a>
    </nav>
    <div id="detail-loading" class="mp-page-state" role="status" aria-live="polite">
      <div class="spinner mx-auto mb-4"></div>
      <p>正在載入站點資料…</p>
    </div>
    <div id="detail-error" class="mp-page-state mp-page-state-error" role="alert" hidden>
      <h1 class="mp-state-heading">${iconUse('alert')}<span>站點資料暫時無法載入</span></h1>
      <p id="detail-error-message">請稍後再試，或返回推薦頁。</p>
      <button type="button" id="detail-retry" class="mp-btn-secondary">${iconUse('refresh')}<span>重新載入</span></button>
    </div>
    <div id="detail-content" class="hidden"></div>
  </main>

  ${htmlFooter()}

  <script>
    const STATION_ID = ${JSON.stringify(stationId).replace(/</g, '\\u003c')};
    const ROUTE_NAMES = { BL:'板南線', R:'淡水信義線', G:'松山新店線', O:'中和新蘆線', BR:'文湖線', Y:'環狀線' };
    const PERIOD_LABELS = {
      morning_peak:'晨峰 07:00–09:00', morning:'上午 09:00–12:00', noon:'午間 12:00–14:00',
      afternoon:'下午 14:00–17:00', evening_peak:'晚峰 17:00–19:00', night:'夜間 19:00–23:00'
    };
    const PREFERENCE_LABELS = { all:'不限', attraction:'景點', food:'美食', shopping:'購物', nightlife:'夜生活', family:'親子' };
    const VALID_PERIODS = new Set(Object.keys(PERIOD_LABELS));
    const VALID_PREFERENCES = new Set(Object.keys(PREFERENCE_LABELS));
    const recommendationContext = readRecommendationContext();
    let prChart = null;
    let radarChart = null;
    let detailLoadId = 0;

    document.addEventListener('DOMContentLoaded', () => {
      configureDetailNavigation();
      document.getElementById('detail-retry').addEventListener('click', loadStationDetail);
      loadStationDetail();
    });

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
    }

    function readRecommendationContext() {
      const params = new URLSearchParams(window.location.search);
      const from = params.get('from');
      const timePeriod = params.get('time_period');
      const preference = params.get('preference');
      if (params.get('context') !== 'recommendation' || !/^[A-Z]+\\d{1,2}[A-Z]?$/.test(from || '') || !VALID_PERIODS.has(timePeriod) || !VALID_PREFERENCES.has(preference)) return null;
      return Object.freeze({ from, timePeriod, preference });
    }

    function homeQueryUrl(from, restore) {
      const params = new URLSearchParams({ from });
      if (recommendationContext) {
        params.set('time_period', recommendationContext.timePeriod);
        params.set('preference', recommendationContext.preference);
        if (restore) params.set('restore', 'recommendations');
      }
      return '/?' + params.toString() + (restore ? '#results-section' : '');
    }

    function configureDetailNavigation() {
      const back = document.getElementById('detail-back-link');
      if (recommendationContext) {
        back.href = homeQueryUrl(recommendationContext.from, true);
        back.textContent = '返回本次推薦';
      }
    }

    async function fetchJson(url) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        let data = null;
        try { data = await response.json(); } catch (_) { /* handled below */ }
        if (!response.ok || !data?.success) throw new Error(data?.error || '資料服務暫時無法使用');
        return data;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('資料查詢逾時，請重新載入');
        throw error;
      } finally { clearTimeout(timeout); }
    }

    async function loadStationDetail() {
      const loadId = ++detailLoadId;
      if (prChart) { prChart.destroy(); prChart = null; }
      if (radarChart) { radarChart.destroy(); radarChart = null; }
      document.getElementById('detail-content').replaceChildren();
      document.getElementById('detail-loading').hidden = false;
      document.getElementById('detail-error').hidden = true;
      document.getElementById('detail-content').classList.add('hidden');
      try {
        const detailPromise = fetchJson('/api/station-detail/' + encodeURIComponent(STATION_ID));
        const recommendationPromise = recommendationContext
          ? fetchJson('/api/recommend?' + new URLSearchParams({ from: recommendationContext.from, time_period: recommendationContext.timePeriod, preference: recommendationContext.preference, top_n:'5' }).toString()).catch(() => null)
          : Promise.resolve(null);
        const [data, recommendationData] = await Promise.all([detailPromise, recommendationPromise]);
        if (loadId !== detailLoadId) return;
        document.getElementById('detail-loading').hidden = true;
        document.getElementById('detail-content').classList.remove('hidden');
        const recommendation = recommendationData?.recommendations?.find(item => item.station?.id === STATION_ID) || null;
        renderStationDetail(data, recommendation, recommendationData?.metadata || null, recommendationData?.query || null);
      } catch (e) {
        if (loadId !== detailLoadId) return;
        document.getElementById('detail-loading').hidden = true;
        document.getElementById('detail-error').hidden = false;
        document.getElementById('detail-error-message').textContent = e instanceof Error ? e.message + '。請保留此頁並重新載入。' : '請保留此頁並重新載入。';
      }
    }

    function routeBadges(station) {
      let transfers = [];
      try { transfers = Array.isArray(station.transfer_lines) ? station.transfer_lines : JSON.parse(station.transfer_lines || '[]'); } catch (_) { /* unavailable transfer codes remain unavailable */ }
      const codes = [...new Set([station.line, ...(Array.isArray(transfers) ? transfers : [])])].filter(code => Object.hasOwn(ROUTE_NAMES, code));
      return codes.length ? codes.map(code => '<span class="mp-route-badge" data-route="' + code + '" aria-label="' + code + ' ' + ROUTE_NAMES[code] + '">' + code + '</span>').join('') : '<span class="mp-route-unknown">路線資料不足</span>';
    }

    function preferenceReason(recommendation) {
      if (!recommendationContext || !recommendation) return null;
      const tags = (recommendation.tags || []).filter(item => typeof item === 'string');
      if (recommendationContext.preference === 'all') return tags.length ? '站點標籤：' + tags.join('、') + '。' : null;
      const icons = { attraction:'🏛️', food:'🍜', shopping:'🛍️', nightlife:'🌙', family:'👨‍👩‍👧‍👦' };
      const label = PREFERENCE_LABELS[recommendationContext.preference];
      const prefix = icons[recommendationContext.preference] + ' ' + label + '匹配度 ';
      const reason = (recommendation.reasons || []).find(item => typeof item === 'string' && item.startsWith(prefix));
      if (reason?.includes('：')) return label + '：' + reason.slice(reason.indexOf('：') + 1);
      return tags.length ? '站點標籤：' + tags.join('、') + '。' : null;
    }

    function renderStationDetail(data, recommendation, recommendationMetadata, recommendationQuery) {
      const { station, pagerank, preference, connections, metadata } = data;
      const preferredIndex = recommendationContext && recommendationContext.preference !== 'all'
        ? preference.categories.indexOf(recommendationContext.preference) : -1;
      const relationReason = preferenceReason(recommendation);
      const connectivity = recommendation?.score_breakdown?.connectivity?.normalized;
      const relationHtml = recommendationContext
        ? '<section class="mp-detail-section" aria-labelledby="relation-heading"><h2 id="relation-heading">與本次推薦的關係</h2>' +
          '<dl class="mp-context-summary"><div><dt>出發站</dt><dd>' + escapeHtml(recommendationQuery?.from_station?.name || recommendationContext.from) + (recommendationQuery?.from_station?.name ? ' <span>' + escapeHtml(recommendationContext.from) + '</span>' : '') + '</dd></div><div><dt>時段</dt><dd>' + escapeHtml(PERIOD_LABELS[recommendationContext.timePeriod]) + '</dd></div><div><dt>偏好</dt><dd>' + escapeHtml(PREFERENCE_LABELS[recommendationContext.preference]) + '</dd></div></dl>' +
          (relationReason ? '<p class="mp-detail-key-reason">' + escapeHtml(relationReason) + '</p>' : '<p>目前無法從這次查詢重建具體偏好理由；不以其他數值補寫推測。</p>') +
          (typeof connectivity === 'number' && Number.isFinite(connectivity) && connectivity >= .5 ? '<p>與出發站的人流連結在本次候選中較高。這是候選間的相對值，不是旅客前往機率。</p>' : '') +
          '<p class="mp-data-limit">站數、轉乘與旅行時間沒有可靠的結構化欄位，因此不在此推算。' + (recommendationMetadata?.data_source === 'real' ? '本次推薦摘要使用' + escapeHtml(recommendationMetadata.data_month || '月份未知的') + '旅運資料，但不代表詳情頁每一欄都有相同來源。' : '') + '</p></section>'
        : '';
      const bestPeriod = pagerank.best_period
        ? '<p><strong>PageRank 最高時段：</strong>' + escapeHtml(pagerank.best_period.time_period_label) + '，該時段排名 #' + escapeHtml(pagerank.best_period.pr_rank ?? '未知') + '。這表示該時段的路網相對重要性，不是即時擁擠度或最佳遊玩時間。</p>'
        : '<p>目前沒有可用的 PageRank 時段資料。</p>';

      document.getElementById('detail-content').innerHTML = \`
        <header class="mp-detail-identity">
          <div class="mp-route-badges">\${routeBadges(station)}</div>
          <h1>\${escapeHtml(station.name_zh)}</h1>
          <p class="mp-detail-english">\${escapeHtml(station.name_en || '英文站名資料不足')}</p>
          <dl class="mp-identity-meta">
            <div><dt>站碼</dt><dd>\${escapeHtml(station.id)}</dd></div>
            <div><dt>路線</dt><dd>\${escapeHtml(station.line_name || ROUTE_NAMES[station.line] || '資料不足')}</dd></div>
            <div><dt>行政區</dt><dd>\${escapeHtml(station.district || '資料不足')}</dd></div>
            <div><dt>轉乘</dt><dd>\${station.is_transfer_station ? (station.transfer_lines ? '既有資料標示為轉乘站' : '轉乘站；可用路線代碼資料未完整提供') : '非轉乘站'}</dd></div>
          </dl>
        </header>
        \${relationHtml}
        <section class="mp-detail-section" aria-labelledby="features-heading">
          <h2 id="features-heading">站點特徵</h2>
          <p>先看既有站點標籤與文字理由；本次偏好相關類型會排在前面。</p>
          <div id="tag-details" class="mp-feature-list"></div>
        </section>
        <section class="mp-detail-action" aria-labelledby="continue-heading">
          <div><h2 id="continue-heading">從這站繼續探索</h2><p>把出發站改成 \${escapeHtml(station.name_zh)}，\${recommendationContext ? '並保留原本的時段與偏好。' : '再設定時段與偏好。'}</p></div>
          <a href="\${escapeHtml(homeQueryUrl(station.id, false))}" class="mp-btn-secondary">改以此站出發</a>
        </section>
        <section class="mp-detail-evidence" aria-labelledby="evidence-heading">
          <div class="mp-detail-section-heading"><h2 id="evidence-heading" class="mp-heading-with-icon">${iconUse('info')}<span>資料依據</span></h2><p>以下圖表支援研究理解；每張圖後都有同源文字或資料列。</p></div>
          <article class="mp-evidence-block" aria-labelledby="pr-heading">
            <h3 id="pr-heading">PageRank 各時段</h3>
            \${bestPeriod}
            <div class="mp-detail-chart"><canvas id="pr-time-chart" role="img" aria-label="\${escapeHtml(station.name_zh)}六時段 PageRank 折線圖"></canvas></div>
            <div class="mp-table-scroll"><table class="mp-data-table"><caption>\${escapeHtml(station.name_zh)}各時段 PageRank 資料</caption><thead><tr><th scope="col">時段</th><th scope="col">PageRank</th><th scope="col">排名</th></tr></thead><tbody id="pr-data-rows"></tbody></table></div>
          </article>
          <article class="mp-evidence-block" aria-labelledby="preference-heading">
            <h3 id="preference-heading">偏好特徵</h3>
            <p>雷達圖範圍為 0–1；數值是既有站點標籤評分，不是個人喜愛機率。API 過去會把缺少標籤代入 0，本頁以 availability 額外標示資料不足。</p>
            <div class="mp-detail-chart mp-detail-chart-radar"><canvas id="preference-radar" role="img" aria-label="\${escapeHtml(station.name_zh)}五類偏好特徵雷達圖"></canvas></div>
            <div class="mp-table-scroll"><table class="mp-data-table"><caption>\${escapeHtml(station.name_zh)}偏好特徵資料</caption><thead><tr><th scope="col">類型</th><th scope="col">標籤值</th><th scope="col">說明</th></tr></thead><tbody id="preference-data-rows"></tbody></table></div>
          </article>
          <article class="mp-evidence-block" aria-labelledby="flow-heading">
            <h3 id="flow-heading">主要人流連結</h3>
            <p>連結值來自既有 transition_matrix；月份未由此 API 提供。「本站出發」優先顯示下午資料（若無則顯示第一個可用時段）；「流入本站」則讓每個來源站取跨時段最大值，兩者不是同一範圍。百分比是既有矩陣連結值乘以 100 的顯示方式，未提供觀測來源證明，不能當成實際旅客比例。</p>
            <div class="mp-flow-columns">
              <section aria-labelledby="outbound-heading"><h4 id="outbound-heading">本站 → 目的地</h4><div id="outbound-list" class="mp-flow-list"></div></section>
              <section aria-labelledby="inbound-heading"><h4 id="inbound-heading">來源站 → 本站</h4><div id="inbound-list" class="mp-flow-list"></div></section>
            </div>
          </article>
          <p class="mp-data-limit">詳情頁目前使用 \${escapeHtml(metadata?.pagerank_source || '既有 PageRank 資料')} 與 \${escapeHtml(metadata?.connection_source || '既有連結資料')}；月份 provenance 未提供，不能視為首頁 real metadata 的逐欄證明。</p>
        </section>
      \`;

      renderTagDetails(preference, preferredIndex);
      renderPRTable(pagerank.time_series);
      renderPreferenceTable(preference);
      renderConnections(connections);
      renderPRChart(pagerank.time_series);
      renderRadarChart(preference);
    }

    function chartTokens() {
      const styles = getComputedStyle(document.documentElement);
      return {
        ink: styles.getPropertyValue('--mp-accent').trim() || '#172B32',
        muted: styles.getPropertyValue('--mp-text-muted').trim() || '#52626A',
        border: styles.getPropertyValue('--mp-border').trim() || '#D8DEDA',
        surface: styles.getPropertyValue('--mp-surface').trim() || '#FFFFFF'
      };
    }

    function renderPRTable(timeSeries) {
      const order = ['morning_peak','morning','noon','afternoon','evening_peak','night'];
      document.getElementById('pr-data-rows').innerHTML = order.map(period => {
        const item = timeSeries.find(row => row.time_period === period);
        return '<tr><th scope="row">' + escapeHtml(PERIOD_LABELS[period]) + '</th><td>' + (typeof item?.pr_value === 'number' ? item.pr_value.toFixed(6) : '資料不足') + '</td><td>' + (item?.pr_rank == null ? '資料不足' : '#' + escapeHtml(item.pr_rank)) + '</td></tr>';
      }).join('');
    }

    function renderPRChart(timeSeries) {
      const order = ['morning_peak','morning','noon','afternoon','evening_peak','night'];
      const sorted = order.map(period => timeSeries.find(item => item.time_period === period) || null);
      if (!sorted.some(Boolean) || typeof Chart === 'undefined') {
        document.getElementById('pr-time-chart').parentElement.hidden = true;
        return;
      }
      const colors = chartTokens();
      prChart = new Chart(document.getElementById('pr-time-chart'), {
        type: 'line',
        data: {
          labels: order.map(period => PERIOD_LABELS[period].split(' ')[0]),
          datasets: [{
            label: 'PageRank 值',
            data: sorted.map(item => typeof item?.pr_value === 'number' ? item.pr_value : null),
            borderColor: colors.ink,
            backgroundColor: colors.surface,
            fill: false,
            tension: 0,
            spanGaps: false,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: colors.surface,
            pointBorderColor: colors.ink,
            pointBorderWidth: 2,
          }]
        },
        options: {
          animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 160 },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => {
                  const d = sorted[ctx.dataIndex];
                  return d ? '排名：' + (d.pr_rank == null ? '資料不足' : '#' + d.pr_rank) : '此時段資料不足';
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'PageRank 值', color: colors.muted },
              ticks: { color: colors.muted },
              grid: { color: colors.border },
            },
            x: {
              title: { display: true, text: '時段', color: colors.muted },
              ticks: { color: colors.muted },
              grid: { display: false },
            },
          },
        },
      });
    }

    function renderPreferenceTable(pref) {
      const availability = Array.isArray(pref.availability) ? pref.availability : pref.scores.map(() => false);
      document.getElementById('preference-data-rows').innerHTML = pref.labels.map((label, index) => {
        const available = availability[index] === true;
        const reason = available ? (pref.reasons[label] || '有標籤值，未提供文字理由。') : '目前無法確認這類標籤資料；不是已觀測的 0。';
        return '<tr><th scope="row">' + escapeHtml(label) + '</th><td>' + (available && typeof pref.scores[index] === 'number' ? pref.scores[index].toFixed(2) : '資料不足') + '</td><td>' + escapeHtml(reason) + '</td></tr>';
      }).join('');
    }

    function renderRadarChart(pref) {
      const availability = Array.isArray(pref.availability) ? pref.availability : pref.scores.map(() => false);
      if (!availability.some(Boolean) || typeof Chart === 'undefined') {
        document.getElementById('preference-radar').parentElement.hidden = true;
        return;
      }
      const colors = chartTokens();
      radarChart = new Chart(document.getElementById('preference-radar'), {
        type: 'radar',
        data: {
          labels: pref.labels,
          datasets: [{
            label: '偏好分數',
            data: pref.scores.map((score, index) => availability[index] ? score : null),
            backgroundColor: 'rgba(52, 85, 99, 0.12)',
            borderColor: colors.ink,
            borderWidth: 2,
            pointBackgroundColor: colors.surface,
            pointBorderColor: colors.ink,
            pointBorderWidth: 2,
            pointRadius: 4,
          }]
        },
        options: {
          animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 160 },
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            r: {
              min: 0,
              max: 1,
              angleLines: { color: colors.border },
              grid: { color: colors.border },
              ticks: {
                stepSize: 0.2,
                backdropColor: colors.surface,
                color: colors.muted,
                font: { size: 11 },
              },
              pointLabels: { font: { size: 12, weight: '600' }, color: colors.ink },
            },
          },
        },
      });
    }

    function renderTagDetails(pref, preferredIndex) {
      const availability = Array.isArray(pref.availability) ? pref.availability : pref.scores.map(() => false);
      const order = pref.labels.map((_, index) => index);
      if (preferredIndex >= 0) order.unshift(order.splice(order.indexOf(preferredIndex), 1)[0]);
      const container = document.getElementById('tag-details');
      container.innerHTML = order.map(index => {
        const label = pref.labels[index];
        const available = availability[index] === true;
        const score = available && typeof pref.scores[index] === 'number' ? pref.scores[index].toFixed(2) : '資料不足';
        const reason = available ? (pref.reasons[label] || '有標籤值，未提供文字理由。') : '目前無法確認這類標籤資料，不能判定為真實 0 分。';
        return '<div class="mp-feature-row"><div><h3>' + escapeHtml(label) + (index === preferredIndex ? '<span class="mp-inline-note">本次偏好</span>' : '') + '</h3><p>' + escapeHtml(reason) + '</p></div><span class="mp-feature-value">' + escapeHtml(score) + '</span></div>';
      }).join('');
    }

    function renderConnections(conn) {
      const outEl = document.getElementById('outbound-list');
      if (conn.outbound.length === 0) {
        outEl.innerHTML = '<p class="mp-empty-inline">目前沒有本站出發的連結資料。</p>';
      } else {
        const groups = {};
        conn.outbound.forEach(c => {
          if (!groups[c.time_period]) groups[c.time_period] = [];
          if (groups[c.time_period].length < 5) groups[c.time_period].push(c);
        });
        const display = groups['afternoon'] || groups[Object.keys(groups)[0]] || [];
        outEl.innerHTML = display.map(c => {
          const value = typeof c.transition_prob === 'number' ? (c.transition_prob * 100).toFixed(1) + '%' : '資料不足';
          return '<div class="mp-flow-row"><span class="mp-route-badge" data-route="' + escapeHtml(c.line) + '">' + escapeHtml(c.line) + '</span><div><a href="/station/' + encodeURIComponent(c.to_station_id) + '">' + escapeHtml(c.name_zh) + '</a><span>' + escapeHtml(c.to_station_id) + ' · ' + escapeHtml(PERIOD_LABELS[c.time_period] || c.time_period) + '</span></div><strong>' + value + '</strong></div>';
        }).join('');
      }

      const inEl = document.getElementById('inbound-list');
      if (conn.inbound.length === 0) {
        inEl.innerHTML = '<p class="mp-empty-inline">目前沒有流入本站的連結資料。</p>';
      } else {
        const unique = {};
        conn.inbound.forEach(c => {
          if (!unique[c.from_station_id] || c.transition_prob > unique[c.from_station_id].transition_prob)
            unique[c.from_station_id] = c;
        });
        const display = Object.values(unique).sort((a,b) => b.transition_prob - a.transition_prob).slice(0, 5);
        inEl.innerHTML = display.map(c => {
          const value = typeof c.transition_prob === 'number' ? (c.transition_prob * 100).toFixed(1) + '%' : '資料不足';
          return '<div class="mp-flow-row"><span class="mp-route-badge" data-route="' + escapeHtml(c.line) + '">' + escapeHtml(c.line) + '</span><div><a href="/station/' + encodeURIComponent(c.from_station_id) + '">' + escapeHtml(c.name_zh) + '</a><span>' + escapeHtml(c.from_station_id) + ' · ' + escapeHtml(PERIOD_LABELS[c.time_period] || c.time_period) + '</span></div><strong>' + value + '</strong></div>';
        }).join('');
      }
    }
  </script>
</body>
</html>`;
}

// ============================================================
// Analytics 頁面
// ============================================================

function renderAnalyticsPage(): string {
  return `${htmlHead('旅運量分析 — MetroPulse')}
<body class="mp-analytics mp-font mp-page antialiased">
<a class="mp-skip-link" href="#main-content">跳至分析內容</a>
${htmlNav('analytics', 'light')}
<main id="main-content" class="mp-analytics-shell mp-container">
  <header class="mp-analytics-intro">
    <h1>旅運量分析</h1>
    <p>選擇月份、時段與範圍，深入查看站點在旅運網路中的相對重要性。</p>
  </header>

  <!-- 說明橫幅 -->
  <div id="no-data-banner" class="mp-page-state mp-page-state-warning" hidden>
    ${iconUse('alert')}<strong id="month-state-title">正在確認月份資料。</strong>
    <span>目前無法顯示排名與月份資料；你的篩選條件會保留。</span>
    <button type="button" id="retry-init" class="mp-btn-secondary">${iconUse('refresh')}<span>重新載入資料</span></button>
  </div>

  <!-- 控制列 -->
  <section class="mp-analytics-controls" aria-labelledby="analysis-controls-heading">
    <h2 id="analysis-controls-heading">分析範圍</h2>
    <div class="mp-control-grid">
    <div>
      <label for="sel-month">月份</label>
      <select id="sel-month" class="mp-control"></select>
    </div>
    <div>
      <label for="sel-period">時段</label>
      <select id="sel-period" class="mp-control">
        <option value="morning_peak">晨峰 07:00–09:00</option>
        <option value="morning">上午 09:00–12:00</option>
        <option value="noon">午間 12:00–14:00</option>
        <option value="afternoon">下午 14:00–17:00</option>
        <option value="evening_peak">晚峰 17:00–19:00</option>
        <option value="night">夜間 19:00–23:00</option>
      </select>
    </div>
    <div>
      <label for="sel-topn">顯示範圍</label>
      <select id="sel-topn" class="mp-control">
        <option value="10">Top 10</option>
        <option value="20" selected>Top 20</option>
        <option value="30">Top 30</option>
      </select>
    </div>
    <button type="button" id="btn-load" class="mp-btn-primary">更新分析</button>
    </div>
  </section>

  <section id="analytics-current" class="mp-analytics-current" aria-labelledby="current-data-heading">
    <h2 id="current-data-heading">目前查看的資料</h2>
    <p id="current-data-summary" role="status" aria-live="polite">正在取得可用月份…</p>
  </section>

  <!-- Tab 切換 -->
  <div class="mp-tabs" role="tablist" aria-label="分析檢視">
    <button id="tab-btn-ranking" type="button" role="tab" aria-selected="true" aria-controls="tab-ranking" tabindex="0" class="tab-btn active" data-tab="ranking">${iconUse('ranking', 18, 'mp-tab-icon')}<span class="mp-tab-label">站點排名</span></button>
    <button id="tab-btn-chart" type="button" role="tab" aria-selected="false" aria-controls="tab-chart" tabindex="-1" class="tab-btn" data-tab="chart">${iconUse('chart', 18, 'mp-tab-icon')}<span class="mp-tab-label">圖表比較</span></button>
    <button id="tab-btn-trend" type="button" role="tab" aria-selected="false" aria-controls="tab-trend" tabindex="-1" class="tab-btn" data-tab="trend">${iconUse('calendar', 18, 'mp-tab-icon')}<span class="mp-tab-label">月份資料</span></button>
  </div>

  <!-- 排名表 Tab -->
  <div id="tab-ranking" role="tabpanel" aria-labelledby="tab-btn-ranking" tabindex="0">
    <section class="mp-analytics-panel" aria-labelledby="ranking-heading">
      <div class="mp-panel-heading">
        <h2 id="ranking-heading">站點 PageRank 排名</h2>
        <span id="rank-subtitle"></span>
      </div>
      <div id="rank-loading" class="mp-page-state" role="status" aria-live="polite">載入中…</div>
      <button type="button" id="rank-retry" class="mp-btn-secondary" hidden>${iconUse('refresh')}<span>重試排名</span></button>
      <div id="rank-table" class="mp-ranking-list" role="table" aria-label="站點 PageRank 排名" hidden></div>
    </section>
  </div>

  <!-- 長條圖 Tab -->
  <div id="tab-chart" role="tabpanel" aria-labelledby="tab-btn-chart" tabindex="0" hidden>
    <section class="mp-analytics-panel" aria-labelledby="comparison-heading">
      <h2 id="comparison-heading">PageRank 圖表比較</h2>
      <p id="bar-takeaway">先完成一次排名查詢。圖表與排名使用相同的 Top N 範圍。</p>
      <div class="mp-analytics-chart" id="bar-chart-wrap" hidden>
        <canvas id="bar-chart" role="img" aria-label="所選月份與時段的站點 PageRank 水平長條圖"></canvas>
      </div>
      <p class="mp-data-limit">圖表使用單一中性色比較數值；路線色只出現在路線代碼牌。完整數值可在「站點排名」頁籤讀取。</p>
    </section>
  </div>

  <!-- 趨勢 Tab -->
  <div id="tab-trend" role="tabpanel" aria-labelledby="tab-btn-trend" tabindex="0" hidden>
    <section class="mp-analytics-panel" aria-labelledby="trend-heading">
      <h2 id="trend-heading">月份資料</h2>
      <p id="trend-intro">選擇站點與時段後查看各月份 PageRank；只有兩個以上月份時才可判讀趨勢。</p>
      <div class="mp-trend-controls">
        <div>
          <label for="trend-station">站點</label>
          <input id="trend-station" class="mp-control" type="text" list="trend-stations" placeholder="輸入站碼或選擇站點" autocomplete="off" aria-describedby="trend-station-help trend-msg">
          <datalist id="trend-stations"></datalist>
        </div>
        <div>
          <label for="trend-period">時段</label>
          <select id="trend-period" class="mp-control">
            <option value="morning_peak">晨峰 07:00–09:00</option>
            <option value="morning">上午 09:00–12:00</option>
            <option value="noon">午間 12:00–14:00</option>
            <option value="afternoon">下午 14:00–17:00</option>
            <option value="evening_peak">晚峰 17:00–19:00</option>
            <option value="night">夜間 19:00–23:00</option>
          </select>
        </div>
        <button type="button" id="btn-trend" class="mp-btn-primary">查看月份資料</button>
      </div>
      <p id="trend-station-help" class="mp-control-help">建議選擇明確站碼，避免同名轉乘站混淆。</p>
      <div id="trend-msg" class="mp-page-state" role="status" aria-live="polite">選擇站點後查看月份資料。</div>
      <button type="button" id="trend-retry" class="mp-btn-secondary" hidden>${iconUse('refresh')}<span>重試月份資料</span></button>
      <div class="mp-analytics-chart mp-trend-chart" id="trend-chart-wrap" hidden>
        <canvas id="trend-chart" role="img" aria-label="所選站點各月份 PageRank 折線圖"></canvas>
      </div>
      <div id="trend-table-wrap" class="mp-table-scroll" hidden><table class="mp-data-table"><caption id="trend-caption">站點月份 PageRank 資料</caption><thead><tr><th scope="col">月份</th><th scope="col">PageRank</th><th scope="col">排名</th></tr></thead><tbody id="trend-rows"></tbody></table></div>
    </section>
  </div>

  <section class="mp-analytics-definition" aria-labelledby="definition-heading">
    <h2 id="definition-heading">資料定義與限制</h2>
    <dl><div><dt>資料來源</dt><dd>已匯入的台北捷運月度 OD 資料與其 PageRank 計算結果。</dd></div><div><dt>PageRank</dt><dd>站點在指定月份與時段的路網相對重要性，不是即時人潮或擁擠度。</dd></div><div><dt>缺值</dt><dd>資料缺少不等於觀測值為 0；本頁不推測未由 API 提供的欄位 provenance。</dd></div></dl>
  </section>
</main>
${htmlFooter()}

<script>
const ANALYTICS_PERIODS = {
  morning_peak:'晨峰 07:00–09:00', morning:'上午 09:00–12:00', noon:'午間 12:00–14:00',
  afternoon:'下午 14:00–17:00', evening_peak:'晚峰 17:00–19:00', night:'夜間 19:00–23:00'
};
let barChart = null;
let trendChart = null;
let currentData = [];
let availableMonths = [];
let stations = [];
let rankingRequest = null;
let trendRequest = null;
let initRequest = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function chartTokens() {
  const styles = getComputedStyle(document.documentElement);
  return {
    ink: styles.getPropertyValue('--mp-accent').trim() || '#172B32',
    muted: styles.getPropertyValue('--mp-text-muted').trim() || '#52626A',
    border: styles.getPropertyValue('--mp-border').trim() || '#D8DEDA',
    surface: styles.getPropertyValue('--mp-surface').trim() || '#FFFFFF'
  };
}

async function fetchJson(url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    let data = null;
    try { data = await response.json(); } catch (_) { /* handled below */ }
    if (!response.ok || !data?.success) throw new Error(data?.error || '資料服務暫時無法使用');
    return data;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('資料查詢逾時');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function clearRanking(message) {
  const previous = rankingRequest;
  rankingRequest = null;
  previous?.abort();
  currentData = [];
  if (barChart) { barChart.destroy(); barChart = null; }
  document.getElementById('bar-chart-wrap').hidden = true;
  document.getElementById('rank-table').hidden = true;
  document.getElementById('rank-table').replaceChildren();
  document.getElementById('rank-subtitle').textContent = '';
  document.getElementById('rank-retry').hidden = true;
  document.getElementById('rank-loading').hidden = false;
  document.getElementById('rank-loading').textContent = message;
  document.getElementById('current-data-summary').textContent = message;
  document.getElementById('bar-takeaway').textContent = message;
  document.getElementById('btn-load').disabled = false;
}

function clearTrend(message) {
  const previous = trendRequest;
  trendRequest = null;
  previous?.abort();
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  document.getElementById('trend-chart-wrap').hidden = true;
  document.getElementById('trend-table-wrap').hidden = true;
  document.getElementById('trend-rows').replaceChildren();
  document.getElementById('trend-retry').hidden = true;
  document.getElementById('trend-heading').textContent = '月份資料';
  document.querySelector('#tab-btn-trend .mp-tab-label').textContent = '月份資料';
  document.getElementById('trend-msg').textContent = message;
  document.getElementById('btn-trend').disabled = false;
  document.getElementById('trend-station').removeAttribute('aria-invalid');
}

// ── 初始化 ──────────────────────────────────────────
async function init() {
  if (initRequest) return;
  const request = new AbortController();
  initRequest = request;
  const selectedMonth = document.getElementById('sel-month').value;
  document.getElementById('retry-init').disabled = true;
  document.getElementById('no-data-banner').hidden = true;
  clearRanking('正在取得可用月份…');
  clearTrend('選擇站點後查看月份資料。');
  try {
    const [monthData, stationData] = await Promise.all([
      fetchJson('/api/analytics/months', request.signal),
      fetchJson('/api/stations', request.signal).catch(() => ({ stations: [] }))
    ]);
    if (initRequest !== request) return;
    availableMonths = Array.isArray(monthData.months) ? monthData.months : [];
    stations = Array.isArray(stationData.stations) ? stationData.stations : [];
    const monthSelect = document.getElementById('sel-month');
    monthSelect.replaceChildren();
    availableMonths.forEach(month => {
      const option = document.createElement('option');
      option.value = month.year + '-' + String(month.month).padStart(2,'0');
      option.textContent = month.label || (month.year + '年' + month.month + '月');
      monthSelect.appendChild(option);
    });
    if (Array.from(monthSelect.options).some(option => option.value === selectedMonth)) monthSelect.value = selectedMonth;
    document.getElementById('trend-stations').innerHTML = stations.map(station => '<option value="' + escapeHtml(station.id) + '" label="' + escapeHtml(station.name_zh) + '"></option>').join('');
    if (!availableMonths.length) {
      document.getElementById('month-state-title').textContent = '目前沒有可用的月份資料。';
      document.getElementById('no-data-banner').hidden = false;
      clearRanking('目前沒有可用月份。');
      return;
    }
    await loadRanking();
  } catch (error) {
    if (initRequest !== request) return;
    document.getElementById('month-state-title').textContent = '月份資料載入失敗，無法確認資料是否可用。';
    document.getElementById('no-data-banner').hidden = false;
    clearRanking('無法確認目前資料範圍，請重新載入資料。');
  } finally {
    if (initRequest === request) {
      initRequest = null;
      document.getElementById('retry-init').disabled = false;
    }
  }
}

// ── Tab 切換 ─────────────────────────────────────────
function switchTab(name, btn) {
  ['ranking','chart','trend'].forEach(t => {
    document.getElementById('tab-'+t).hidden = t !== name;
  });
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
    b.tabIndex = -1;
  });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  btn.tabIndex = 0;
  if (name === 'chart' && currentData.length > 0) renderBarChart(currentData);
}

function configureAnalyticsEvents() {
  ['sel-month', 'sel-period', 'sel-topn'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => clearRanking('條件已變更，請按「更新分析」查看資料。'));
  });
  document.getElementById('trend-station').addEventListener('input', () => clearTrend('站點已變更，請重新查看月份資料。'));
  document.getElementById('trend-period').addEventListener('change', () => clearTrend('時段已變更，請重新查看月份資料。'));
  document.getElementById('btn-load').addEventListener('click', loadRanking);
  document.getElementById('rank-retry').addEventListener('click', loadRanking);
  document.getElementById('btn-trend').addEventListener('click', loadTrend);
  document.getElementById('trend-retry').addEventListener('click', loadTrend);
  document.getElementById('retry-init').addEventListener('click', init);
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab, tab));
    tab.addEventListener('keydown', event => {
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) { event.preventDefault(); switchTab(next.dataset.tab, next); next.focus(); }
    });
  });
}

// ── 載入排名 ─────────────────────────────────────────
async function loadRanking() {
  const selVal = document.getElementById('sel-month').value;
  if (!selVal) return;
  const [y, m] = selVal.split('-');
  const period = document.getElementById('sel-period').value;
  const topN = document.getElementById('sel-topn').value;
  const scope = y + '年' + Number(m) + '月 · ' + (ANALYTICS_PERIODS[period] || period) + ' · Top ' + topN;
  clearRanking('正在載入 ' + scope + '…');
  const request = new AbortController();
  rankingRequest = request;
  document.getElementById('btn-load').disabled = true;
  try {
    const json = await fetchJson('/api/analytics/pagerank?' + new URLSearchParams({ year:y, month:m, period, top_n:topN }).toString(), request.signal);
    if (rankingRequest !== request) return;
    currentData = Array.isArray(json.rankings) ? json.rankings : [];
    const monthLabel = y + '年' + Number(m) + '月';
    const scope = monthLabel + ' · ' + (ANALYTICS_PERIODS[period] || period) + ' · Top ' + topN;
    document.getElementById('rank-subtitle').textContent = scope;
    document.getElementById('current-data-summary').textContent = '真實月度資料 · ' + scope + '。PageRank 表示指定範圍內的路網相對重要性。';
    if (!currentData.length) {
      document.getElementById('rank-loading').textContent = '這組月份與時段目前沒有排名資料。請保留條件並改選其他範圍。';
      document.getElementById('bar-takeaway').textContent = '目前沒有可比較的站點資料。';
      return;
    }
    renderRankTable(currentData);
    if (!document.getElementById('tab-chart').hidden) renderBarChart(currentData);
  } catch (error) {
    if (rankingRequest !== request) return;
    const message = scope + ' 載入失敗；條件已保留，請按「更新分析」重試。';
    document.getElementById('rank-loading').textContent = message;
    document.getElementById('current-data-summary').textContent = message;
    document.getElementById('bar-takeaway').textContent = message;
    document.getElementById('rank-retry').hidden = false;
  } finally {
    if (rankingRequest === request) {
      document.getElementById('btn-load').disabled = false;
      rankingRequest = null;
    }
  }
}

// ── 排名表 ───────────────────────────────────────────
function renderRankTable(items) {
  const maxPr = Math.max(0, ...items.filter(r => Number.isFinite(r.pr_value)).map(r => r.pr_value));
  const container = document.getElementById('rank-table');
  container.innerHTML = '<div class="sr-only" role="row"><span role="columnheader">排名</span><span role="columnheader">路線</span><span role="columnheader">站點</span><span role="columnheader">PageRank</span></div>' + items.map((r, i) => {
    const barW = Number.isFinite(r.pr_value) && maxPr > 0 ? Math.round((r.pr_value / maxPr) * 100) : 0;
    const transfer = r.is_transfer_station ? '<span class="mp-inline-note">轉乘站</span>' : '';
    return '<div class="mp-ranking-row" role="row"><span class="mp-ranking-rank" role="cell">' + escapeHtml(r.pr_rank ?? '未知') + '</span><span class="mp-route-badge" data-route="' + escapeHtml(r.line) + '" role="cell">' + escapeHtml(r.line) + '</span><div class="mp-ranking-station" role="cell"><a href="/station/' + encodeURIComponent(r.station_id) + '">' + escapeHtml(r.name_zh) + '</a>' + transfer + '<span>' + escapeHtml(r.station_id) + '</span><div class="mp-ranking-bar" aria-hidden="true"><span style="width:' + barW + '%"></span></div></div><strong role="cell">' + (Number.isFinite(r.pr_value) ? (r.pr_value * 100).toFixed(4) + '%' : '資料不足') + '</strong></div>';
  }).join('');
  document.getElementById('rank-loading').hidden = true;
  container.hidden = false;
}

// ── 長條圖 ───────────────────────────────────────────
function renderBarChart(items) {
  const ctx = document.getElementById('bar-chart');
  if (barChart) { barChart.destroy(); barChart = null; }
  if (!items.length || typeof Chart === 'undefined') return;
  const colors = chartTokens();
  document.getElementById('bar-chart-wrap').hidden = false;
  document.getElementById('bar-chart-wrap').style.height = Math.max(360, items.length * 34) + 'px';
  const first = items[0];
  document.getElementById('bar-takeaway').textContent = '目前範圍共顯示 ' + items.length + ' 站；排名首筆為 ' + first.name_zh + '，PageRank ' + (Number.isFinite(first.pr_value) ? (first.pr_value * 100).toFixed(4) + '%' : '資料不足') + '。圖表與排名列使用相同範圍；缺值不畫成 0。';
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(r => r.name_zh),
      datasets: [{
        label: 'PageRank 值',
        data: items.map(r => Number.isFinite(r.pr_value) ? +(r.pr_value * 100).toFixed(5) : null),
        backgroundColor: colors.ink,
        borderWidth: 0,
        borderRadius: 0,
      }]
    },
    options: {
      indexAxis: 'y',
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 160 },
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => \`PR: \${ctx.raw.toFixed(5)}%\` }
      }},
      scales: {
        x: { ticks: { color: colors.muted }, grid: { color: colors.border }, title: { display: true, text: 'PageRank（%）', color: colors.muted } },
        y: { ticks: { color: colors.ink, font: { size: 12 } }, grid: { display: false } }
      }
    }
  });
}

// ── 趨勢圖 ───────────────────────────────────────────
async function loadTrend() {
  clearTrend('正在檢查站點與時段…');
  const rawStation = document.getElementById('trend-station').value.trim();
  const directId = rawStation.toUpperCase();
  const stationById = stations.find(station => station.id === directId);
  const nameMatches = stations.filter(station => station.name_zh === rawStation || (station.name_en || '').toLowerCase() === rawStation.toLowerCase());
  if (!stationById && nameMatches.length > 1) {
    document.getElementById('trend-msg').textContent = '這個站名對應多個站碼，請從建議中選擇明確站碼。';
    document.getElementById('trend-station').setAttribute('aria-invalid', 'true');
    document.getElementById('trend-station').focus();
    return;
  }
  const exactStation = stationById || nameMatches[0];
  const sid = exactStation?.id || directId;
  const period = document.getElementById('trend-period').value;
  if (!sid || !/^[A-Z]+\\d{1,2}[A-Z]?$/.test(sid)) {
    document.getElementById('trend-msg').textContent = '請從建議中選擇站點，或輸入完整站碼。';
    document.getElementById('trend-station').setAttribute('aria-invalid', 'true');
    document.getElementById('trend-station').focus();
    return;
  }
  document.getElementById('trend-station').value = sid;
  const request = new AbortController();
  trendRequest = request;
  document.getElementById('btn-trend').disabled = true;
  document.getElementById('trend-msg').textContent = '載入中…';
  try {
    const json = await fetchJson('/api/analytics/trends?' + new URLSearchParams({ station:sid, period }).toString(), request.signal);
    if (trendRequest !== request) return;
    const trends = Array.isArray(json.trends) ? json.trends : [];
    if (!trends.length) {
      document.getElementById('trend-heading').textContent = '月份資料';
      document.getElementById('trend-msg').textContent = '這個站點與時段目前沒有月份資料。請改選站點或時段。';
      return;
    }
    const stationName = exactStation?.name_zh ? exactStation.name_zh + ' ' + sid : sid;
    const hasTrend = trends.length > 1;
    document.getElementById('trend-heading').textContent = hasTrend ? '跨月份 PageRank 趨勢' : '月份資料';
    document.querySelector('#tab-btn-trend .mp-tab-label').textContent = hasTrend ? '跨月趨勢' : '月份資料';
    document.getElementById('trend-msg').textContent = hasTrend
      ? stationName + ' · ' + ANALYTICS_PERIODS[period] + ' · 共 ' + trends.length + ' 個月份，可比較變化。'
      : stationName + ' · ' + ANALYTICS_PERIODS[period] + ' · 目前僅一個月份，尚不足判讀趨勢。';
    document.getElementById('trend-caption').textContent = stationName + ' · ' + ANALYTICS_PERIODS[period] + ' PageRank 月份資料';
    document.getElementById('trend-rows').innerHTML = trends.map(item => '<tr><th scope="row">' + item.year + '年' + item.month + '月</th><td>' + (typeof item.pr_value === 'number' ? item.pr_value.toFixed(7) : '資料不足') + '</td><td>' + (item.pr_rank == null ? '資料不足' : '#' + escapeHtml(item.pr_rank)) + '</td></tr>').join('');
    document.getElementById('trend-table-wrap').hidden = false;
    if (hasTrend && typeof Chart !== 'undefined') {
      const colors = chartTokens();
      document.getElementById('trend-chart-wrap').hidden = false;
      trendChart = new Chart(document.getElementById('trend-chart'), {
        type: 'line',
        data: {
          labels: trends.map(item => item.year + '年' + item.month + '月'),
          datasets: [{
            label: stationName + ' PageRank',
            data: trends.map(item => Number.isFinite(item.pr_value) ? +(item.pr_value * 100).toFixed(5) : null),
            borderColor: colors.ink,
            backgroundColor: colors.surface,
            pointBackgroundColor: colors.surface,
            pointBorderColor: colors.ink,
            pointBorderWidth: 2,
            pointRadius: 4,
            tension: 0,
            fill: false
          }]
        },
        options: {
          animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 160 },
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: colors.muted }, grid: { display: false } },
            y: { ticks: { color: colors.muted }, grid: { color: colors.border }, title: { display: true, text: 'PageRank（%）', color: colors.muted } }
          }
        }
      });
    }
  } catch (error) {
    if (trendRequest !== request) return;
    document.getElementById('trend-msg').textContent = '月份資料載入失敗；站點與時段已保留。';
    document.getElementById('trend-retry').hidden = false;
  } finally {
    if (trendRequest === request) {
      document.getElementById('btn-trend').disabled = false;
      trendRequest = null;
    }
  }
}

configureAnalyticsEvents();
init();
</script>
</body>
</html>`;
}

export default app;
