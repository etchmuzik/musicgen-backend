# MusicGen AI Backend API

Node.js/Express backend API for MusicGen AI iOS app. Provides Suno API proxy, Supabase integration, and credit management.

## Features

- 🔐 Supabase Authentication
- 🎵 Suno API Proxy (hides API key from client)
- 💳 Credit & Subscription Management
- 📊 User Profile & Track Management
- 🔒 Rate Limiting & Security
- 📡 Public Feed API
- 🎸 Watermark-free commercial music generation

## Prerequisites

- Node.js 18+
- Supabase instance (already deployed via Coolify)
- Suno API key (from sunoapi.org)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Update with your actual values:
- `SUPABASE_SERVICE_KEY` - Get from Coolify Supabase environment variables
- `SUNO_API_KEY` - Your Suno API key from sunoapi.org

### 3. Build & Run Locally

```bash
# Build TypeScript
npm run build

# Start server
npm start

# Or run in development mode
npm run dev
```

Server will start on http://localhost:3000

## Deploy to Coolify

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial backend API"
git remote add origin https://github.com/yourusername/musicgen-api.git
git push -u origin main
```

### 2. Deploy in Coolify

1. Open Coolify Dashboard
2. **+ New Application**
3. **Source:** Connect your GitHub repo
4. **Build Pack:** Dockerfile (auto-detected)
5. **Environment Variables:** Copy from `.env.example` and fill in secrets
6. **Domain:** Set your API domain (e.g., `api-musicgen.yourdomain.com`)
7. Click **Deploy**

Coolify will handle:
- Docker build
- SSL certificate
- Reverse proxy
- Auto-restart

## API Endpoints

### Health Check
```
GET /health
```

### Music Generation
```
POST /api/generate-music
Authorization: Bearer <supabase-token>

Body:
{
  "genre": "Techno",
  "mood": "Energetic",
  "prompt": "Heavy bass",
  "duration": 30,
  "isInstrumental": true,
  "customLyrics": null
}

Response:
{
  "success": true,
  "task_id": "abc123",
  "remaining_credits": 49
}
```

### Check Task Status
```
GET /api/task/:taskId
Authorization: Bearer <supabase-token>
```

### Save Track
```
POST /api/tracks
Authorization: Bearer <supabase-token>

Body:
{
  "title": "My Track",
  "genre": "Techno",
  "mood": "Energetic",
  "audio_url": "https://...",
  "duration": 30,
  ...
}
```

### Get User Tracks
```
GET /api/tracks
Authorization: Bearer <supabase-token>
```

### Get Profile
```
GET /api/profile
Authorization: Bearer <supabase-token>
```

### Update Profile
```
PATCH /api/profile
Authorization: Bearer <supabase-token>

Body:
{
  "display_name": "New Name"
}
```

### Public Feed
```
GET /api/feed
# No auth required
```

### Publish Track
```
POST /api/tracks/:trackId/publish
Authorization: Bearer <supabase-token>
```

### Like/Unlike Track
```
POST /api/tracks/:trackId/like
Authorization: Bearer <supabase-token>
```

## Security

- ✅ Helmet for security headers
- ✅ CORS enabled
- ✅ Rate limiting (100 requests per 15 minutes)
- ✅ Supabase JWT validation
- ✅ PiAPI key server-side only
- ✅ Row Level Security via Supabase

## Monitoring

Check logs in Coolify dashboard:
```
Coolify → Your App → Logs
```

## Troubleshooting

### "No token provided"
- Ensure iOS app sends `Authorization: Bearer <token>` header
- Token must be valid Supabase JWT

### "Invalid token"
- Token may be expired
- User may need to re-authenticate

### "Daily limit reached"
- User hit daily generation limit for their plan
- Limits: Free (2), Starter (10), Pro (25), Unlimited (100)

### Suno API errors
- Check SUNO_API_KEY is correct
- Verify Suno API service is operational (sunoapi.org)
- Check logs for detailed error messages
- Ensure sufficient credits in your Suno account

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (auto-reload)
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start
```

## License

MIT
