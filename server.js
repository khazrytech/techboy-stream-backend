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

// ============================================================================
// SONICPESA PAYMENT GATEWAY CONFIGURATION (Render.com Environment Variables)
// ============================================================================
const SONICPESA_BASE_URL = (process.env.SONICPESA_BASE_URL || 'https://api.sonicpesa.com/api/v1').replace(/\/+$/, '');

function getSonicPesaCredentials() {
    const rawKey = (
        process.env.SONICPESA_API_KEY ||
        process.env.SONICPESA_KEY ||
        process.env.X_API_KEY ||
        process.env.API_KEY ||
        ''
    ).trim().replace(/^Bearer\s+/i, '');

    const rawSecret = (
        process.env.SONICPESA_API_SECRET ||
        process.env.SONICPESA_SECRET ||
        process.env.X_API_SECRET ||
        process.env.API_SECRET ||
        ''
    ).trim().replace(/^Bearer\s+/i, '');

    return { apiKey: rawKey || rawSecret, apiSecret: rawSecret };
}

function getSonicPesaHeaders(overrideKey) {
    const { apiKey, apiSecret } = getSonicPesaCredentials();
    const effectiveKey = overrideKey || apiKey;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'TechBoyTV-Backend/2.2'
    };
    if (effectiveKey) {
        headers['X-API-KEY'] = effectiveKey;
    }
    if (apiSecret) {
        headers['X-API-SECRET'] = apiSecret;
    }
    return headers;
}

/**
 * Normalizes Tanzanian phone numbers into 255XXXXXXXXX format required by SonicPesa.
 * Accepts: 0712345678, 0612345678, +255712345678, 255712345678, 712345678
 */
function normalizeTzPhone(rawPhone) {
    if (!rawPhone) return '';
    let digits = String(rawPhone).replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
        digits = '255' + digits.substring(1);
    } else if ((digits.startsWith('7') || digits.startsWith('6')) && digits.length === 9) {
        digits = '255' + digits;
    }
    return digits;
}

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
    const { apiKey } = getSonicPesaCredentials();
    res.json({
        status: 'online',
        server: 'TechBoy TV Backend Engine (NHDAPI + SonicPesa Powered)',
        provider: NHDAPI_BASE,
        sonicPesaConfigured: Boolean(apiKey),
        version: '2.1.0',
        endpoints: {
            embedMovie: '/api/embed/movie/:tmdbId',
            embedTv: '/api/embed/tv/:tmdbId/:season/:episode',
            downloadMovie: '/api/download/movie/:tmdbId',
            downloadTv: '/api/download/tv/:tmdbId/:season/:episode',
            proxy: '/api/proxy?url=',
            donateInitiate: '/api/donate/initiate',
            donateStatus: '/api/donate/status',
            donateWebhook: '/api/donate/webhook'
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

// ============================================================================
// SONICPESA DONATION & SERVER SUPPORT ENDPOINTS
// ============================================================================

/**
 * Initiates a SonicPesa USSD Push order for Server Contribution (minimum TZS 1,000)
 * POST /api/donate/initiate (or /api/payment/create_order)
 * Body: { phone: "07XXXXXXXX", amount: 1000, name?: "Mdau", email?: "..." }
 */
async function handleCreateDonationOrder(req, res) {
    try {
        const { apiKey } = getSonicPesaCredentials();
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                status: 'error',
                message: 'SONICPESA_API_KEY haijawekwa kwenye Render Environment Variables.'
            });
        }

        const rawPhone = req.body?.phone || req.body?.buyer_phone || req.body?.msisdn || '';
        const rawAmount = Number(req.body?.amount || 0);
        const buyerName = (req.body?.name || req.body?.buyer_name || 'Mdau wa TechBoy TV').trim() || 'Mdau wa TechBoy TV';
        const buyerEmail = (req.body?.email || req.body?.buyer_email || 'support@techboytv.app').trim() || 'support@techboytv.app';

        const buyerPhone = normalizeTzPhone(rawPhone);
        if (!/^255[67]\d{8}$/.test(buyerPhone)) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Tafadhali weka namba sahihi ya simu ya Tanzania (mfano 0712345678 au 0655123456).'
            });
        }

        if (!rawAmount || isNaN(rawAmount) || rawAmount < 1000) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'Kiwango cha chini cha kuchangia seva ni TZS 1,000.'
            });
        }

        const amountTzs = Math.round(rawAmount);
        const payload = {
            buyer_name: buyerName,
            buyer_email: buyerEmail,
            buyer_phone: buyerPhone,
            amount: amountTzs,
            currency: 'TZS'
        };

        console.log(`[SonicPesa] Initiating USSD Push -> phone=${buyerPhone}, amount=TZS ${amountTzs}`);

        const spResponse = await axios.post(
            `${SONICPESA_BASE_URL}/payment/create_order`,
            payload,
            {
                headers: getSonicPesaHeaders(),
                timeout: 30000,
                validateStatus: () => true
            }
        );

        const data = spResponse.data || {};
        const orderId =
            data?.data?.order_id ||
            data?.order_id ||
            data?.data?.reference ||
            data?.reference ||
            '';

        const isSuccess =
            (spResponse.status >= 200 && spResponse.status < 300) &&
            (data?.status === 'success' || data?.success === true || Boolean(orderId));

        if (!isSuccess) {
            const errMsg =
                data?.message ||
                data?.error ||
                'Imeshindikana kutuma ombi la USSD kwenye simu yako. Hakikisha namba iko sahihi na ujaribu tena.';
            console.error('[SonicPesa] create_order failed:', spResponse.status, data);
            return res.status(400).json({
                success: false,
                status: 'error',
                message: errMsg,
                raw: data
            });
        }

        return res.json({
            success: true,
            status: 'success',
            orderId: orderId,
            amount: amountTzs,
            phone: buyerPhone,
            paymentStatus: data?.data?.status || 'PENDING',
            message: 'Ombi la kuchangia limetumwa kwenye simu yako! Tafadhali weka PIN yako ya M-Pesa / Tigo Pesa / Airtel Money / HaloPesa.',
            data: data?.data || data
        });
    } catch (error) {
        console.error('[SonicPesa] Exception in handleCreateDonationOrder:', error.message);
        return res.status(500).json({
            success: false,
            status: 'error',
            message: 'Hitilafu ya kuwasiliana na SonicPesa: ' + error.message
        });
    }
}

