const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Official NHDAPI Base URL & Headers
const NHDAPI_BASE = 'https://nhdapi.st';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': `${NHDAPI_BASE}/`,
    'Accept': '*/*'
};

/**
 * Builds customized NHDAPI Embed URL with TechBoy TV Glass UI & Multi-Audio / Download options
 */
function buildNhdEmbedUrl({ type, id, season = 1, episode = 1, query = {} }) {
    const basePath = type === 'tv'
        ? `${NHDAPI_BASE}/embed/tv/${id}/${season}/${episode}`
        : `${NHDAPI_BASE}/embed/movie/${id}`;

    const params = new URLSearchParams({
        autoplay: query.autoplay || 'true',
        audio: query.audio || 'true',
        title: query.title || 'true',
        download: query.download || 'true',
        setting: query.setting || 'true',
        chromecast: query.chromecast || 'true',
        pip: query.pip || 'true',
        primarycolor: (query.primarycolor || '00E5FF').replace('#', ''),
        secondarycolor: (query.secondarycolor || '8B5CF6').replace('#', ''),
        iconcolor: (query.iconcolor || 'FFFFFF').replace('#', ''),
        glasscolor: (query.glasscolor || '000000').replace('#', ''),
        glassopacity: query.glassopacity || '65',
        glassblur: query.glassblur || '20'
    });

    if (type === 'tv') {
        params.set('autonext', query.autonext || 'true');
        params.set('episodelist', query.episodelist || 'true');
        params.set('nextbutton', query.nextbutton || 'true');
    }
    if (query.progress) params.set('progress', String(query.progress));
    if (query.server) params.set('server', String(query.server));
    if (query.lang) params.set('lang', String(query.lang));
    if (query.language) params.set('language', String(query.language));

    return `${basePath}?${params.toString()}`;
}

// Health Check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        server: 'TechBoy TV Backend Engine (NHDAPI Powered)',
        provider: NHDAPI_BASE,
        version: '2.0.0',
        endpoints: {
            embedMovie: '/api/embed/movie/:tmdbId',
            embedTv: '/api/embed/tv/:tmdbId/:season/:episode',
            downloadMovie: '/api/download/movie/:tmdbId',
            downloadTv: '/api/download/tv/:tmdbId/:season/:episode',
            proxy: '/api/proxy?url='
        }
    });
});

/**
 * Official NHDAPI Movie Embed & Download Metadata Endpoint
 */
app.get('/api/embed/movie/:tmdbId', (req, res) => {
    const { tmdbId } = req.params;
    return res.json({
        success: true,
        provider: 'nhdapi.st',
        type: 'movie',
        id: tmdbId,
        embedUrl: buildNhdEmbedUrl({ type: 'movie', id: tmdbId, query: req.query }),
        downloadPortalUrl: `${NHDAPI_BASE}/dl/movie/${tmdbId}`
    });
});

/**
 * Official NHDAPI TV Show Embed & Download Metadata Endpoint
 */
app.get('/api/embed/tv/:tmdbId/:season/:episode', (req, res) => {
    const { tmdbId, season, episode } = req.params;
    return res.json({
        success: true,
        provider: 'nhdapi.st',
        type: 'tv',
        id: tmdbId,
        season: Number(season) || 1,
        episode: Number(episode) || 1,
        embedUrl: buildNhdEmbedUrl({ type: 'tv', id: tmdbId, season, episode, query: req.query }),
        downloadPortalUrl: `${NHDAPI_BASE}/dl/tv/${tmdbId}/${season}/${episode}`
    });
});

/**
 * Checks whether a given string is a real stream URL (.m3u8, .mp4, .mkv, etc.) and not an HTML page
 */
function isRealStreamUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (lower.includes('.html') || lower.includes('/embed/') || lower.includes('/dl/') || lower.includes('vs_src.php')) {
        return false;
    }
    return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('.mkv') || lower.includes('.mpd') ||
           lower.includes('/proxy/') || lower.includes('/sacdn/') || lower.includes('flooderrr');
}

/**
 * Resolve Movie Download / Stream Info (NHDAPI Primary)
 */
