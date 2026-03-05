/**
 * PanSearch Web App
 * V5: Parallel Search & Manual/Hourly Refresh
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const BACKEND_URL = (window.location.protocol === 'file:')
    ? 'http://localhost:8080/api/search'
    : '/api/search';

const DEFAULT_HOT_KEYWORDS = ['三体', '甄嬛传', '黑神话悟空', '权力的游戏', '流浪地球', '编程入门', '考研资料'];

const DISCOVERY_CATS = [
    { id: 'movie', label: '🎬 影视', kw: '影视' },
    { id: 'doc', label: '📚 资料', kw: '资料' },
    { id: 'other', label: '📦 其他', kw: '资源' }
];

const DRIVE_NAMES = {
    'quark': '夸克云盘', 'baidu': '百度网盘', 'aliyun': '阿里云盘', 'uc': 'UC网盘',
    'xunlei': '迅雷云盘', 'mobile': '中国移动云盘', 'telecom': '天翼云盘',
    'pikpak': 'PikPak', '115': '115网盘', 'other': '其他资源'
};

// ─── State ────────────────────────────────────────────────────────────────────
let allResults = [];
let activeType = 'all';
let isSearching = false;
let searchController = null; // For interrupting active searches

// ─── UTILS ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── CACHE MANAGER (Hourly / Manual) ─────────────────────────────────────────
const CacheManager = {
    keys: { discovery: 'ps_discovery_v5', hot: 'ps_hot_v5' },
    expiry: 3600000, // 1 hour

    save(key, data) {
        const payload = { timestamp: Date.now(), data: data };
        localStorage.setItem(this.keys[key], JSON.stringify(payload));
    },

    get(key) {
        const raw = localStorage.getItem(this.keys[key]);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.timestamp < this.expiry) return parsed.data;
        } catch (e) { }
        return null;
    },

    async refreshAll() {
        toast('正在获取全网最新资源...', 'info');
        await Promise.all([loadHotKeywords(true), loadDiscovery(true)]);
        toast('内容已同步', 'success');
    }
};

// ─── UI SYNC & RENDER ────────────────────────────────────────────────────────
const UISync = {
    init() {
        this.renderHotTags(CacheManager.get('hot') || DEFAULT_HOT_KEYWORDS);
    },

    renderHotTags(list) {
        const html = list.map(k => `<span class="hot-pill" onclick="doSearch('${escAttr(k)}', 'fuzzy')">${escHtml(k)}</span>`).join('');
        const hotTagsContainer = $('hot-tags');
        if (hotTagsContainer) {
            hotTagsContainer.innerHTML = html;
        }
    },

    syncFilters() {
        // Obsolete
    },

    handleFilterClick(tag) {
        const type = tag.dataset.type;
        document.querySelectorAll('.type-filter .tag').forEach(t => t.classList.toggle('active', t.dataset.type === type));
        activeType = type;
        if (allResults.length) renderCards(allResults);
    }
};

// ─── HISTORY MANAGER ────────────────────────────────────────────────────────
const HistoryManager = {
    key: 'ps_history_v5',
    limit: 15,
    get() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (e) { return []; } },
    add(kw) {
        if (!kw) return;
        let list = this.get().filter(i => i !== kw);
        list.unshift(kw);
        localStorage.setItem(this.key, JSON.stringify(list.slice(0, this.limit)));
        this.render();
    },
    remove(kw) {
        let list = this.get().filter(i => i !== kw);
        localStorage.setItem(this.key, JSON.stringify(list));
        this.render();
    },
    clearAll() {
        if (confirm('确认清空所有搜索历史吗？')) {
            localStorage.setItem(this.key, '[]');
            this.render();
        }
    },
    render() {
        const dropdown = $('history-dropdown'), listEl = $('history-list');
        if (!dropdown || !listEl) return;
        const list = this.get();
        if (!list.length) { dropdown.style.display = 'none'; return; }
        listEl.innerHTML = list.map(k => `
            <div class="history-tag-item" onclick="doSearch('${escAttr(k)}', 'fuzzy')">
                <span class="text">${escHtml(k)}</span>
                <span class="del-btn" title="删除该记录" onclick="event.stopPropagation(); HistoryManager.remove('${escAttr(k)}')">×</span>
            </div>`).join('') + `
            <button class="history-tag-item clear-all-item" title="清空全部历史记录" onclick="event.stopPropagation(); HistoryManager.clearAll()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>`;
    },
    show() { if (this.get().length) $('history-dropdown').style.display = 'block'; },
    hide() { setTimeout(() => { if ($('history-dropdown')) $('history-dropdown').style.display = 'none'; }, 200); }
};

// ─── BOOT ─────────────────────────────────────────────────────────────────────
(function init() {
    bindEvents();
    UISync.init();
    loadDiscovery();
    loadHotKeywords();
    HistoryManager.render();
})();

function bindEvents() {
    const handleS = () => {
        const val = $('search-input').value.trim();
        if (val) doSearch(val);
    };

    const input = $('search-input');
    if (input) {
        input.onkeydown = e => {
            if (e.key === 'Enter') { e.preventDefault(); handleS(); }
        };
        input.oninput = () => {
            if (!input.value.trim()) {
                const discovery = $('discovery');
                if (discovery) discovery.style.display = 'flex';
                const results = $('results-grid');
                if (results) results.innerHTML = '';
            }
        };
        input.onfocus = () => HistoryManager.show();
        input.onblur = () => HistoryManager.hide();
    }

    if ($('search-btn')) $('search-btn').onclick = () => handleS();
    if ($('refresh-hot')) $('refresh-hot').onclick = () => loadHotKeywords(true);

    document.querySelectorAll('#main-filter .tag').forEach(tag => {
        tag.onclick = () => UISync.handleFilterClick(tag);
    });
}

// ─── CORE LOADERS (Cache-aware) ─────────────────────────────────────────────
async function loadHotKeywords(force = false) {
    let kw = CacheManager.get('hot');
    if (!kw || force) {
        try {
            // Use vvhan API for real-time Baidu Hot Search
            const res = await fetch(`https://api.vvhan.com/api/hotlist/baiduRD`);
            if (res.ok) {
                const json = await res.json();
                if (json.success && json.data) {
                    kw = json.data.slice(0, 10).map(item => item.title);
                    CacheManager.save('hot', kw);
                }
            }
        } catch (e) {
            // Fallback to PanSearch scraping
            try {
                const html = await fetchWithProxy('https://www.pansearch.me/');
                const matches = html.match(/<a[^>]*class="[^"]*hot-item[^"]*"[^>]*>(.*?)<\/a>/g);
                if (matches) {
                    kw = matches.map(m => m.replace(/<[^>]+>/g, '').trim()).slice(0, 10);
                    CacheManager.save('hot', kw);
                }
            } catch (err) { }
        }
    }
    if (kw && kw.length) {
        UISync.renderHotTags(kw);
        const input = $('search-input');
        if (input && !input.value) {
            input.placeholder = `尝试搜搜 "${kw[0]}"...`;
        }
    }
}

async function loadDiscovery(force = false) {
    let cached = CacheManager.get('discovery');
    if (cached && !force) {
        Object.keys(cached).forEach(id => renderColumnList($(`list-${id}`), cached[id]));
        return;
    }
    const data = {};
    for (let cat of DISCOVERY_CATS) {
        try {
            const html = await fetchWithProxy(`https://www.pansearch.me/search?keyword=${encodeURIComponent(cat.kw)}`);
            if (html) data[cat.id] = parsePanSearchHtml(html).slice(0, 8);
        } catch (e) { }
    }
    if (Object.keys(data).length) {
        CacheManager.save('discovery', data);
        Object.keys(data).forEach(id => renderColumnList($(`list-${id}`), data[id]));
    }
}

function renderColumnList(container, items) {
    if (!container) return;
    if (!items || !items.length) { container.innerHTML = '<span class="empty-state" style="font-size:0.8rem">暂无资源</span>'; return; }
    container.innerHTML = items.map(item => `<a href="${escAttr(item.url)}" target="_blank" class="hot-pill" title="${escAttr(item.note)}">${escHtml(item.note)}</a>`).join('');
}

async function loadDiscoverySingle(catId) {
    const cat = DISCOVERY_CATS.find(c => c.id === catId);
    if (!cat) return;
    const el = $(`list-${catId}`);
    if (el) el.innerHTML = '<div class="loading-spinner mini"></div>';
    try {
        const html = await fetchWithProxy(`https://www.pansearch.me/search?keyword=${encodeURIComponent(cat.kw)}`);
        if (html) {
            const items = parsePanSearchHtml(html).slice(0, 8);
            let cached = CacheManager.get('discovery') || {};
            cached[catId] = items;
            CacheManager.save('discovery', cached);
            renderColumnList(el, items);
        }
    } catch (e) {
        if (el) el.innerHTML = '<span class="empty-state" style="font-size:0.8rem">加载失败</span>';
    }
}

// ─── SEARCH ENGINE ────────────────────────────────────────────────────────────
async function doSearch(keyword, mode = 'fuzzy') {
    if (!keyword) return;

    // Interrupt existing search
    if (searchController) {
        searchController.abort();
    }
    searchController = new AbortController();
    const signal = searchController.signal;

    isSearching = true;
    keyword = keyword.trim();
    $('search-input').value = keyword;

    HistoryManager.add(keyword);
    HistoryManager.hide();

    setSearchLoading(true);

    setTimeout(() => {
        const grid = $('results-grid');
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    try {
        let results = [];
        // Sequential fetch with abort logic
        const pages = [1, 2, 3, 4];
        for (let p of pages) {
            if (signal.aborted) return;
            const html = await fetchWithProxy(`https://www.pansearch.me/search?keyword=${encodeURIComponent(keyword)}&page=${p}`);
            if (signal.aborted) return;
            if (html) results = results.concat(parsePanSearchHtml(html));
        }
        // Deduplicate
        results = Array.from(new Set(results.map(a => a.url))).map(url => results.find(a => a.url === url));

        if (signal.aborted) return;
        allResults = results || [];
        renderCards(allResults);
    } catch (e) {
        if (e.name === 'AbortError') return;
        toast('搜索失败，检查网络后重试', 'error');
        renderCards([]);
    } finally {
        if (!signal.aborted) {
            isSearching = false;
            setSearchLoading(false);
            searchController = null;
        }
    }
}

async function tryFetchBackend(kw) {
    try {
        const res = await fetch(`${BACKEND_URL}?q=${encodeURIComponent(kw)}`, { signal: AbortSignal.timeout(1500) });
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
}

async function serverlessSearch(kw) {
    try {
        const html = await fetchWithProxy(`https://www.pansearch.me/search?keyword=${encodeURIComponent(kw)}`);
        return html ? { code: 0, data: parsePanSearchHtml(html) } : null;
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
        const pos = match.index;
        const lookBack = html.substring(Math.max(0, pos - 600), pos);
        const h5Match = lookBack.match(/<h5[^>]*>(.*?)<\/h5>/i);
        const listMatch = lookBack.match(/(\d+、|【)(.*?)(:|<|\n|】)/i);
        let title = (h5Match ? h5Match[1] : (listMatch ? listMatch[2] : "未知资源")).replace(/<[^>]+>/g, '').trim();

        let driveType = 'other';
        if (url.includes('quark')) driveType = 'quark';
        else if (url.includes('baidu')) driveType = 'baidu';
        else if (url.includes('alipan') || url.includes('aliyundrive')) driveType = 'aliyun';
        else if (url.includes('uc.cn')) driveType = 'uc';
        else if (url.includes('xunlei')) driveType = 'xunlei';
        else if (url.includes('139.com')) driveType = 'mobile';
        else if (url.includes('189.cn')) driveType = 'telecom';
        else if (url.includes('pikpak')) driveType = 'pikpak';
        else if (url.includes('115.com')) driveType = '115';

        items.push({ note: title, url: url, driveType: driveType, datetime: new Date().toISOString() });
        seenUrls.add(url);
    }
    return items;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function renderCards(list) {
    const filtered = activeType === 'all' ? list : list.filter(i => i.driveType === activeType);
    const grid = $('results-grid');
    if (!grid) return;
    $('result-info').textContent = filtered.length ? `为你搜索到 ${filtered.length} 条资源` : '未发现有效链接';
    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state"><div class="emoji">🌫️</div><p>换个关键词试试？</p></div>`;
        return;
    }
    const groups = {};
    filtered.forEach(it => { (groups[it.driveType || 'other'] = groups[it.driveType || 'other'] || []).push(it); });
    const sortedTypes = Object.keys(groups).sort((a, b) => {
        const p = { 'aliyun': 1, 'quark': 2, 'baidu': 3, 'uc': 4, 'xunlei': 5, 'mobile': 6, 'telecom': 7, 'pikpak': 8, '115': 9, 'other': 10 };
        return (p[a] || 99) - (p[b] || 99);
    });
    grid.innerHTML = sortedTypes.map(type => {
        const items = groups[type], visible = items.slice(0, 2), hidden = items.slice(2);
        const gid = `g-${type.replace(/[^ac-z0-9]/g, '')}`;
        return `
            <div class="result-group">
                <div class="group-header"><span class="group-title">${escHtml(DRIVE_NAMES[type] || '其他')}</span><div class="group-line"></div></div>
                <div class="group-visible">${visible.map((it, idx) => renderSingleCard(it, idx)).join('')}</div>
                ${hidden.length ? `
                    <div id="${gid}-h" class="hidden-results">${hidden.map((it, idx) => renderSingleCard(it, idx + 2)).join('')}</div>
                    <button class="show-more-btn" onclick="toggleGroup('${gid}')" id="${gid}-b">展开其余 (${hidden.length})</button>
                ` : ''}
            </div>`;
    }).join('');
}

function renderSingleCard(item, idx) {
    const type = item.driveType || 'other';
    const clickAction = (type === 'quark') ? `quarkSave('${escAttr(item.url)}')` : `window.open('${escAttr(item.url)}', '_blank')`;
    return `
        <div class="card card-clickable" style="margin-bottom:10px; animation-delay:${Math.min(idx * 0.03, 0.4)}s" onclick="${clickAction}">
            <span class="drive-badge badge-${['quark', 'baidu', 'aliyun', 'uc', 'xunlei', 'mobile', 'telecom', 'pikpak', '115'].includes(type) ? type : 'other'}">${escHtml(type)}</span>
            <div class="card-body">
                <div class="card-name" title="${escAttr(item.note)}">${escHtml(item.note)}</div>
                <div class="card-meta"><span>📅 ${item.datetime ? item.datetime.split('T')[0] : '未知'}</span></div>
            </div>
            <button class="btn-icon" title="复制" onclick="event.stopPropagation(); copyUrl('${escAttr(item.url)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        </div>`;
}

function showSearch() {
    $('view-search').classList.add('active');
    allResults = [];
}

function showResults() {
    $('results-grid').innerHTML = '';
}

function setSearchLoading(on) {
    if ($('search-btn')) $('search-btn').disabled = on;
    const discovery = $('discovery');
    if (on && discovery) {
        discovery.style.display = 'none';
    }
    if (on) $('results-grid').innerHTML = `<div class="loading-state" style="margin-top:24px"><div class="loading-spinner"></div><p>正在智能抓取全网高质量资源...</p></div>`;
}

async function fetchWithProxy(url) {
    try {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_=${Date.now()}`);
        if (res.ok) { const j = await res.json(); return j.contents; }
    } catch (e) { }
    try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
        return res.ok ? await res.text() : null;
    } catch (e) { }
    return null;
}

function toggleGroup(gid) {
    const h = $(`${gid}-h`), b = $(`${gid}-b`);
    if (h && b) { const active = h.classList.toggle('active'); b.textContent = active ? '收起结果' : `展开其余 (${h.children.length})`; }
}

async function quarkSave(u) {
    const m = u.match(/\/s\/([a-zA-Z0-9]+)/);
    if (!m) { window.open(u, '_blank'); return; }
    toast('尝试唤起桌面客户端...', 'info');
    try {
        const res = await fetch(`http://localhost:9128/desktop_share_visiting?pwd_id=${m[1]}`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) window.open(u, '_blank');
    } catch { window.open(u, '_blank'); }
}

function copyUrl(u) { navigator.clipboard.writeText(u).then(() => toast('链接已复制', 'success')); }
function toast(m, t = 'info') {
    const c = $('toast-container'); const el = document.createElement('div'); el.className = `toast ${t}`; el.textContent = m;
    c.appendChild(el); setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escAttr(s) { return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

window.doSearch = doSearch; window.HistoryManager = HistoryManager; window.toggleGroup = toggleGroup; window.copyUrl = copyUrl; window.CacheManager = CacheManager; window.loadDiscoverySingle = loadDiscoverySingle;
