/**
 * PanSearch Web App
 * Uses PanSou API (via CORS proxy) + Quark local API
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const API_BASE = '/api/search'; // Using the local robust validator proxy
const QUARK_LOCAL = 'http://localhost:9128';

const HOT_KEYWORDS = [
    '三体', '甄嬛传', '黑神话悟空', '权力的游戏', '流浪地球',
    '编程入门', '考研资料', '雅思托福', 'AI教程', '设计素材'
];

// ─── State ────────────────────────────────────────────────────────────────────
let allResults = [];       // full search result list
let activeType = 'all';    // current type filter
let isSearching = false;

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
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

// ─── Boot ─────────────────────────────────────────────────────────────────────
(function init() {
    bindEvents();
    loadDiscovery();
})();

// ─── Events ──────────────────────────────────────────────────────────────────
function bindEvents() {
    // Main search
    searchBtn.onclick = () => doSearch(searchInput.value.trim());
    searchInput.onkeydown = e => {
        if (e.key === 'Enter') doSearch(searchInput.value.trim());
    };

    // Results page search
    resultsSearchBtn.onclick = () => doSearch(resultsInput.value.trim());
    resultsInput.onkeydown = e => {
        if (e.key === 'Enter') doSearch(resultsInput.value.trim());
    };

    // Back button
    backBtn.onclick = showSearch;

    // Type filter tags — both search view + results view
    document.querySelectorAll('.type-filter .tag').forEach(tag => {
        tag.onclick = () => {
            // Deactivate siblings in same .type-filter parent
            tag.closest('.type-filter').querySelectorAll('.tag').forEach(t => t.classList.remove('active'));
            // Also sync other type-filter
            document.querySelectorAll('.type-filter .tag').forEach(t => {
                if (t.dataset.type === tag.dataset.type) t.classList.add('active');
            });
            activeType = tag.dataset.type;
            renderCards(allResults);
        };
    });
}

// ─── Discovery ───────────────────────────────────────────────────────────────
async function loadDiscovery() {
    // Render hot pills immediately
    hotTagsEl.innerHTML = HOT_KEYWORDS.map(k =>
        `<span class="hot-pill" onclick="doSearch('${k}')">${k}</span>`
    ).join('');

    // Fetch latest via empty query
    try {
        const url = `${API_BASE}?q=latest`;
        const res = await fetch(url);
        const data = await res.json();

        if (data && data.code === 0 && data.data) {
            const items = data.data;
            if (items.length) {
                latestListEl.innerHTML = items.map(item => {
                    const dotClass = `dot-${item.driveType}` in {
                        'dot-quark': 1, 'dot-baidu': 1, 'dot-aliyun': 1,
                        'dot-uc': 1, 'dot-115': 1, 'dot-pikpak': 1
                    } ? `dot-${item.driveType}` : 'dot-default';
                    const date = item.datetime ? item.datetime.split('T')[0] : '';
                    return `<div class="latest-item" onclick="doSearch('${escAttr(item.note)}')">
                        <span class="type-dot ${dotClass}"></span>
                        <span class="latest-item-name">${escHtml(item.note)}</span>
                        <span class="latest-item-meta">${date}</span>
                    </div>`;
                }).join('');
                return;
            }
        }
    } catch (e) { /* silent */ }

    // Fallback: show tip
    latestListEl.innerHTML = '<div class="latest-item" style="color:var(--muted);font-size:.8rem">数据加载中…稍后刷新可看到最新资源</div>';
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function doSearch(keyword) {
    if (!keyword) { toast('请输入搜索关键词', 'warn'); return; }
    if (isSearching) return;

    isSearching = true;
    keyword = keyword.trim();

    // Sync input fields
    searchInput.value = keyword;
    resultsInput.value = keyword;

    // Switch to results view, show loading
    showResults();
    resultInfo.textContent = `正在搜索"${keyword}"…`;
    setSearchLoading(true);

    try {
        // Backend handles ALL filtering and link checking now !
        const url = `${API_BASE}?q=${encodeURIComponent(keyword)}&limit=50`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.code === 0) {
            allResults = data.data || [];
            if (allResults.length === 0) {
                toast('未找有效的直接资源，或链接已全部失效', 'warn');
                resultInfo.textContent = `搜不到 "${keyword}" 的有效云盘链接`;
            } else {
                renderCards(allResults);
                resultInfo.textContent = `已为您并行验证并找出了 ${allResults.length} 个"${keyword}"真实有效资源`;
            }
        } else {
            throw new Error(data.msg || 'API error');
        }
    } catch (e) {
        console.error('[PanSearch] search error', e);
        toast('请确保后台终端正运行 node server.js', 'error');
        resultInfo.textContent = `搜索服务连接失败`;
        resultsGrid.innerHTML = `<div class="empty-state">
            <div class="emoji">🚫</div>
            <p>请在终端运行: <code>node server.js</code> 以启动代理验证</p>
        </div>`;
    } finally {
        isSearching = false;
        setSearchLoading(false);
    }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderCards(list) {
    const filtered = activeType === 'all'
        ? list
        : list.filter(i => i.driveType === activeType);

    if (!filtered.length) {
        resultsGrid.innerHTML = `<div class="empty-state">
            <div class="emoji">🌫️</div>
            <p>${activeType === 'all' ? '暂无结果，请换个关键词' : `当前分类(${activeType})无结果，试试"全部"`}</p>
        </div>`;
        return;
    }

    resultsGrid.innerHTML = filtered.map((item, idx) => {
        const type = item.driveType || 'other';
        const badgeClass = `badge-${['quark', 'baidu', 'aliyun', 'uc', '115', 'pikpak'].includes(type) ? type : 'other'}`;
        const date = item.datetime ? item.datetime.split('T')[0] : '未知日期';
        const size = item.size || '未知大小';
        const isQuark = type === 'quark';
        const onClickAction = isQuark
            ? `quarkSave('${escAttr(item.url)}')`
            : `window.open('${escAttr(item.url)}', '_blank')`;

        return `<div class="card card-clickable" style="animation-delay:${Math.min(idx * 0.03, 0.5)}s" onclick="${onClickAction}">
            <span class="drive-badge ${badgeClass}">${type}</span>
            <div class="card-body">
                <div class="card-name" title="${escAttr(item.note)}">${escHtml(item.note)}</div>
                <div class="card-meta">
                    <span>📅 ${date}</span>
                    <span>📦 ${size}</span>
                </div>
            </div>
            <button class="btn-icon tag" title="复制链接" onclick="event.stopPropagation(); copyUrl('${escAttr(item.url)}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
        </div>`;
    }).join('');
}