app.get('/api/download/movie/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;

    if (!tmdbId) {
        return res.status(400).json({
            success: false,
            message: 'TMDB au IMDB ID inahitajika.'
        });
    }

    const embedUrl = buildNhdEmbedUrl({ type: 'movie', id: tmdbId, query: req.query });
    const downloadPortalUrl = `${NHDAPI_BASE}/dl/movie/${tmdbId}`;

    try {
        let streamUrl = null;

        // Optional direct stream fallback check
        try {
            const vsResp = await axios.get(`https://vsembed.ru/vs_src.php?type=movie&id=${tmdbId}`, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Referer': `https://vsembed.ru/embed/movie/${tmdbId}/`
                },
                timeout: 4500
            });

            const landingUrl = vsResp.data?.src;
            if (landingUrl && landingUrl.startsWith('http')) {
                const landingHost = new URL(landingUrl).origin;
                const landingResp = await axios.get(landingUrl, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Referer': 'https://vsembed.ru/'
                    },
                    timeout: 4500
                });

                const playerUrlMatch = landingResp.data?.match(/"playerUrl"\s*:\s*"([^"]+)"/);
                if (playerUrlMatch) {
                    const playerPath = playerUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    const fullPlayerUrl = playerPath.startsWith('http') ? playerPath : `${landingHost}${playerPath}`;

                    const playerResp = await axios.get(fullPlayerUrl, {
                        headers: {
                            'User-Agent': USER_AGENT,
                            'Referer': landingUrl
                        },
                        timeout: 4500
                    });

                    const apiMatch = playerResp.data?.match(/"api"\s*:\s*"([^"]+)"/);
                    const tokenMatch = playerResp.data?.match(/"apiToken"\s*:\s*"([^"]+)"/);

                    if (apiMatch && tokenMatch) {
                        const rawApi = apiMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                        const token = tokenMatch[1];
                        const sep = rawApi.includes('?') ? '&' : '?';
                        const streamDataUrl = `${rawApi}${sep}api_token=${encodeURIComponent(token)}`;

                        const streamDataResp = await axios.get(streamDataUrl, {
                            headers: {
                                'User-Agent': USER_AGENT,
                                'Referer': `${landingHost}/`,
                                'Origin': landingHost
                            },
                            timeout: 4500
                        });

                        const streamUrls = streamDataResp.data?.data?.stream_urls;
                        if (Array.isArray(streamUrls) && streamUrls.length > 0) {
                            streamUrl = streamUrls[0];
                        }
                    }
                }
            }
        } catch (e) {
            console.log(`[Movie] Direct fallback miss for ${tmdbId}: ${e.message}`);
        }

        if (streamUrl && isRealStreamUrl(streamUrl)) {
            return res.json({
                success: true,
                provider: 'nhdapi.st',
                tmdbId: isNaN(tmdbId) ? tmdbId : parseInt(tmdbId),
                type: 'stream',
                downloadUrl: streamUrl,
                downloadPortalUrl,
                embedUrl,
                headersRequired: DEFAULT_HEADERS
            });
        }

        return res.json({
            success: false,
            provider: 'nhdapi.st',
            tmdbId: isNaN(tmdbId) ? tmdbId : parseInt(tmdbId),
            type: 'nhdapi_portal',
            downloadPortalUrl,
            embedUrl,
            message: 'Tumia NHDAPI Direct Download Portal (/dl/movie) au in-app resolver.'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            provider: 'nhdapi.st',
            message: 'Hitilafu ya seva: ' + error.message,
            downloadPortalUrl,
            embedUrl
        });
    }
});

/**
 * Resolve TV Series Download / Stream Info (NHDAPI Primary)
 */
app.get('/api/download/tv/:tmdbId/:season/:episode', async (req, res) => {
    const { tmdbId, season, episode } = req.params;

    if (!tmdbId) {
        return res.status(400).json({ success: false, message: 'TMDB au IMDB ID inahitajika.' });
    }

    const s = parseInt(season) || 1;
    const ep = parseInt(episode) || 1;
    const embedUrl = buildNhdEmbedUrl({ type: 'tv', id: tmdbId, season: s, episode: ep, query: req.query });
    const downloadPortalUrl = `${NHDAPI_BASE}/dl/tv/${tmdbId}/${s}/${ep}`;

    return res.json({
        success: false,
        provider: 'nhdapi.st',
        tmdbId: isNaN(tmdbId) ? tmdbId : parseInt(tmdbId),
        season: s,
        episode: ep,
        type: 'nhdapi_portal',
        downloadPortalUrl,
        embedUrl
    });
});

/**
 * Resilient Video & File Stream Proxy (Supports HTTP Range for MP4/MKV resume & seeking)
 */
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('URL query parameter inahitajika');
    }

    try {
        const proxyHeaders = {
            'User-Agent': USER_AGENT,
            'Referer': `${NHDAPI_BASE}/`,
            'Accept': '*/*'
        };
        if (req.headers.range) {
            proxyHeaders['Range'] = req.headers.range;
        }

        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: proxyHeaders,
            responseType: 'stream',
            timeout: 25000,
            validateStatus: (status) => status >= 200 && status < 400
        });

        res.status(response.status);
        const forwardHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition'];
        for (const h of forwardHeaders) {
            if (response.headers[h]) {
                res.setHeader(h, response.headers[h]);
            }
        }
        res.setHeader('Access-Control-Allow-Origin', '*');

        response.data.pipe(res);
    } catch (e) {
        res.status(502).send('Proxy error: ' + e.message);
    }
});

app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`TechBoy TV Backend Engine v2.0.0 (NHDAPI) running on port ${PORT}`);
    console.log(`Test Movie Embed: http://localhost:${PORT}/api/embed/movie/550`);
    console.log(`Test Movie DL:    http://localhost:${PORT}/api/download/movie/550`);
    console.log(`===============================================`);
});
