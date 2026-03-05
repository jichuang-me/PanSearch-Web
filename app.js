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

const DISCOVERY_CATS = [
    { id: 'movie', label: '🎬 影视', kw: '影视' },
    { id: 'doc', label: '📚 资料', kw: '资料' },
    { id: 'other', label: '📦 其他', kw: '资源' }
];

// Drive Name Map for Grouping
const DRIVE_NAMES = {
    'quark': '夸克云盘',
    'baidu': '百度网盘',
    'aliyun': '阿里云盘',
    'uc': 'UC网盘',
    'xunlei': '迅雷云盘',
    'mobile': '中国移动云盘',
    'telecom': '天翼云盘',
    'pikpak': 'PikPak',
    '115': '115网盘',
    'other': '其他资源'
};

// ─── State & History ──────────────────────────────────────────────────────────
let allResults = [];
let activeType = 'all';
let isSearching = false;

const HistoryManager = {
    key: 'pansearch_history',
    limit: 10,
    isExpanded: false,

    get() {
        try {
            return JSON.parse(localStorage.getItem(this.key) || '[]');
        } catch (e) { return []; }
    },

    add(kw) {
        if (!kw) return;
        let list = this.get().filter(i => i !== kw);
        list.unshift(kw);
        localStorage.setItem(this.key, JSON.stringify(list.slice(0, this.limit)));
        this.render();
    },

    toggle() {
        this.isExpanded = !this.isExpanded;
        this.render();
    },

    render() {
        const box = $('history-box');
        const tags = $('history-tags');
        const btn = $('toggle-history');
        if (!box || !tags) return;

        const list = this.get();
        if (!list.length) {
            box.style.display = 'none';
            return;
        }

        box.style.display = 'flex';
        const displayList = this.isExpanded ? list : list.slice(0, 3);
        tags.innerHTML = displayList.map(k => `<span class="hot-pill" onclick="doSearch('${k}')">${escHtml(k)}</span>`).join('');

        if (list.length > 3) {
            btn.style.display = 'inline-block';
            btn.textContent = this.isExpanded ? '收起' : `更多 (${list.length - 3})`;
        } else {
            btn.style.display = 'none';
        }
    }
};

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
    HistoryManager.render();
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

    const toggleHist = $('toggle-history');
    if (toggleHist) toggleHist.onclick = () => HistoryManager.toggle();

    document.querySelectorAll('.type-filter .tag').forEach(tag => {
        tag.onclick = () => {
            const type = tag.dataset.type;
            document.querySelectorAll('.type-filter .tag').forEach(t => t.classList.toggle('active', t.dataset.type === type));
            activeType = type;
            renderCards(allResults);
        };
    });
}

// ─── DISCOVERY (GRID LAYOUT) ────────────────────────────────────────────────
async function loadDiscovery() {
    if (hotTagsEl) {
        hotTagsEl.innerHTML = HOT_KEYWORDS.map(k => `<span class="hot-pill" onclick="doSearch('${k}')">${escHtml(k)}</span>`).join('');
    }
    DISCOVERY_CATS.forEach(cat => fetchAndRenderCol(cat));
}

async function fetchAndRenderCol(cat) {
    const el = $(`list-${cat.id}`);
    if (!el) return;

    try {
        const url = `https://www.pansearch.me/search?keyword=${encodeURIComponent(cat.kw)}`;
        const html = await fetchWithProxy(url);

        if (html) {
            const items = parsePanSearchHtml(html).slice(0, 8);
            renderColumnList(el, items);
        } else {
            throw new Error("Fetch failed");
        }
    } catch (e) {
        el.innerHTML = '<div class="empty-state" style="padding:10px;font-size:0.8rem">暂时无法连接</div>';
    }
}

