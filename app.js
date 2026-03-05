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

const DRIVE_DOMAINS = ['quark.cn', 'pan.baidu.com', 'alipan.com', 'aliyundrive.com', 'drive.uc.cn', 'pan.xunlei.com', 'yun.139.com', 'cloud.189.cn', 'mypikpak.com', '115.com'];

// Simple Alias & Pinyin Mapping for fuzzier broad search
const KEYWORD_ALIASES = {
    '黑神话悟空': ['heishenhua', 'wukong', '黑马', 'blackmyth', 'black myth'],
    '三体': ['santi', '3body', 'three body'],
    '甄嬛传': ['zhenhuan', 'zhz'],
    '权力的游戏': ['got', 'game of thrones', '权游'],
    '流浪地球': ['diqiu', 'wandering earth'],
};

// ─── State ────────────────────────────────────────────────────────────────────
let allResults = [];
let activeType = 'all';
let isSearching = false;
let searchController = null; // For interrupting active searches
let GroupCache = {}; // Cache for hidden results

// ─── UTILS ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function normalizeTitle(s) {
    if (!s) return "";
    return s.replace(/[【】\[\]\s\-\.\(\)]/g, "").toLowerCase().trim();
}

function mapType(url) {
    if (!url) return 'other';
    const u = url.toLowerCase();
    if (u.includes('quark.cn')) return 'quark';
    if (u.includes('pan.baidu.com')) return 'baidu';
    if (u.includes('alipan.com') || u.includes('aliyundrive.com')) return 'aliyun';
    if (u.includes('uc.cn')) return 'uc';
    if (u.includes('xunlei.com')) return 'xunlei';
    if (u.includes('139.com')) return 'mobile';
    if (u.includes('189.cn')) return 'telecom';
    if (u.includes('pikpak') || u.includes('mypikpak')) return 'pikpak';
    if (u.includes('115.com')) return '115';
    return 'other';
}

function classifyResource(item) {
    const title = (item.note || item.title || "").toLowerCase();
    const cat = (item.category_name || item.category || "").toLowerCase();

    // 1. 资料/学习
    if (/pdf|epub|mobi|azw3|doc|docx|ppt|xls|教程|学习|备考|考试|资料|讲义|电子书|课程|源码|代码/.test(title + cat)) return "资料";
    // 2. 体育
    if (/足球|篮球|nba|cba|中超|欧冠|英超|赛程|录像|锦标赛|奥运|体育/.test(title + cat)) return "体育";
    // 3. 综艺
    if (/综艺|真人秀|脱口秀|晚会|盛典|娱乐版|更新至.*期|期|202\d\d\d\d\d/.test(title + cat)) return "综艺";
    // 4. 音乐
    if (/mp3|flac|ape|wav|音乐|专辑|歌曲|歌单|演唱会/.test(title + cat)) return "音乐";
    // 5. 电视剧
    if (/电视剧|剧集|更新至|全集|第.*集|s\d+e\d+|season|ep\d+|集/.test(title + cat)) return "电视剧";
    // 6. 电影
    if (/电影|蓝光|1080p|2160p|4k|bdrip|web-dl|h26[45]|x26[45]|idx|sub|国语|中英|字幕/.test(title + cat)) return "电影";

    if (cat.includes('综合') || cat.includes('其他')) return "综合";
    return "其他";
}

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
        await loadDiscovery('all', true);
        toast('内容已同步', 'success');
    }
};

