/**
 * PanSearch Web App
 * Hybrid Mode: Local Server (Fast) + Serverless (GitHub Pages Friendly)
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const BACKEND_URL = (window.location.protocol === 'file:')
    ? 'http://localhost:8080/api/search'
    : '/api/search';

const PROXIES = [
    'https://api.allorigins.win/get?url=',
    'https://cors-anywhere.azm.workers.dev/'
];

const HOT_KEYWORDS = [
    '三体', '甄嬛传', '黑神话悟空', '权力的游戏', '流浪地球',
    '编程入门', '考研资料', '雅思托福', 'AI教程', '设计素材'
];

// ─── State ────────────────────────────────────────────────────────────────────
let allResults = [];
let activeType = 'all';
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
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_=${Date.now()}`;
        const res = await fetch(proxyUrl);
        const json = await res.json();
        return json.contents;
    } catch (e) {
        try {
            const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
            return await res.text();
        } catch (e2) {
            return null;
        }
    }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
(function init() {
    if (!viewSearch) return;
    bindEvents();
    loadDiscovery();
})();

function bindEvents() {
    if (searchBtn) searchBtn.onclick = () => doSearch(searchInput.value.trim());
    if (searchInput) searchInput.onkeydown = e => e.key === 'Enter' && doSearch(searchInput.value.trim());
    if (resultsSearchBtn) resultsSearchBtn.onclick = () => doSearch(resultsInput.value.trim());
    if (resultsInput) resultsInput.onkeydown = e => e.key === 'Enter' && doSearch(resultsInput.value.trim());
    if (backBtn) backBtn.onclick = showSearch;

    document.querySelectorAll('.type-filter .tag').forEach(tag => {
        tag.onclick = () => {
            const type = tag.dataset.type;
            document.querySelectorAll('.type-filter').forEach(container => {
                container.querySelectorAll('.tag').forEach(t => {
                    t.classList.toggle('active', t.dataset.type === type);
                });
            });
            activeType = type;
            renderCards(allResults);
        };
    });
}

// ─── DISCOVERY (HOT + LATEST) ───────────────────────────────────────────────
async function loadDiscovery() {
    if (hotTagsEl) {
        hotTagsEl.innerHTML = HOT_KEYWORDS.map(k => `<span class="hot-pill" onclick="doSearch('${k}')">${k}</span>`).join('');
    }

    try {
        // 1. Try backend
        let data = await tryFetchBackend('latest');

        // 2. Try serverless if backend fails
        if (!data || data.code !== 0) {
            console.log("[Discovery] Backend failed, switching to Serverless mode...");
            data = await serverlessDiscovery();
        }

        if (data && data.code === 0) {
            renderLatest(data.data);
        } else {
            if (latestListEl) latestListEl.innerHTML = '<div class="latest-item" style="color:var(--muted);font-size:.8rem">欢迎使用！输入关键词开始搜索</div>';
        }
    } catch (e) {
        if (latestListEl) latestListEl.innerHTML = '<div class="latest-item" style="color:var(--muted);font-size:.8rem">初始化完成，准备就绪</div>';
    }
}

async function serverlessDiscovery() {
    try {
        const html = await fetchWithProxy('https://www.pansearch.me/');
        if (!html) return null;

        const items = [];
        const regex = /<div class="card-body">([\s\S]*?)<\/div>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const content = match[1];
            const noteMatch = content.match(/<h5[^>]*>(.*?)<\/h5>/i) || content.match(/1、(.*?):/i);
            const urlMatch = content.match(/href="(https:\/\/(pan\.quark\.cn|www\.alipan\.com|pan\.baidu\.com|pan\.xunlei\.com|drive\.uc\.cn)\/s\/[a-zA-Z0-9_\-]+)"/i);

            if (urlMatch) {
                const url = urlMatch[1];
                let driveType = 'other';
                if (url.includes('quark')) driveType = 'quark';
                else if (url.includes('baidu')) driveType = 'baidu';
                else if (url.includes('alipan') || url.includes('aliyundrive')) driveType = 'aliyun';
                else if (url.includes('uc.cn')) driveType = 'uc';

                items.push({
                    note: noteMatch ? noteMatch[1].replace(/<[^>]+>/g, '').trim() : "未知资源",
                    url: url,
                    driveType: driveType,
                    datetime: new Date().toISOString()
                });
            }
        }
        return { code: 0, data: items.slice(0, 10) };
    } catch (e) {
        return null;
    }
}

function renderLatest(items) {
    if (!items || !items.length || !latestListEl) return;
    latestListEl.innerHTML = items.map(item => {
        const dotClass = `dot-${item.driveType}` in { 'dot-quark': 1, 'dot-baidu': 1, 'dot-aliyun': 1, 'dot-uc': 1, 'dot-115': 1, 'dot-pikpak': 1 } ? `dot-${item.driveType}` : 'dot-default';
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
    if (resultInfo) resultInfo.textContent = `正在全网搜索并验证 "${keyword}"…`;
    setSearchLoading(true);

    try {
        // 1. First, try local/deployed backend (Fastest)
        let data = await tryFetchBackend(keyword);

        // 2. If backend fails (e.g. GitHub Pages), fallback to Serverless Client-side mode
        if (!data || data.code !== 0) {
            console.log("[Search] Backend failed, switching to Serverless mode...");
            data = await serverlessSearch(keyword);
        }

        if (data && data.code === 0) {
            allResults = data.data || [];
            if (allResults.length === 0) {
                if (resultInfo) resultInfo.textContent = `搜不到 "${keyword}" 的有效云盘链接`;
            } else {
                renderCards(allResults);
                if (resultInfo) resultInfo.textContent = `搜索结果 (${allResults.length})`;
            }
        } else {
            throw new Error("Search failed");
        }
    } catch (e) {
        toast('请刷新页面重试', 'error');
        if (resultInfo) resultInfo.textContent = `搜索服务暂时不可用`;
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

        const items = [];
        const regex = /<div class="card-body">([\s\S]*?)<\/div>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const content = match[1];
            const noteMatch = content.match(/<h5[^>]*>(.*?)<\/h5>/i) || content.match(/1、(.*?):/i);
            const urlMatch = content.match(/href="(https:\/\/(pan\.quark\.cn|www\.alipan\.com|pan\.baidu\.com|pan\.xunlei\.com|drive\.uc\.cn)\/s\/[a-zA-Z0-9_\-]+)"/i);

            if (urlMatch) {
                const url = urlMatch[1];
                let driveType = 'other';
                if (url.includes('quark')) driveType = 'quark';
                else if (url.includes('baidu')) driveType = 'baidu';
                else if (url.includes('alipan') || url.includes('aliyundrive')) driveType = 'aliyun';
                else if (url.includes('uc.cn')) driveType = 'uc';

                items.push({
                    note: noteMatch ? noteMatch[1].replace(/<[^>]+>/g, '').trim() : "未知资源",
                    url: url,
                    driveType: driveType,
                    datetime: new Date().toISOString()
                });
            }
        }

        const filtered = items.filter(it => it.note.toLowerCase().includes(keyword.toLowerCase())).slice(0, 15);
        return { code: 0, data: filtered };
    } catch (e) {
        console.error("[Search] Serverless error", e);
        return null;
    }
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function renderCards(list) {
    if (!resultsGrid) return;
    const filtered = activeType === 'all' ? list : list.filter(i => i.driveType === activeType);
    if (!filtered.length) {
        resultsGrid.innerHTML = `<div class="empty-state"><div class="emoji">🌫️</div><p>暂无结果</p></div>`;
        return;
    }
    resultsGrid.innerHTML = filtered.map((item, idx) => {
        const type = item.driveType || 'other';
        const badgeClass = `badge-${['quark', 'baidu', 'aliyun', 'uc', '115', 'pikpak'].includes(type) ? type : 'other'}`;
        const onClickAction = (type === 'quark') ? `quarkSave('${escAttr(item.url)}')` : `window.open('${escAttr(item.url)}', '_blank')`;
        return `<div class="card card-clickable" style="animation-delay:${Math.min(idx * 0.03, 0.5)}s" onclick="${onClickAction}">
            <span class="drive-badge ${badgeClass}">${type}</span>
            <div class="card-body">
                <div class="card-name" title="${escAttr(item.note)}">${escHtml(item.note)}</div>
                <div class="card-meta"><span>📅 ${item.datetime ? item.datetime.split('T')[0] : '未知'}</span></div>
            </div>
            <button class="btn-icon tag" title="复制链接" onclick="event.stopPropagation(); copyUrl('${escAttr(item.url)}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        </div>`;
    }).join('');
}

function showSearch() {
    if (viewSearch) viewSearch.classList.add('active');
    if (viewResults) viewResults.classList.remove('active');
    allResults = [];
}
function showResults() {
    if (viewSearch) viewSearch.classList.remove('active');
    if (viewResults) viewResults.classList.add('active');
    if (resultsGrid) resultsGrid.innerHTML = '';
}
function setSearchLoading(on) {
    if (searchBtn) searchBtn.disabled = on;
    if (resultsSearchBtn) resultsSearchBtn.disabled = on;
    if (on && resultsGrid) resultsGrid.innerHTML = Array(6).fill('<div class="card" style="height:120px"><div class="skel-row" style="height:100%;border-radius:10px"></div></div>').join('');
}

async function quarkSave(url) {
    const m = url.match(/\/s\/([a-zA-Z0-9]+)/);
    if (!m) { window.open(url, '_blank'); return; }
    toast('正在调起夸克客户端…', 'info');
    try {
        const res = await fetch(`http://localhost:9128/desktop_share_visiting?pwd_id=${m[1]}`, { signal: AbortSignal.timeout(3000) });
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

window.doSearch = doSearch; window.quarkSave = quarkSave; window.copyUrl = copyUrl;