// ─── View switching ───────────────────────────────────────────────────────────
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
    searchBtn.disabled = on;
    resultsSearchBtn.disabled = on;
    if (on) {
        resultsGrid.innerHTML = Array(6).fill('<div class="card" style="height:160px"><div class="skel-row" style="height:100%;border-radius:10px"></div></div>').join('');
    }
}

// ─── Quark Save ───────────────────────────────────────────────────────────────
async function quarkSave(url) {
    const m = url.match(/\/s\/([a-zA-Z0-9]+)/);
    if (!m) { window.open(url, '_blank'); return; }
    const pwdId = m[1];
    toast('正在调起夸克客户端…', 'info');
    try {
        const res = await fetch(`${QUARK_LOCAL}/desktop_share_visiting?pwd_id=${pwdId}`, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
            toast('已在夸克 APP 打开，请点击「保存」', 'success');
        } else {
            fallbackOpen(url);
        }
    } catch {
        fallbackOpen(url);
    }
}
function fallbackOpen(url) {
    toast('夸克客户端未运行，直接打开链接', 'warn');
    setTimeout(() => window.open(url, '_blank'), 400);
}

// ─── Copy ─────────────────────────────────────────────────────────────────────
function copyUrl(url) {
    navigator.clipboard.writeText(url)
        .then(() => toast('链接已复制', 'success'))
        .catch(() => {
            // fallback
            const el = document.createElement('input');
            el.value = url; document.body.appendChild(el);
            el.select(); document.execCommand('copy');
            el.remove(); toast('链接已复制', 'success');
        });
}

// ─── Mock data (fallback) ─────────────────────────────────────────────────────
function mockData(kw) {
    const types = ['quark', 'baidu', 'aliyun', 'uc'];
    return Array.from({ length: 8 }, (_, i) => ({
        note: `【${kw}】高清完整版 资源合集 #${i + 1}`,
        url: `https://pan.quark.cn/s/mock${i}`,
        driveType: types[i % types.length],
        datetime: new Date(Date.now() - i * 86400000 * 3).toISOString(),
        size: `${(Math.random() * 15 + 1).toFixed(1)} GB`
    }));
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('toast-container').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 280); }, 3200);
}

// ─── Escape helpers ───────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s) {
    return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Expose for inline handlers
window.doSearch = doSearch;
window.quarkSave = quarkSave;
window.copyUrl = copyUrl;
