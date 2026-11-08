# TechBoy TV Stream, Download & SonicPesa Backend (Render.com)

Node.js (Express) backend service for TechBoy TV Android app. Resolves video streams and processes SonicPesa Mobile Money USSD Push server donations (`M-Pesa`, `Mixx by Yas / Tigo Pesa`, `Airtel Money`, `HaloPesa`).

## Render.com Environment Variables (Weka Kwenye Render Dashboard)

Nenda kwenye **Render Dashboard -> Service yako (`techboy-tv-api`) -> Environment**, kisha ongeza:

| Key | Value |
|---|---|
| `SONICPESA_API_KEY` | API Key yako kutoka SonicPesa Dashboard |
| `SONICPESA_API_SECRET` | API Secret yako kutoka SonicPesa Dashboard (kama ipo) |

## Endpoints

- `GET /` - Health check & SonicPesa configuration status
- `POST /api/donate/initiate` - Tuma USSD Push (`{ phone, amount, name }`, kiwango cha chini `TZS 1000`)
- `POST /api/donate/status` - Kagua hali ya malipo (`{ order_id }`)
- `GET /api/donate/status/:orderId` - Kagua hali ya malipo kwa Order ID
- `POST /api/donate/webhook` - SonicPesa Webhook URL
- `GET /api/download/movie/:tmdbId` - Resolve movie stream URL
- `GET /api/download/tv/:tmdbId/:season/:episode` - Resolve TV series episode stream URL
- `GET /api/proxy?url=...` - Stream proxy with headers
