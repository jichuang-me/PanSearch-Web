/**
 * PanSearch Web App
 * V4: Enhanced Search & UI Overhaul
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

const DRIVE_NAMES = {
    'quark': '夸克云盘', 'baidu': '百度网盘', 'aliyun': '阿里云盘', 'uc': 'UC网盘',
    'xunlei': '迅雷云盘', 'mobile': '中国移动云盘', 'telecom': '天翼云盘',
    'pikpak': 'PikPak', '115': '115网盘', 'other': '其他资源'
};

// ─── State ────────────────────────────────────────────────────────────────────
let allResults = [];
let activeType = 'all';
let isSearching = false;
let searchMode = 'exact';

// ─── UTILS ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── UI SYNC & RENDER ────────────────────────────────────────────────────────
const UISync = {
    init() {
        this.renderHotTags();
        this.syncFilters();
    },

    renderHotTags() {
        const html = HOT_KEYWORDS.map(k => `<span class="hot-pill" onclick="doSearch('${k}')">${escHtml(k)}</span>`).join('');
        const containers = [$('hot-tags'), $('results-hot')];
        containers.forEach(c => {
            if (c) {
                if (c.id === 'results-hot') c.innerHTML = `<span class="hot-title">🔥 热门：</span><div class="hot-tags">${html}</div>`;
                else c.innerHTML = html;
            }
        });
    },

    syncFilters() {
        const filterHtml = $('main-filter') ? $('main-filter').innerHTML : '';
        const resultsFilter = $('results-filter');
        if (resultsFilter) {
            resultsFilter.innerHTML = filterHtml;
            // Re-bind events for the cloned filters
            resultsFilter.querySelectorAll('.tag').forEach(tag => {
                tag.onclick = () => this.handleFilterClick(tag);
            });
        }
    },

    handleFilterClick(tag) {
        const type = tag.dataset.type;
        document.querySelectorAll('.type-filter .tag').forEach(t => t.classList.toggle('active', t.dataset.type === type));
        activeType = type;
        if (allResults.length) renderCards(allResults);
    }
};

// ─── HISTORY MANAGER V4 ──────────────────────────────────────────────────────
const HistoryManager = {
    key: 'pansearch_history_v4',
    limit: 15,

    get() {
        try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
        catch (e) { return []; }
    },

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
        const dropdown = $('history-dropdown');
        const listEl = $('history-list');
        if (!dropdown || !listEl) return;

        const list = this.get();
        if (!list.length) {
            dropdown.style.display = 'none';
            return;
        }

        listEl.innerHTML = list.map(k => `
            <div class="history-entry" onclick="doSearch('${escAttr(k)}')">
                <span class="icon">🕒</span>
                <span class="text">${escHtml(k)}</span>
                <span class="del-btn" onclick="event.stopPropagation(); HistoryManager.remove('${escAttr(k)}')">✕</span>
            </div>
        `).join('');
    },

    show() { if (this.get().length) $('history-dropdown').style.display = 'block'; },
    hide() { setTimeout(() => { if ($('history-dropdown')) $('history-dropdown').style.display = 'none'; }, 200); }
};

// ─── BOOT ─────────────────────────────────────────────────────────────────────
(function init() {
    bindEvents();
    UISync.init();
    loadDiscovery();
    HistoryManager.render();
})();

function bindEvents() {
    const handleSearch = () => {
        const val = (viewResults.classList.contains('active') ? $('results-input') : $('search-input')).value.trim();
        if (val) doSearch(val);
    };

    // Keyboard Bug Fix: Use 'keyup' and check if input is actually clearable. 
    // The previous implementation might have been intercepting key events too aggressively or focus was lost.
    const inputs = [$('search-input'), $('results-input')];
    inputs.forEach(input => {
        if (!input) return;
        input.onkeydown = e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
            }
        };
        input.onfocus = () => HistoryManager.show();
        input.onblur = () => HistoryManager.hide();
    });

    if ($('search-btn')) $('search-btn').onclick = handleSearch;
    if ($('results-search-btn')) $('results-search-btn').onclick = handleSearch;
    if ($('back-btn')) $('back-btn').onclick = showSearch;
    if ($('clear-all-history')) $('clear-all-history').onclick = (e) => { e.stopPropagation(); HistoryManager.clearAll(); };

    document.querySelectorAll('input[name="search-mode"]').forEach(r => {
        r.onchange = () => { searchMode = r.value; };
    });

    document.querySelectorAll('#main-filter .tag').forEach(tag => {
        tag.onclick = () => UISync.handleFilterClick(tag);
    });
}

// ─── DISCOVERY ───────────────────────────────────────────────────────────────
async function loadDiscovery() {
    DISCOVERY_CATS.forEach(cat => fetchAndRenderCol(cat));
}

async function fetchAndRenderCol(cat) {
    const el = $(`list-${cat.id}`);
    if (!el) return;
    try {
        const html = await fetchWithProxy(`https://www.pansearch.me/search?keyword=${encodeURIComponent(cat.kw)}`);
        if (html) renderColumnList(el, parsePanSearchHtml(html).slice(0, 8));
        else throw new Error();
    } catch (e) {
        el.innerHTML = '<div class="empty-state" style="padding:10px;font-size:0.8rem">暂时无法连接</div>';
    }
}

function renderColumnList(container, items) {
    if (!items || !items.length) {
        container.innerHTML = '<div class="empty-state" style="padding:10px;font-size:0.8rem">暂无资源</div>';
        return;
    }
    container.innerHTML = items.map(item => `
        <div class="latest-item" onclick="doSearch('${escAttr(item.note)}')">
            <span class="type-dot dot-${DRIVE_NAMES[item.driveType] ? item.driveType : 'default'}"></span>
            <span class="latest-item-name" title="${escAttr(item.note)}">${escHtml(item.note)}</span>
            <span class="latest-item-meta">${item.datetime ? item.datetime.split('T')[0].slice(5) : ''}</span>
        </div>`).join('');
}

// ─── SEARCH ENGINE V4 ────────────────────────────────────────────────────────
async function doSearch(keyword) {
    if (!keyword || isSearching) return;
    isSearching = true;
    keyword = keyword.trim();
    $('search-input').value = keyword;
    if ($('results-input')) $('results-input').value = keyword;

    HistoryManager.add(keyword);
    HistoryManager.hide();
    showResults();
    setSearchLoading(true);

    try {
        let results = [];
        // Sequential search or Batch? Fuzzy means more pages.
        if (searchMode === 'fuzzy') {
            results = await fuzzySearch(keyword);
        } else {
            const data = await tryFetchBackend(keyword) || await serverlessSearch(keyword);
            results = data ? data.data : [];
        }

        allResults = results || [];
        renderCards(allResults);
    } catch (e) {
        toast('搜索失败，请刷新重试', 'error');
        renderCards([]);
    } finally {
        isSearching = false;
        setSearchLoading(false);
    }
}

async function fuzzySearch(kw) {
    // Basic fuzzy: split keyword into parts and search, plus fetch multiple pages if possible.
    // For pansearch.me, we can try multiple common keywords or just more parsing.
    const pages = [1, 2];
    let combined = [];
    for (let p of pages) {
        try {
            const html = await fetchWithProxy(`https://www.pansearch.me/search?keyword=${encodeURIComponent(kw)}&page=${p}`);
            if (html) combined = combined.concat(parsePanSearchHtml(html));
        } catch (e) { }
    }
    // Remove duplicates
    const seen = new Set();
    return combined.filter(it => {
        if (seen.has(it.url)) return false;
        seen.add(it.url);
        return true;
    });
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
        else if (url.includes('wo.cn')) driveType = 'telecom';
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
    filtered.forEach(it => {
        const type = it.driveType || 'other';
        (groups[type] = groups[type] || []).push(it);
    });

    const sortedTypes = Object.keys(groups).sort((a, b) => {
        const p = { 'aliyun': 1, 'quark': 2, 'baidu': 3, 'uc': 4, 'xunlei': 5, 'mobile': 6, 'telecom': 7, 'pikpak': 8, '115': 9, 'other': 10 };
        return (p[a] || 99) - (p[b] || 99);
    });

    grid.innerHTML = sortedTypes.map(type => {
        const items = groups[type];
        const visible = items.slice(0, 2);
        const hidden = items.slice(2);
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

function showSearch() { viewSearch.classList.add('active'); viewResults.classList.remove('active'); allResults = []; UISync.syncFilters(); }
function showResults() { viewSearch.classList.remove('active'); viewResults.classList.add('active'); $('results-grid').innerHTML = ''; UISync.syncFilters(); }

function setSearchLoading(on) {
    $('search-btn').disabled = on;
    if ($('results-search-btn')) $('results-search-btn').disabled = on;
    if (on) $('results-grid').innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>正在智能抓取高质量资源...</p></div>`;
}

async function fetchWithProxy(url) {
    try {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_=${Date.now()}`);
        if (res.ok) { const j = await res.json(); return j.contents; }
    } catch (e) { }
    try {
        const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
        return res.ok ? await res.ok.text() : null;
    } catch (e) { }
    return null;
}

function toggleGroup(gid) {
    const h = $(`${gid}-h`), b = $(`${gid}-b`);
    if (h && b) {
        const active = h.classList.toggle('active');
        b.textContent = active ? '收起结果' : `展开其余 (${h.children.length})`;
    }
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

function copyUrl(u) {
    navigator.clipboard.writeText(u).then(() => toast('链接已复制', 'success'));
}

function toast(m, t = 'info') {
    const c = $('toast-container');
    const el = document.createElement('div'); el.className = `toast ${t}`; el.textContent = m;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escAttr(s) { return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

window.doSearch = doSearch; window.HistoryManager = HistoryManager; window.toggleGroup = toggleGroup; window.copyUrl = copyUrl; window.showSearch = showSearch;
