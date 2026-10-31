const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Base URLs & Headers
const VIDLINK_BASE = 'https://vidlink.pro';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': `${VIDLINK_BASE}/`,
    'Origin': VIDLINK_BASE,
    'Accept': '*/*'
};

// Health Check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        server: 'TechBoy TV Backend Engine',
        version: '1.1.0',
        endpoints: {
            movie: '/api/download/movie/:tmdbId',
            tv: '/api/download/tv/:tmdbId/:season/:episode',
            proxy: '/api/proxy?url='
        }
    });
});

/**
 * Checks whether a given string is a real stream URL (.m3u8, .mp4, etc.) and not an HTML landing page
 */
function isRealStreamUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    if (lower.includes('.html') || lower.includes('/embed/') || lower.includes('vs_src.php')) {
        return false;
    }
    return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('.mpd') ||
           lower.includes('/proxy/') || lower.includes('/sacdn/') || lower.includes('flooderrr');
}

/**
 * Resolve Movie Stream / Download URL
 */
app.get('/api/download/movie/:tmdbId', async (req, res) => {
    const { tmdbId } = req.params;

    if (!tmdbId || isNaN(tmdbId)) {
        return res.status(400).json({
            success: false,
            message: 'TMDB ID lazima iwe namba sahihi.'
        });
    }

    try {
        let streamUrl = null;
        let qualities = {};

        // 1. Try VidLink API endpoint
        try {
            const vidlinkResp = await axios.get(`${VIDLINK_BASE}/api/b/movie/${tmdbId}?multiLang=0`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'X-Playback-Environment': 'standard'
                },
                timeout: 5000
            });

            if (vidlinkResp.data && vidlinkResp.data.stream) {
                const s = vidlinkResp.data.stream;
                const candidate = s.playlist || s.qualities?.['1080p']?.url || s.qualities?.['720p']?.url;
                if (isRealStreamUrl(candidate)) {
                    streamUrl = candidate;
                    qualities = s.qualities || {};
                }
            }
        } catch (e) {
            console.log(`[Movie] VidLink API miss for ${tmdbId}`);
        }

        // 2. Try VidSrc unpack flow if direct API missed
        if (!streamUrl) {
            try {
                const vsResp = await axios.get(`https://vsembed.ru/vs_src.php?type=movie&id=${tmdbId}`, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Referer': `https://vsembed.ru/embed/movie/${tmdbId}/`
                    },
                    timeout: 5000
                });

                const landingUrl = vsResp.data?.src;
                if (landingUrl && landingUrl.startsWith('http')) {
                    const landingHost = new URL(landingUrl).origin;
                    const landingResp = await axios.get(landingUrl, {
                        headers: {
                            'User-Agent': USER_AGENT,
                            'Referer': 'https://vsembed.ru/'
                        },
                        timeout: 5000
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
                            timeout: 5000
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
                                timeout: 5000
                            });

                            const streamUrls = streamDataResp.data?.data?.stream_urls;
                            if (Array.isArray(streamUrls) && streamUrls.length > 0) {
                                streamUrl = streamUrls[0];
                            }
                        }
                    }
                }
            } catch (e) {
                console.log(`[Movie] VidSrc unpack miss for ${tmdbId}: ${e.message}`);
            }
        }

        // Return real stream if found
        if (streamUrl && isRealStreamUrl(streamUrl)) {
            return res.json({
                success: true,
                tmdbId: parseInt(tmdbId),
                type: 'stream',
                downloadUrl: streamUrl,
                headersRequired: {
                    'Referer': `${VIDLINK_BASE}/`,
                    'User-Agent': USER_AGENT
                },
                qualities: qualities
            });
        }

        // Inform app that server did not resolve a direct m3u8 so app should use its high-speed in-app resolver
        return res.json({
            success: false,
            tmdbId: parseInt(tmdbId),
            type: 'in_app_resolver_needed',
            embedUrl: `${VIDLINK_BASE}/movie/${tmdbId}`,
            message: 'Direct stream haikupatikana moja kwa moja toka API. Inatumia in-app resolver.'
        });

    } catch (error) {
        console.error(`Error resolving movie ${tmdbId}:`, error.message);
        return res.status(500).json({
            success: false,
            message: 'Hitilafu ya seva: ' + error.message,
            embedUrl: `${VIDLINK_BASE}/movie/${tmdbId}`
        });
    }
});

/**
 * Resolve TV Series Stream / Download URL
 */
app.get('/api/download/tv/:tmdbId/:season/:episode', async (req, res) => {
    const { tmdbId, season, episode } = req.params;

    if (!tmdbId || isNaN(tmdbId)) {
        return res.status(400).json({ success: false, message: 'TMDB ID is required' });
    }

    try {
        let streamUrl = null;

        // Try VidLink TV API
        try {
            const vidlinkResp = await axios.get(`${VIDLINK_BASE}/api/b/tv/${tmdbId}/${season}/${episode}?multiLang=0`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'X-Playback-Environment': 'standard'
                },
                timeout: 5000
            });

            if (vidlinkResp.data && vidlinkResp.data.stream) {
                const s = vidlinkResp.data.stream;
                const candidate = s.playlist || s.qualities?.['1080p']?.url || s.qualities?.['720p']?.url;
                if (isRealStreamUrl(candidate)) {
                    streamUrl = candidate;
                }
            }
        } catch (e) {}

        if (streamUrl && isRealStreamUrl(streamUrl)) {
            return res.json({
                success: true,
                tmdbId: parseInt(tmdbId),
                season: parseInt(season),
                episode: parseInt(episode),
                type: 'stream',
                downloadUrl: streamUrl,
                headersRequired: {
                    'Referer': `${VIDLINK_BASE}/`,
                    'User-Agent': USER_AGENT
                }
            });
        }

        return res.json({
            success: false,
            tmdbId: parseInt(tmdbId),
            season: parseInt(season),
            episode: parseInt(episode),
            type: 'in_app_resolver_needed',
            embedUrl: `${VIDLINK_BASE}/tv/${tmdbId}/${season}/${episode}`
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * Resilient Video Segment Proxy
 */
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('URL query parameter inahitajika');
    }

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': `${VIDLINK_BASE}/`,
                'Accept': '*/*'
            },
            responseType: 'stream',
            timeout: 15000
        });

        // Forward content-type and cache-control headers
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');

        response.data.pipe(res);
    } catch (e) {
        res.status(502).send('Proxy error: ' + e.message);
    }
});

app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`TechBoy TV Backend Engine v1.1.0 is running on port ${PORT}`);
    console.log(`Test URL: http://localhost:${PORT}/api/download/movie/550`);
    console.log(`===============================================`);
});