// ─── UI SYNC & RENDER ────────────────────────────────────────────────────────
const UISync = {
    init() {
        // V26: Auto-load "All" discovery feed into main results grid on startup
        loadDiscovery('all');
    },

    renderHotTags(list) {
        // Obsolete: Hot tags removed from landing page
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

// ─── SUGGESTION MANAGER ───────────────────────────────────────────────────────
const SuggestionManager = {
    timer: null,
    fetch(kw) {
        clearTimeout(this.timer);
        if (!kw.trim()) {
            this.hide();
            return;
        }
        this.timer = setTimeout(() => {
            const script = document.createElement('script');
            window.__bdCb = (data) => {
                this.render(data.s || []); // Baidu SUG returns array in data.s
                script.remove();
            };
            script.src = `https://sp0.baidu.com/5a1Fazu8AA54nxGko9WTAnF6hhy/su?wd=${encodeURIComponent(kw)}&cb=window.__bdCb`;
            document.body.appendChild(script);
        }, 300); // 300ms debounce
    },
    render(list) {
        const dropdown = $('suggestion-dropdown'), listEl = $('suggestion-list');
        if (!dropdown || !listEl) return;

        // Filter out irrelevant search suggestions (questions, online watching, etc.) to keep it resource-focused
        const badPatterns = /(是什么|怎么|哪里|为什么|在线看|在线观看|的拼音|的意思|读音)/;
        const filteredList = list.filter(k => !badPatterns.test(k)).slice(0, 8);

        if (!filteredList.length) { dropdown.style.display = 'none'; return; }

        listEl.innerHTML = filteredList.map(k => `
            <div class="suggestion-item" onclick="doSearch('${escAttr(k)}')">
                <svg class="suggestion-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span class="text">${escHtml(k)}</span>
            </div>`).join('');
        dropdown.style.display = 'block';
    },
    hide() {
        setTimeout(() => { if ($('suggestion-dropdown')) $('suggestion-dropdown').style.display = 'none'; }, 200);
    }
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
        const mode = $('precise-check')?.checked ? 'precise' : 'fuzzy';
        if (val) doSearch(val, mode);
    };

    const input = $('search-input');
    if (input) {
        input.onkeydown = e => {
            if (e.key === 'Enter') { e.preventDefault(); handleS(); }
        };
        input.oninput = () => {
            const val = input.value.trim();
            if (!val) {
                const discovery = $('discovery-area');
                if (discovery) discovery.style.display = 'flex';
                const header = $('hero-header');
                if (header) header.classList.remove('collapsed');
                const results = $('results-grid');
                if (results) results.innerHTML = '';
                SuggestionManager.hide();
                HistoryManager.show();
            } else {
                HistoryManager.hide();
                SuggestionManager.fetch(val);
            }
        };
        input.onfocus = () => {
            const val = input.value.trim();
            if (!val) HistoryManager.show();
            else SuggestionManager.fetch(val);
        };
        input.onblur = () => {
            HistoryManager.hide();
            SuggestionManager.hide();
        };
    }

    if ($('search-btn')) $('search-btn').onclick = () => handleS();

    const preciseCheck = $('precise-check');
    if (preciseCheck) {
        preciseCheck.onchange = () => {
            if (allResults.length) {
                renderCards(allResults);
                const bar = $('search-bar');
                if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };
    }

    document.querySelectorAll('#main-filter .tag').forEach(tag => {
        tag.onclick = () => {
            const val = $('search-input').value.trim();
            document.querySelectorAll('#main-filter .tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            activeType = tag.getAttribute('data-type');

            if (!val) {
                loadLatestFeed(activeType);
            } else {
                renderCards(allResults);
            }
        };
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
            input.placeholder = `🔥 正在热搜："${kw[0]}"`;
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
            renderColumnList(el, items);
            let cached = CacheManager.get('discovery') || {};
            cached[catId] = items;
            CacheManager.save('discovery', cached);
            toast('已更新最新资源', 'success');
        }
    } catch (e) {
        if (el) el.innerHTML = '<span class="empty-state" style="font-size:0.8rem">加载失败</span>';
    }
}

async function loadLatestFeed(type = 'all') {
    const grid = $('results-grid');
    if (!grid) return;

    grid.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>正在为您获取并聚合最新云盘资源...</p></div>';
    $('hero-header').classList.add('collapsed');
    const discovery = $('discovery-area');
    if (discovery) discovery.style.display = 'none';

    try {
        // V25: Parallel fetch for a much deeper discovery pool (Pages 1-10)
        const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const fetchPromises = pages.map(p => fetchWithProxy(`https://s.panhunt.com/api/search?q=&page=${p}&limit=50&sort=new`));
        const responses = await Promise.all(fetchPromises);

        let records = [];
        responses.forEach(res => {
            if (res && res.data) {
                if (res.data.merged_by_type) {
                    Object.values(res.data.merged_by_type).forEach(list => records = records.concat(list));
                } else if (Array.isArray(res.data)) {
                    records = records.concat(res.data);
                }
            }
        });

        let feed = records.map(item => {
            const title = (item.note || item.title || item.note_ext || "").trim();
            return {
                ...item,
                note: title || "最新云盘资源",
                driveType: mapType(item.url)
            };
        });

        if (type !== 'all') {
            feed = feed.filter(it => it.driveType === type);
        }

        feed.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));

        allResults = feed;
        renderCards(allResults);

        if (feed.length === 0) {
            grid.innerHTML = `<div class="empty-state"><p>暂时没有最新资源更新。</p></div>`;
        }
    } catch (e) {
        console.error('Feed load error:', e);
        if (grid) grid.innerHTML = '<div class="empty-state"><p>暂时无法加载推荐流，请尝试直接搜索。</p></div>';
    }
}

async function loadDiscoverySingle(type) {
    // Obsolete: Single category rows removed
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
        const bar = $('search-bar');
        if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);

    try {
        // V16: Multi-source parallel search (PanHunt + PanSearch + Backend)
        const pages = Array.from({ length: 6 }, (_, i) => i + 1);
        const fetchPromises = pages.map(p =>
            fetchWithProxy(`https://s.panhunt.com/api/search?q=${encodeURIComponent(keyword)}&page=${p}&limit=20`)
        );

        fetchPromises.push(tryFetchBackend(keyword));
        fetchPromises.push(serverlessSearch(keyword));

        const responses = await Promise.all(fetchPromises);
        if (signal.aborted) return;

        let allRecords = [];
        responses.forEach(resp => {
            if (!resp) return;
            try {
                // Handle both raw strings (from AllOrigins) and parsed objects
                const json = typeof resp === 'string' ? JSON.parse(resp) : resp;
                if (json && json.code === 0 && json.data) {
                    if (json.data.merged_by_type) {
                        const typedData = json.data.merged_by_type;
                        Object.keys(typedData).forEach(t => {
                            allRecords = allRecords.concat(typedData[t].map(item => ({ ...item, driveType: t })));
                        });
                    } else if (Array.isArray(json.data)) {
                        allRecords = allRecords.concat(json.data);
                    }
                } else if (Array.isArray(json)) {
                    allRecords = allRecords.concat(json);
                }
            } catch (e) {
                // Fallback to HTML parsing if JSON fails
                if (typeof resp === 'string') allRecords = allRecords.concat(parsePanSearchHtml(resp));
            }
        });

        // --- V20: Advanced Search Matching & Scoring Protocol ---
        const uniqueResults = [];
        const seenUrls = new Set();
        const kwLower = keyword.toLowerCase();
        const kws = kwLower.split(/\s+/).filter(Boolean);
        const aliases = KEYWORD_ALIASES[keyword] || [];

        // Pre-compute query characteristics
        const queryHasEnglish = /[a-z]/.test(kwLower);

        allRecords.forEach(item => {
            // Layer 1: Hard Filter (Deduplication & Valid Drive Link Only)
            if (!item.url || seenUrls.has(item.url)) return;
            const isDriveLink = DRIVE_DOMAINS.some(domain => item.url.includes(domain));
            if (!isDriveLink) return;

            const note = (item.title || item.note || '').toLowerCase();
            const isGeneric = note === "未知资源" || note === "";

            // Layer 2: Query Expansion Checks
            const matchesAll = kws.length > 0 && kws.every(k => note.includes(k));
            const matchesAny = kws.some(k => note.includes(k)) || kwLower.includes(note) || note.includes(kwLower);
            const matchesAlias = aliases.some(a => note.includes(a));

            // --- Scoring & Filtering Protocol ---
            let score = 0;
            const isPrecise = mode === 'precise';

            // Standard Fuzzy Rule: Enforce overlap for search keywords
            if (!matchesAny && !matchesAlias && !isGeneric) return;

            if (isGeneric) {
                if (isPrecise) return;
                score = -80;
            } else {
                // Standard Scoring Protocol
                if (note === kwLower) score += 500; // Perfect
                else if (note.startsWith(kwLower)) score += 300; // Sequence start
                else if (note.includes(kwLower)) score += 200; // Sequence contains
                else if (matchesAll) score += 150; // All parts present
                else if (matchesAny) score += 50; // Partial parts

                if (matchesAlias) score += 80;

                // Title Density Boost (Shorter titles with match rank higher)
                const density = kwLower.length / Math.max(1, note.length);
                score += Math.round(density * 100);

                // Precise Mode Termination
                if (isPrecise && !note.includes(kwLower) && !matchesAll) return;
            }

            // Language Consistency
            const resultHasEnglish = /[a-z]/.test(note);
            if (queryHasEnglish && !resultHasEnglish && !matchesAny) {
                if (isPrecise) return;
                score -= 300;
            }

            // Quality/Metadata Boosting
            if (note.includes('4k') || note.includes('2160p')) score += 40;
            if (note.includes('1080p') || note.includes('1080')) score += 20;
            if (note.includes('全集') || note.includes('合集') || note.includes('完整版')) score += 30;
            if (note.includes('蓝光') || note.includes('bd')) score += 20;

            // Preferred Platform Boosting
            if (item.driveType === 'quark') score += 25;
            if (item.driveType === 'aliyun') score += 20;

            // Recency Weighting
            if (item.datetime) {
                const ageDays = (Date.now() - new Date(item.datetime).getTime()) / (1000 * 3600 * 24);
                if (ageDays <= 3) score += 30;
                else if (ageDays <= 30) score += 10;
                else if (ageDays > 365) score -= 10;
            }

            // Save and Push
            item.score = score;
            uniqueResults.push(item);
            seenUrls.add(item.url);
        });

        // V15: Sort: Highest Score first, then newest datetime
        uniqueResults.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(b.datetime || 0) - new Date(a.datetime || 0);
        });

        if (signal.aborted) return;
        allResults = uniqueResults;
        renderCards(allResults);
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error('Search engine error:', e);
        toast(`搜索出现错误: ${e.message}`, 'error');
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
        const res = await fetch(`${BACKEND_URL}?q=${encodeURIComponent(kw)}`, { signal: AbortSignal.timeout(5000) });
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
        const textPre = lookBack.substring(lookBack.lastIndexOf('>') + 1).trim();
        let title = (h5Match ? h5Match[1] : (listMatch ? listMatch[2] : (textPre || "未知资源"))).replace(/<[^>]+>/g, '').trim();
        if (title.length < 2) title = "网盘资源";

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
    const isPrecise = $('precise-check')?.checked || false;
    const kw = $('search-input').value.trim().toLowerCase();

    // UI Filter + Strict Matching Filter
    let filtered = activeType === 'all' ? list : list.filter(i => i.driveType === activeType);

    if (isPrecise && kw) {
        const kws = kw.split(/\s+/).filter(Boolean);
        filtered = filtered.filter(item => {
            const note = (item.title || item.note || '').toLowerCase();
            return note.includes(kw) || (kws.length > 0 && kws.every(k => note.includes(k)));
        });
    }

    const grid = $('results-grid');
    if (!grid) return;

    // --- Step 1: Nested Aggregation Logic ---
    const aggregated = [];
    const aggMap = new Map(); // key: normalizeTitle + driveType

    filtered.forEach(item => {
        const norm = normalizeTitle(item.note);
        const key = `${norm}|${item.driveType}`;
        if (!aggMap.has(key)) {
            const group = { ...item, members: [item] };
            aggMap.set(key, group);
            aggregated.push(group);
        } else {
            const group = aggMap.get(key);
            group.members.push(item);
            // Ensure primary title is the best version
            if (item.note.length > group.note.length) group.note = item.note;
        }
    });

    // Calculate Stats based on aggregated list
    const totalCount = aggregated.length;
    const driveCounts = { 'all': aggregated.length };
    aggregated.forEach(it => {
        const t = it.driveType || 'other';
        driveCounts[t] = (driveCounts[t] || 0) + 1;
    });

    // Update Filter Tags with Counts
    document.querySelectorAll('#main-filter .tag').forEach(tag => {
        const type = tag.dataset.type;
        const baseName = DRIVE_NAMES[type] || (type === 'all' ? '全部' : '其他');
        const count = driveCounts[type] || 0;
        tag.innerHTML = `${baseName} <span class="tag-count">${count}</span>`;
    });

    const infoEl = $('result-info');
    if (infoEl) infoEl.textContent = totalCount ? `为你展示 ${totalCount} 条聚合资源` : '未发现匹配资源';

    if (!totalCount) {
        grid.innerHTML = `<div class="empty-state"><div class="emoji">🌫️</div><p>${isPrecise ? '精确模式下未匹配到结果，可尝试关闭精确筛选' : '换个关键词试试？'}</p></div>`;
        return;
    }
    const groups = {};
    aggregated.forEach(it => { (groups[it.driveType || 'other'] = groups[it.driveType || 'other'] || []).push(it); });
    const sortedTypes = Object.keys(groups).sort((a, b) => {
        const p = { 'aliyun': 1, 'quark': 2, 'baidu': 3, 'uc': 4, 'xunlei': 5, 'mobile': 6, 'telecom': 7, 'pikpak': 8, '115': 9, 'other': 10 };
        return (p[a] || 99) - (p[b] || 99);
    });
    GroupCache = {}; // Reset cache on new render
    grid.innerHTML = sortedTypes.map(type => {
        const items = groups[type], visible = items.slice(0, 10), hidden = items.slice(10);
        const gid = `g-${type.replace(/[^ac-z0-9]/g, '')}`;
        if (hidden.length) GroupCache[gid] = hidden;

        const typeName = DRIVE_NAMES[type] || '其他';
        return `
            <div class="result-group" id="group-${type}">
                <div class="group-header">
                    <span class="group-title">${escHtml(typeName)} <small style="opacity:0.6;font-weight:normal;margin-left:8px">共 ${items.length} 个结果</small></span>
                    <div class="group-line"></div>
                </div>
                <div class="group-visible" id="${gid}-v">${visible.map((it, idx) => renderSingleCard(it, idx)).join('')}</div>
                ${hidden.length ? `
                    <div id="${gid}-h" class="hidden-results"></div>
                    <button class="show-more-btn" onclick="toggleGroup('${gid}')" id="${gid}-b">加载更多... (${hidden.length})</button>
                ` : ''}
            </div>`;
    }).join('');
}

