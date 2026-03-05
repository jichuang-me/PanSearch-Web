/**
 * PanSearch Web App
 * Hybrid Mode: Local Server (Fast) + Serverless (GitHub Pages Friendly)
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const BACKEND_URL = (window.location.protocol === 'file:')
    ? 'http://localhost:8080/api/search'
    : '/api/search';

const HOT_KEYWORDS = [
    '三体', '甄嬛传', '黑神话悟空', '权力的游戏', '流浪地球',
    '编程入门', '考研资料', '雅思托福', 'AI教程', '设计素材'
];

// Mapping for categories to keywords or specific search logic if needed
const CAT_MAP = {
    'all': '',
    'movie': '影视',
    'music': '音乐',
    'software': '软件',
    'doc': '资料'
};

// ─── State ────────────────────────────────────────────────────────────────────
let allResults = [];
let activeType = 'all';
let activeCat = 'all';
let isSearching = false;

// ─── UTILS ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// DOM Elements
const viewSearch = $('view-search');
const viewResults = $('view-results');
const searchInput = $('search-input');
const searchBtn = $('search-btn');
const resultsInput = $('results-input');
const resultsSearchBtn = $('results-search-btn');
const backBtn = $('back-btn');
const resultsGrid = $('results-grid');
const resultInfo = $('result-info');
const hotTagsEl = $('hot-tags');
const latestListEl = $('latest-list');

async function fetchWithProxy(url) {
    const encodedUrl = encodeURIComponent(url);
    const timestamp = Date.now();
    try {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodedUrl}&_=${timestamp}`);
        if (res.ok) {
            const json = await res.json();
            if (json.contents) return json.contents;
        }
    } catch (e) { }
    try {
        const res = await fetch(`https://corsproxy.io/?${encodedUrl}`);
        if (res.ok) return await res.text();
    } catch (e) { }
    return null;
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
(function init() {
    if (!viewSearch) return;
    bindEvents();
    loadDiscovery();
})();

function bindEvents() {
    const handleSearch = () => {
        const val = (viewResults.classList.contains('active') ? resultsInput : searchInput).value.trim();
        if (val) doSearch(val);
    };

    if (searchBtn) searchBtn.onclick = handleSearch;
    if (searchInput) searchInput.onkeydown = e => e.key === 'Enter' && handleSearch();
    if (resultsSearchBtn) resultsSearchBtn.onclick = handleSearch;
    if (resultsInput) resultsInput.onkeydown = e => e.key === 'Enter' && handleSearch();
    if (backBtn) backBtn.onclick = showSearch;

    // Type Filters
    document.querySelectorAll('.type-filter .tag').forEach(tag => {
        tag.onclick = () => {
            const type = tag.dataset.type;
            document.querySelectorAll('.type-filter .tag').forEach(t => t.classList.toggle('active', t.dataset.type === type));
            activeType = type;
            renderCards(allResults);
        };
    });

    // Discovery Category Tabs
    document.querySelectorAll('.disc-tab').forEach(tab => {
        tab.onclick = () => {
            if (isSearching) return;
            const cat = tab.dataset.cat;
            document.querySelectorAll('.disc-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
            activeCat = cat;
            loadLatestByCategory(cat);
        };
    });
}

// ─── DISCOVERY (HOT + LATEST) ───────────────────────────────────────────────
async function loadDiscovery() {
    if (hotTagsEl) {
        hotTagsEl.innerHTML = HOT_KEYWORDS.map(k => `<span class="hot-pill" onclick="doSearch('${k}')">${k}</span>`).join('');
    }
    loadLatestByCategory('all');
}

async function loadLatestByCategory(cat) {
    if (latestListEl) latestListEl.innerHTML = '<div class="loading-spinner mini"></div>';

    try {
        // Try backend first if local
        if (window.location.protocol !== 'https:') {
            const data = await tryFetchBackend('latest');
            if (data && data.code === 0 && cat === 'all') {
                renderLatest(data.data);
                return;
            }
        }

        // Serverless Scraping
        const kw = CAT_MAP[cat] || '';
        const url = kw ? `https://www.pansearch.me/search?keyword=${encodeURIComponent(kw)}` : 'https://www.pansearch.me/';
        const html = await fetchWithProxy(url);

        if (html) {
            const items = parsePanSearchHtml(html);
            renderLatest(items.slice(0, 12));
        } else {
            throw new Error("Proxy failed");
        }
    } catch (e) {
        if (latestListEl) latestListEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>加载失败，请重试</p></div>';
    }
}

function renderLatest(items) {
    if (!latestListEl) return;
    if (!items || !items.length) {
        latestListEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>暂无此类资源</p></div>';
        return;
    }
    latestListEl.innerHTML = items.map(item => {
        const dotClass = `dot-${item.driveType}` in { 'dot-quark': 1, 'dot-baidu': 1, 'dot-aliyun': 1, 'dot-uc': 1, 'dot-xunlei': 1, 'dot-mobile': 1, 'dot-telecom': 1, 'dot-pikpak': 1 } ? `dot-${item.driveType}` : 'dot-default';
        return `<div class="latest-item" onclick="doSearch('${escAttr(item.note)}')">
            <span class="type-dot ${dotClass}"></span>
            <span class="latest-item-name">${escHtml(item.note)}</span>
            <span class="latest-item-meta">${item.datetime ? item.datetime.split('T')[0] : ''}</span>
        </div>`;
    }).join('');
}

// ─── SEARCH LOGIC ────────────────────────────────────────────────────────────
async function doSearch(keyword) {
    if (!keyword || isSearching) return;
    isSearching = true;
    keyword = keyword.trim();
    if (searchInput) searchInput.value = keyword;
    if (resultsInput) resultsInput.value = keyword;

    showResults();
    if (resultInfo) resultInfo.textContent = `正在全网聚合搜索 "${keyword}"…`;
    setSearchLoading(true);

    try {
        let data = await tryFetchBackend(keyword);
        if (!data || data.code !== 0) {
            data = await serverlessSearch(keyword);
        }

        if (data && data.code === 0) {
            allResults = data.data || [];
            if (allResults.length === 0) {
                if (resultInfo) resultInfo.textContent = `未发现 "${keyword}" 的有效链接`;
                renderCards([]);
            } else {
                renderCards(allResults);
                if (resultInfo) resultInfo.textContent = `为你搜索到 ${allResults.length} 条资源`;
            }
        }
    } catch (e) {
        toast('请检查网络连接', 'error');
        if (resultInfo) resultInfo.textContent = `由于网络波动，搜索中断`;
        renderCards([]);
    } finally {
        isSearching = false;
        setSearchLoading(false);
    }
}

async function tryFetchBackend(kw) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`${BACKEND_URL}?q=${encodeURIComponent(kw)}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) { return null; }
}

async function serverlessSearch(keyword) {
    try {
        const html = await fetchWithProxy(`https://www.pansearch.me/search?keyword=${encodeURIComponent(keyword)}`);
        if (!html) return null;

        const rawItems = parsePanSearchHtml(html);
        const filtered = rawItems.filter(it =>
            it.note.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(it.note.toLowerCase())
        ).slice(0, 30);

        return { code: 0, data: filtered };
    } catch (e) { return null; }
}

/**
 * Enhanced Scraper: Multi-drive support including Mobile, Telecom, and Foreign drives.
 */