function renderColumnList(container, items) {
    if (!items || !items.length) {
        container.innerHTML = '<div class="empty-state" style="padding:10px;font-size:0.8rem">暂无资源</div>';
        return;
    }
    container.innerHTML = items.map(item => {
        const driveKey = item.driveType in DRIVE_NAMES ? item.driveType : 'other';
        const dotClass = `dot-${driveKey}`;
        return `<div class="latest-item" onclick="doSearch('${escAttr(item.note)}')">
            <span class="type-dot ${dotClass}"></span>
            <span class="latest-item-name" title="${escAttr(item.note)}">${escHtml(item.note)}</span>
            <span class="latest-item-meta">${item.datetime ? item.datetime.split('T')[0].slice(5) : ''}</span>
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

    HistoryManager.add(keyword);
    showResults();
    if (resultInfo) resultInfo.textContent = `正在聚合 "${keyword}" 的极速资源…`;
    setSearchLoading(true);

    try {
        let data = await tryFetchBackend(keyword);
        if (!data || data.code !== 0) {
            data = await serverlessSearch(keyword);
        }

        if (data && data.code === 0) {
            allResults = data.data || [];
            renderCards(allResults);
        }
    } catch (e) {
        toast('聚合搜索失败，请尝试刷新页面', 'error');
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
        const url = `https://www.pansearch.me/search?keyword=${encodeURIComponent(keyword)}`;
        const html = await fetchWithProxy(url);
        if (!html) return null;
        const rawItems = parsePanSearchHtml(html);
        return { code: 0, data: rawItems };
    } catch (e) { return null; }
}

function parsePanSearchHtml(html) {
    const items = [];
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
        else if (url.includes('wo.cn')) driveType = 'telecom';
        else if (url.includes('pikpak')) driveType = 'pikpak';
        else if (url.includes('115.com')) driveType = '115';
        items.push({ note: title, url: url, driveType: driveType, datetime: new Date().toISOString() });
    }
    return items;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function renderCards(list) {
    if (!resultsGrid) return;
    const filtered = activeType === 'all' ? list : list.filter(i => i.driveType === activeType);

    if (resultInfo) resultInfo.textContent = filtered.length ? `为你搜索到 ${filtered.length} 条资源` : '未发现有效链接';
    if (!filtered.length) {
        resultsGrid.innerHTML = `<div class="empty-state"><div class="emoji">🌫️</div><p>换个关键词试试？</p></div>`;
        return;
    }

    const groups = {};
    filtered.forEach(item => {
        const type = item.driveType || 'other';
        if (!groups[type]) groups[type] = [];
        groups[type].push(item);
    });

    const sortedTypes = Object.keys(groups).sort((a, b) => {
        const priority = { 'aliyun': 1, 'quark': 2, 'baidu': 3, 'uc': 4, 'xunlei': 5, 'mobile': 6, 'telecom': 7, 'pikpak': 8, '115': 9, 'other': 10 };
        return (priority[a] || 99) - (priority[b] || 99);
    });

    resultsGrid.innerHTML = sortedTypes.map(type => {
        const items = groups[type];
        const driveName = DRIVE_NAMES[type] || '其他网盘';
        const visibleItems = items.slice(0, 2);
        const hiddenItems = items.slice(2);
        const groupId = `group-${type.replace(/[^a-z0-9]/g, '')}`;

        return `
            <div class="result-group">
                <div class="group-header">
                    <span class="group-title">${escHtml(driveName)}</span>
                    <div class="group-line"></div>
                </div>
                <div class="group-visible">
                    ${visibleItems.map((it, idx) => renderSingleCard(it, idx)).join('')}
                </div>
                ${hiddenItems.length > 0 ? `
                    <div id="${groupId}-hidden" class="hidden-results">
                        ${hiddenItems.map((it, idx) => renderSingleCard(it, idx + 2)).join('')}
                    </div>
                    <button class="show-more-btn" onclick="toggleGroup('${groupId}')" id="${groupId}-btn">
                        展开其余 (${hiddenItems.length})
                    </button>
                ` : ''}
            </div>
        `;
    }).join('');
}

function renderSingleCard(item, idx) {
    const type = item.driveType || 'other';
    const badgeClass = `badge-${['quark', 'baidu', 'aliyun', 'uc', 'xunlei', 'mobile', 'telecom', 'pikpak', '115'].includes(type) ? type : 'other'}`;
    const onClickAction = (type === 'quark') ? `quarkSave('${escAttr(item.url)}')` : `window.open('${escAttr(item.url)}', '_blank')`;
    return `
        <div class="card card-clickable" style="margin-bottom:10px; animation-delay:${Math.min(idx * 0.03, 0.4)}s" onclick="${onClickAction}">
            <span class="drive-badge ${badgeClass}">${escHtml(type)}</span>
            <div class="card-body">
                <div class="card-name" title="${escAttr(item.note)}">${escHtml(item.note)}</div>
                <div class="card-meta"><span>📅 ${item.datetime ? item.datetime.split('T')[0] : '未知'}</span></div>
            </div>
            <button class="btn-icon" title="复制链接" onclick="event.stopPropagation(); copyUrl('${escAttr(item.url)}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        </div>`;
}

function toggleGroup(groupId) {
    const hidden = $(`${groupId}-hidden`);
    const btn = $(`${groupId}-btn`);
    if (hidden && btn) {
        const isActive = hidden.classList.toggle('active');
        btn.textContent = isActive ? '收起结果' : `展开其余 (${hidden.children.length})`;
    }
}

function showSearch() {
    viewSearch.classList.add('active');
    viewResults.classList.remove('active');
    allResults = [];
    HistoryManager.render();
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
            <p>正在拼命聚合全网资源，请稍候...</p>
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

window.doSearch = doSearch; window.showSearch = showSearch; window.copyUrl = copyUrl; window.toggleGroup = toggleGroup;
