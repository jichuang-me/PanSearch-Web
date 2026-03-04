const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');

// 【调试专用】暂时关闭 SSL 校验，解决用户环境中可能存在的 SSL 协议冲突
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
app.use(cors());

// 增加超时，匹配夸克 API 验证时间
const axiosInstance = axios.create({
    timeout: 10000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

// === 1. PanSou 搜索封装 (API + 爬虫双保险) ===
async function searchPansou(keyword, limit = 50) {
    const domains = ['https://pansou.men', 'https://s.panhunt.com'];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.pansearch.me/',
        'Accept': 'application/json, text/html'
    };

    // 1. 尝试直接 API
    for (const domain of domains) {
        try {
            console.log(`[Fetch] Trying API ${domain}...`);
            const targetUrl = `${domain}/api/search?q=${encodeURIComponent(keyword)}&page=1&limit=${limit}`;
            const { data } = await axiosInstance.get(targetUrl, { headers });
            if (data && data.code === 0 && data.data) return data;
        } catch (err) {
            console.warn(`[Fetch] API ${domain} failed: ${err.message}`);
        }
    }

    // 2. 爬虫 Fallback (目标 pansearch.me)
    try {
        console.log(`[Fetch] API failed, trying HTML scraping from pansearch.me...`);
        const targetUrl = `https://www.pansearch.me/search?keyword=${encodeURIComponent(keyword)}`;
        const { data: html } = await axiosInstance.get(targetUrl, { headers });

        const items = [];
        // 正则：匹配包含 1、xxxxx: ... 结构的链接
        const regex = /<div class="card-body">([\s\S]*?)<\/div>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const content = match[1];
            const noteMatch = content.match(/<h5[^>]*>(.*?)<\/h5>/i) || content.match(/1、(.*?):/i);
            const urlMatch = content.match(/href="(https:\/\/(pan\.quark\.cn|www\.alipan\.com|pan\.baidu\.com|pan\.xunlei\.com)\/s\/[a-zA-Z0-9_\-]+)"/i);

            if (urlMatch) {
                items.push({
                    note: noteMatch ? noteMatch[1].replace(/<[^>]+>/g, '').trim() : "未知资源",
                    url: urlMatch[1],
                    datetime: new Date().toISOString(),
                    source: "scraper"
                });
            }
        }

        if (items.length > 0) {
            console.log(`[Scraper] Found ${items.length} items from HTML`);
            return { code: 0, data: { merged_by_type: { scraped: items } } };
        }
    } catch (err) {
        console.error(`[Scraper] Scraping failed: ${err.message}`);
    }

    return null;
}

// === 2. 夸克验证链接 ===
async function validateQuark(url) {
    const match = url.match(/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/);
    if (!match) return false;

    const pwd_id = match[1];
    const api = "https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc";

    try {
        const { data } = await axiosInstance.post(api, {
            pwd_id: pwd_id,
            passcode: ""
        }, {
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0"
            },
            timeout: 1000 // 极速超时，避免卡住用户的搜索体验
        });

        const stoken = data?.data?.stoken;
        return data?.code === 0 && !!stoken;
    } catch (err) {
        return false; // Error or Timeout means drop it
    }
}