function parsePanSearchHtml(html) {
    const items = [];
    // Expanded patterns for various drives
    const driveRegex = /href="(https:\/\/(pan\.quark\.cn|www\.alipan\.com|www\.aliyundrive\.com|pan\.baidu\.com|pan\.xunlei\.com|drive\.uc\.cn|yun\.139\.com|cloud\.189\.cn|pan\.wo\.cn|115\.com|mypikpak\.com)\/s\/[a-zA-Z0-9_\-]+)"/gi;

    let match;
    const seenUrls = new Set();

    while ((match = driveRegex.exec(html)) !== null) {
        const url = match[1];
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const pos = match.index;
        const lookBack = html.substring(Math.max(0, pos - 600), pos);

        const h5Match = lookBack.match(/<h5[^>]*>(.*?)<\/h5>/i);
        const listMatch = lookBack.match(/(\d+、|【)(.*?)(:|<|\n|】)/i);

        let title = "未知资源";
        if (h5Match) title = h5Match[1];
        else if (listMatch) title = listMatch[2];

        title = title.replace(/<[^>]+>/g, '').trim();

        let driveType = 'other';
        if (url.includes('quark')) driveType = 'quark';
        else if (url.includes('baidu')) driveType = 'baidu';
        else if (url.includes('alipan') || url.includes('aliyundrive')) driveType = 'aliyun';
        else if (url.includes('uc.cn')) driveType = 'uc';
        else if (url.includes('xunlei')) driveType = 'xunlei';
        else if (url.includes('139.com')) driveType = 'mobile';
        else if (url.includes('189.cn')) driveType = 'telecom';
        else if (url.includes('wo.cn')) driveType = 'telecom'; // Unicom treated as telecom for simplicity or shared styles
        else if (url.includes('pikpak')) driveType = 'pikpak';
        else if (url.includes('115.com')) driveType = '115';

        items.push({
            note: title,
            url: url,
            driveType: driveType,
            datetime: new Date().toISOString()
        });
    }
    return items;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function renderCards(list) {
    if (!resultsGrid) return;
    const filtered = activeType === 'all' ? list : list.filter(i => i.driveType === activeType);

    if (!filtered.length) {
        resultsGrid.innerHTML = `<div class="empty-state"><div class="emoji">🌫️</div><p>换个关键词，或者切换网盘分类看看？</p></div>`;
        return;
    }

    resultsGrid.innerHTML = filtered.map((item, idx) => {
        const type = item.driveType || 'other';
        const badgeClass = `badge-${['quark', 'baidu', 'aliyun', 'uc', 'xunlei', 'mobile', 'telecom', 'pikpak'].includes(type) ? type : 'other'}`;
        const onClickAction = (type === 'quark') ? `quarkSave('${escAttr(item.url)}')` : `window.open('${escAttr(item.url)}', '_blank')`;
        return `<div class="card card-clickable" style="animation-delay:${Math.min(idx * 0.03, 0.4)}s" onclick="${onClickAction}">
            <span class="drive-badge ${badgeClass}">${type}</span>
            <div class="card-body">
                <div class="card-name" title="${escAttr(item.note)}">${escHtml(item.note)}</div>
                <div class="card-meta"><span>📅 ${item.datetime ? item.datetime.split('T')[0] : '未知'}</span></div>
            </div>
            <button class="btn-icon" title="复制链接" onclick="event.stopPropagation(); copyUrl('${escAttr(item.url)}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        </div>`;
    }).join('');
}

function showSearch() {
    viewSearch.classList.add('active');
    viewResults.classList.remove('active');
    allResults = [];
}

function showResults() {
    viewSearch.classList.remove('active');
    viewResults.classList.add('active');
    resultsGrid.innerHTML = '';
}

function setSearchLoading(on) {
    if (searchBtn) searchBtn.disabled = on;
    if (resultsSearchBtn) resultsSearchBtn.disabled = on;
    if (on) {
        resultsGrid.innerHTML = `<div class="loading-state">
            <div class="loading-spinner"></div>
            <p>正在聚合搜索最优质的资源，请稍候...</p>
        </div>`;
    }
}

async function quarkSave(url) {
    const m = url.match(/\/s\/([a-zA-Z0-9]+)/);
    if (!m) { window.open(url, '_blank'); return; }
    toast('正在调起夸克客户端…', 'info');
    try {
        const res = await fetch(`http://localhost:9128/desktop_share_visiting?pwd_id=${m[1]}`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) toast('已在夸克 APP 打开', 'success');
        else window.open(url, '_blank');
    } catch { window.open(url, '_blank'); }
}

function copyUrl(url) {
    navigator.clipboard.writeText(url).then(() => toast('链接已复制', 'success')).catch(() => {
        const el = document.createElement('input'); el.value = url; document.body.appendChild(el); el.select(); document.execCommand('copy'); el.remove(); toast('链接已复制', 'success');
    });
}

function toast(msg, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 280); }, 3000);
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escAttr(s) { return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

window.doSearch = doSearch; window.showSearch = showSearch; window.copyUrl = copyUrl;
