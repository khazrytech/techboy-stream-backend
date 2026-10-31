# TechBoy TV Stream & Download Backend

Node.js (Express) backend service for TechBoy TV Android app. Resolves direct video streams from VidLink, VidSrc, and JW Player with CORS and required headers.

## Endpoints

- `GET /` - Health check
- `GET /api/download/movie/:tmdbId` - Resolve movie stream URL
- `GET /api/download/tv/:tmdbId/:season/:episode` - Resolve TV series episode stream URL
- `GET /api/proxy?url=...` - Stream proxy with headers

## Setup & Run

```bash
npm install
npm start
```