app.post('/api/donate/initiate', handleCreateDonationOrder);
app.post('/api/payment/create_order', handleCreateDonationOrder);

/**
 * Checks SonicPesa Order Status
 * POST /api/donate/status (or GET /api/donate/status/:orderId or POST /api/payment/order_status)
 */
async function handleCheckDonationStatus(req, res) {
    try {
        const { apiKey } = getSonicPesaCredentials();
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                status: 'error',
                message: 'SONICPESA_API_KEY haijawekwa kwenye seva.'
            });
        }

        const orderId = (
            req.params?.orderId ||
            req.body?.order_id ||
            req.body?.orderId ||
            req.query?.order_id ||
            req.query?.orderId ||
            ''
        ).trim();

        if (!orderId) {
            return res.status(400).json({
                success: false,
                status: 'error',
                message: 'order_id inahitajika.'
            });
        }

        const spResponse = await axios.post(
            `${SONICPESA_BASE_URL}/payment/order_status`,
            { order_id: orderId },
            {
                headers: getSonicPesaHeaders(),
                timeout: 20000,
                validateStatus: () => true
            }
        );

        const data = spResponse.data || {};
        const rawStatus = String(
            data?.data?.payment_status ||
            data?.data?.status ||
            data?.payment_status ||
            data?.status ||
            'PENDING'
        ).toUpperCase();

        let normalizedStatus = 'PENDING';
        if (['SUCCESS', 'COMPLETED', 'PAID', 'OK'].includes(rawStatus)) {
            normalizedStatus = 'SUCCESS';
        } else if (['CANCELLED', 'CANCELED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(rawStatus)) {
            normalizedStatus = 'FAILED';
        }

        return res.json({
            success: true,
            orderId,
            paymentStatus: normalizedStatus,
            rawStatus,
            transId: data?.data?.transid || data?.transid || '',
            amount: data?.data?.amount || data?.amount || 0,
            data: data?.data || data
        });
    } catch (error) {
        console.error('[SonicPesa] Exception in handleCheckDonationStatus:', error.message);
        return res.status(500).json({
            success: false,
            status: 'error',
            paymentStatus: 'PENDING',
            message: 'Hitilafu ya kukagua malipo: ' + error.message
        });
    }
}

app.post('/api/donate/status', handleCheckDonationStatus);
app.get('/api/donate/status/:orderId', handleCheckDonationStatus);
app.post('/api/payment/order_status', handleCheckDonationStatus);

/**
 * SonicPesa Webhook Endpoint
 * Configure in SonicPesa Dashboard -> https://<your-render-url>/api/donate/webhook
 */
app.post('/api/donate/webhook', (req, res) => {
    try {
        console.log('[SonicPesa Webhook] Received payment event:', JSON.stringify(req.body));
        return res.status(200).json({ received: true, status: 'ok' });
    } catch (e) {
        return res.status(200).json({ received: true });
    }
});

app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`TechBoy TV Backend Engine v2.1.0 (NHDAPI + SonicPesa) running on port ${PORT}`);
    console.log(`Test Movie Embed: http://localhost:${PORT}/api/embed/movie/550`);
    console.log(`Test Movie DL:    http://localhost:${PORT}/api/download/movie/550`);
    console.log(`SonicPesa Donate: POST http://localhost:${PORT}/api/donate/initiate`);
    console.log(`===============================================`);
});