// === 3. 严格过滤逻辑 ===
function filterAndSort(mergedByType, keyword) {
    let list = [];
    for (const [type, items] of Object.entries(mergedByType || {})) {
        if (!Array.isArray(items)) continue;
        items.forEach(item => list.push({ ...item, driveType: type }));
    }

    const kws = keyword ? keyword.toLowerCase().split(/\s+/).filter(Boolean) : [];

    const matched = list.filter(item => {
        const note = (item.note || '').toLowerCase();
        const url = (item.url || '');

        // 1. 严格关键词匹配：提取 note 必须包含关键词
        if (kws.length > 0) {
            const hasMatch = kws.some(k => note.includes(k));
            if (!hasMatch) return false;
        }

        // 2. 严格正则校验是否是合法云盘链接 (屏蔽跳转诱导链接)
        let isDirectLink = false;
        if (item.driveType === 'quark') {
            isDirectLink = /pan\.quark\.cn\/s\/[a-zA-Z0-9]+/.test(url);
        } else if (item.driveType === 'baidu') {
            isDirectLink = /(pan|yun)\.baidu\.com\/s\/[a-zA-Z0-9_\-]+/.test(url);
        } else if (item.driveType === 'aliyun') {
            isDirectLink = /(aliyundrive|alipan)\.com\/s\/[a-zA-Z0-9]+/.test(url);
        } else if (item.driveType === 'uc') {
            isDirectLink = /(express|drive)\.uc\.cn\/s\/[a-zA-Z0-9]+/.test(url);
        } else if (item.driveType === '115') {
            isDirectLink = /115\.com\/s\/[a-zA-Z0-9]+/.test(url);
        } else if (item.driveType === 'pikpak') {
            isDirectLink = /mypikpak\.com\/s\/[a-zA-Z0-9]+/.test(url);
        } else {
            isDirectLink = /(pan|drive|yun)\./.test(url);
        }

        return isDirectLink;
    });

    // 核心 2：按时间倒序排序（最新优先）
    matched.sort((a, b) => new Date(b.datetime || 0) - new Date(a.datetime || 0));
    return matched;
}


// === 接口定义 ===
app.get('/api/search', async (req, res) => {
    const keyword = (req.query.q || '').trim();
    // 强制缩小搜索返回量，提升响应敏捷度
    const limit = parseInt(req.query.limit) || 20;

    // 最新资源探测 (Discovery View)
    if (keyword === 'latest' || keyword === '') {
        const raw = await searchPansou('', 20);
        if (!raw || !raw.data) return res.json({ code: -1, data: [] });

        const filtered = filterAndSort(raw.data.merged_by_type, ''); // No keyword limit for latest
        return res.json({ code: 0, data: filtered.slice(0, 10) });
    }

    // 1. 获取基础搜索结果
    const rawData = await searchPansou(keyword, limit);
    if (!rawData || !rawData.data) {
        return res.json({ code: -2, msg: 'Search API failed or empty' });
    }

    const allRawItems = [].concat(...Object.values(rawData.data.merged_by_type || {}));
    console.log(`[Search] Keyword: "${keyword}", Items found: ${allRawItems.length}`);
    console.log(`[Search] First 5 notes:`, allRawItems.slice(0, 5).map(i => i.note));

    // 2. 本地过滤 & 排序 & 极度精简截断
    const candidates = filterAndSort(rawData.data.merged_by_type, keyword).slice(0, 20);
    console.log(`[Search] After strict filter: ${candidates.length} candidates`);

    if (candidates.length === 0) {
        return res.json({ code: 0, data: [], msg: `未找到匹配“${keyword}”的精准资源 (共搜索到 ${allRawItems.length} 条相关资源)` });
    }

    // 3. 并发验证链接有效性
    const MAX_VALID = 10;
    const validResults = [];

    const validationPromises = candidates.map(async (item) => {
        try {
            let isValid = true;
            if (item.driveType === 'quark') {
                isValid = await validateQuark(item.url);
            }
            if (isValid) {
                item.isValidated = (item.driveType === 'quark');
                return item;
            }
        } catch (e) { }
        return null;
    });

    const results = await Promise.all(validationPromises);
    for (const r of results) {
        if (r) validResults.push(r);
        if (validResults.length >= MAX_VALID) break;
    }

    console.log(`[Search] Final valid results: ${validResults.length}`);

    if (validResults.length === 0) {
        return res.json({ code: 0, data: [], msg: '排序最靠前的链接似乎都已失效，请换个关键词试试' });
    }

    return res.json({ code: 0, data: validResults });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`PanSearch Backend Server running on http://localhost:${PORT}`);
});
