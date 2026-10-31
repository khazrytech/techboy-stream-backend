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
        version: '1.0.0',
        endpoints: {
            movie: '/api/download/movie/:tmdbId',
            tv: '/api/download/tv/:tmdbId/:season/:episode',
            proxy: '/api/proxy?url='
        }
    });
});

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
            const vidlinkResp = await axios.get(`${VIDLINK_BASE}/api/b/movie/${tmdbId}`, {
                headers: DEFAULT_HEADERS,
                timeout: 7000
            });

            if (vidlinkResp.data && vidlinkResp.data.stream) {
                const s = vidlinkResp.data.stream;
                streamUrl = s.playlist || s.qualities?.['1080p']?.url || s.qualities?.['720p']?.url;
                qualities = s.qualities || {};
            }
        } catch (e) {
            console.log(`[Movie] VidLink API 1 miss for ${tmdbId}`);
        }

        // 2. Fallback to VidSrc / vsembed API
        if (!streamUrl) {
            try {
                const vsResp = await axios.get(`https://vsembed.ru/vs_src.php?type=movie&id=${tmdbId}`, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Referer': `https://vsembed.ru/embed/movie/${tmdbId}/`
                    },
                    timeout: 7000
                });

                if (vsResp.data && vsResp.data.src) {
                    streamUrl = vsResp.data.src;
                }
            } catch (e) {
                console.log(`[Movie] Fallback 2 miss for ${tmdbId}`);
            }
        }

        // 3. Fallback to vidsrc.sh API
        if (!streamUrl) {
            try {
                const shResp = await axios.get(`https://vidsrc.sh/vs_src.php?type=movie&id=${tmdbId}`, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Referer': `https://vidsrc.sh/embed/movie/${tmdbId}`
                    },
                    timeout: 7000
                });

                if (shResp.data && shResp.data.src) {
                    streamUrl = shResp.data.src;
                }
            } catch (e) {
                console.log(`[Movie] Fallback 3 miss for ${tmdbId}`);
            }
        }

        if (streamUrl) {
            return res.json({
                success: true,
                tmdbId: parseInt(tmdbId),
                type: 'movie',
                downloadUrl: streamUrl,
                headersRequired: {
                    'Referer': `${VIDLINK_BASE}/`,
                    'User-Agent': USER_AGENT
                },
                qualities: qualities
            });
        }

        // If not extracted, return fallback embed URL
        return res.json({
            success: true,
            tmdbId: parseInt(tmdbId),
            type: 'embed_fallback',
            downloadUrl: `${VIDLINK_BASE}/movie/${tmdbId}`,
            message: 'Stream moja kwa moja haikupatikana mara moja, inatumia embed resolver.'
        });

    } catch (error) {
        console.error(`Error resolving movie ${tmdbId}:`, error.message);
        return res.status(500).json({
            success: false,
            message: 'Hitilafu ya seva: ' + error.message,
            fallbackUrl: `${VIDLINK_BASE}/movie/${tmdbId}`
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
            const vidlinkResp = await axios.get(`${VIDLINK_BASE}/api/b/tv/${tmdbId}/${season}/${episode}`, {
                headers: DEFAULT_HEADERS,
                timeout: 7000
            });

            if (vidlinkResp.data && vidlinkResp.data.stream) {
                const s = vidlinkResp.data.stream;
                streamUrl = s.playlist || s.qualities?.['1080p']?.url || s.qualities?.['720p']?.url;
            }
        } catch (e) {}

        if (streamUrl) {
            return res.json({
                success: true,
                tmdbId: parseInt(tmdbId),
                season: parseInt(season),
                episode: parseInt(episode),
                type: 'tv',
                downloadUrl: streamUrl,
                headersRequired: {
                    'Referer': `${VIDLINK_BASE}/`,
                    'User-Agent': USER_AGENT
                }
            });
        }

        return res.json({
            success: true,
            tmdbId: parseInt(tmdbId),
            season: parseInt(season),
            episode: parseInt(episode),
            type: 'embed_fallback',
            downloadUrl: `${VIDLINK_BASE}/tv/${tmdbId}/${season}/${episode}`
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * Optional Video Proxy with Headers
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
                'Origin': VIDLINK_BASE
            },
            responseType: 'stream'
        });

        res.set(response.headers);
        response.data.pipe(res);
    } catch (e) {
        res.status(502).send('Proxy error: ' + e.message);
    }
});

app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`TechBoy TV Backend Engine is running on port ${PORT}`);
    console.log(`Test URL: http://localhost:${PORT}/api/download/movie/550`);
    console.log(`===============================================`);
});