function renderSingleCard(item, idx) {
    const type = item.driveType || 'other';
    const driveName = DRIVE_NAMES[type] || '其他网盘';
    const hasMembers = item.members && item.members.length > 1;
    const clickAction = (type === 'quark') ? `quarkSave('${escAttr(item.url)}')` : `window.open('${escAttr(item.url)}', '_blank')`;

    // Unique ID for nested toggle
    const nid = `nid-${Math.random().toString(36).substr(2, 9)}`;

    const catName = classifyResource(item);

    return `
        <div class="list-item-wrapper">
            <div class="list-item" style="animation-delay:${Math.min(idx * 0.03, 0.4)}s" onclick="${clickAction}">
                <div class="list-item-body">
                    <div class="list-item-title" title="${escAttr(item.note)}">
                        ${escHtml(item.note)}
                        ${hasMembers ? `<span class="agg-badge" onclick="event.stopPropagation(); toggleNested('${nid}')">📦 ${item.members.length}个结果</span>` : ''}
                    </div>
                    <div class="list-item-meta">
                        <span class="drive-badge-text badge-text-${type}">${escHtml(driveName)}</span>
                        <span class="meta-divider">|</span>
                        <span>📅 ${item.datetime ? item.datetime.split('T')[0] : '未知'}</span>
                    </div>
                </div>
                <div class="list-item-actions">
                    <span class="type-tag-mini">${escHtml(catName)}</span>
                    <span class="validity-indicator" title="资源可能有效"><span class="valid-dot"></span></span>
                    <button class="btn-icon" title="复制链接" onclick="event.stopPropagation(); copyUrl('${escAttr(item.url)}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    ${hasMembers ? `
                        <button class="btn-icon toggle-icon" title="展开所有版本" onclick="event.stopPropagation(); toggleNested('${nid}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 13l5 5 5-5M7 6l5 5 5-5"/></svg>
                        </button>
                    ` : ''}
                </div>
            </div>
            ${hasMembers ? `
                <div id="${nid}" class="nested-items" style="display:none">
                    ${item.members.map(m => {
        const mType = mapType(m.url); // Use the existing mapType helper
        const mClick = (mType === 'quark') ? `quarkSave('${escAttr(m.url)}')` : `window.open('${escAttr(m.url)}', '_blank')`;
        return `
                        <div class="nested-item" onclick="${mClick}">
                            <div class="nested-item-left">
                                <span class="nested-url-title text-truncate">${escHtml(m.title || m.note || m.url)}</span>
                                ${m.pwd ? `<span class="nested-tag-mini pwd">🔑 ${escHtml(m.pwd)}</span>` : ''}
                                ${m.size ? `<span class="nested-tag-mini size">💾 ${escHtml(m.size)}</span>` : ''}
                            </div>
                            <div class="nested-item-right">
                                ${m.from ? `<span class="nested-tag-mini source">${escHtml(m.from)}</span>` : ''}
                                <span class="nested-sharer">${escHtml(m.sharer || '匿名')}</span>
                                <span class="nested-date">${m.datetime ? m.datetime.split('T')[0] : ''}</span>
                                <span class="type-tag-mini">${escHtml(classifyResource(m))}</span>
                                <span class="valid-dot mini"></span>
                                <div class="nested-actions">
                                    ${mType === 'quark' ? `
                                        <button class="btn-icon mini-icon" title="保存到夸克" onclick="event.stopPropagation(); quarkSave('${escAttr(m.url)}')">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                                        </button>
                                    ` : ''}
                                    <button class="btn-icon mini-icon" title="复制链接" onclick="event.stopPropagation(); copyUrl('${escAttr(m.url)}')">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    </button>
                                    <button class="btn-icon mini-icon" title="浏览器打开" onclick="event.stopPropagation(); window.open('${escAttr(m.url)}', '_blank')">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                    </button>
                                </div>
                            </div>
                        </div>`;
    }).join('')}
                </div>
            ` : ''}
        </div>`;
}

function toggleNested(nid) {
    const el = $(nid);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleGroup(gid) {
    const b = $(`${gid}-b`), v = $(`${gid}-v`);
    if (b && v && GroupCache[gid]) {
        const list = GroupCache[gid];
        if (!list.length) return;

        const toShow = list.slice(0, 10);
        const remaining = list.slice(10);

        v.innerHTML += toShow.map((it, idx) => renderSingleCard(it, idx + 50)).join('');
        GroupCache[gid] = remaining;

        if (remaining.length) {
            b.textContent = `加载更多... (${remaining.length})`;
        } else {
            b.style.display = 'none';
        }
    }
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
    const discovery = $('discovery-area'); // FIXED ID
    const header = $('hero-header');
    if (on) {
        if (discovery) discovery.style.display = 'none';
        if (header) header.classList.add('collapsed');
        $('results-grid').innerHTML = `<div class="loading-state" style="margin-top:24px"><div class="loading-spinner"></div><p>正在智能抓取全网高质量资源...</p></div>`;
    } else {
        if (discovery && !$('search-input').value.trim()) discovery.style.display = 'block';
    }
}

async function fetchWithProxy(url) {
    const fetchWithTimeout = async (target, timeout = 5000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(target, { signal: controller.signal });
            clearTimeout(id);
            return res;
        } catch (e) { return null; }
    };

    // V16: High Performance Proxy Chain
    // Try CorsProxy first (often cleaner for raw JSON data)
    try {
        const res = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(url)}`, 4000);
        if (res && res.ok) {
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { return text; }
        }
    } catch (e) { }

    // Backup 2: CodeTabs proxy
    try {
        const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`, 4000);
        if (res && res.ok) {
            const text = await res.text();
            try { return JSON.parse(text); } catch (e) { return text; }
        }
    } catch (e) { }

    // Backup 3: AllOrigins (Very robust for GET)
    try {
        const res = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}&_=${Date.now()}`, 5000);
        if (res && res.ok) {
            const j = await res.json();
            if (j.contents) {
                try { return JSON.parse(j.contents); } catch (e) { return j.contents; }
            }
        }
    } catch (e) { }

    return null;
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

window.doSearch = doSearch; window.HistoryManager = HistoryManager; window.toggleGroup = toggleGroup; window.copyUrl = copyUrl; window.CacheManager = CacheManager; window.loadDiscoverySingle = loadDiscoverySingle; window.toggleNested = toggleNested;
