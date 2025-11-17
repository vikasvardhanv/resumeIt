# ResumeIt

AI-powered Chrome extension that automatically tailors your résumé to match job postings. Built with TypeScript, Express, Prisma, and modern AI providers.

**🚀 Production Ready:** All dependencies updated, no deprecation warnings  
**📚 Complete Guide:** See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for deployment  
**🌐 Landing Page:** [LANDING_PAGE_SETUP.md](./LANDING_PAGE_SETUP.md)

---

## Features

- 🤖 **AI-Powered Tailoring** - Automatically customize résumés for specific job postings
- 🔐 **Google OAuth Authentication** - Secure login with Google accounts
- 📊 **Usage Tracking** - Monitor API usage and enforce rate limits
- 💳 **Premium Tiers** - Stripe integration for paid subscriptions (optional)
- 🔄 **Smart LLM Routing** - Gemini (free) → OpenAI (paid) fallback
- 🌐 **Chrome Extension** - Seamless browser integration
- 📝 **Login Auditing** - Track authentication events for security

---

## Quick Start

### Prerequisites

- Node.js 18+ and npm 10+
- PostgreSQL 14+ (or Railway/Render managed)
- Chrome browser
- [Google Gemini API key](https://aistudio.google.com/app/apikey) (FREE tier)
- [OpenAI API key](https://platform.openai.com/api-keys) (fallback)
- [Google OAuth credentials](https://console.cloud.google.com)

### Local Development

1. **Clone and setup backend**
   ```bash
   git clone https://github.com/vikasvardhanv/resumeIt.git
   cd resumeIt/backend
   npm install
   cp .env.example .env
   # Edit .env with your API keys
   ```

2. **Generate secrets**
   ```bash
   # Generate JWT and session secrets
   openssl rand -base64 64
   ```

3. **Run database migrations**
   ```bash
   npx prisma migrate dev
   ```

4. **Start backend**
   ```bash
   npm run dev
   # Backend runs at http://localhost:4000
   ```

5. **Setup and build extension**
   ```bash
   cd ../extension
   npm install
   API_BASE_URL=http://localhost:4000 npm run dev
   ```

6. **Load extension in Chrome**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select `extension/dist/` folder

---

## Production Deployment (Render)

### One-Click Deploy

1. Push code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect your repository  
4. Set required environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `BYTEZ_API_KEY`
   - `CHROME_EXTENSION_ID`
   - `ALLOWED_ORIGINS`
5. Deploy!

**Complete guide:** [RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md)

---

## Project Structure

```
resumeIt/
├── backend/                # Express API
│   ├── src/
│   │   ├── api/           # Route handlers
│   │   ├── services/      # Business logic (LLM, auth, etc.)
│   │   ├── middleware/    # Auth, rate limiting
│   │   ├── utils/         # Logger, helpers
│   │   └── server.ts      # Entry point
│   ├── prisma/            # Database schema & migrations
│   └── .env.example       # Environment template
├── extension/             # Chrome extension
│   ├── src/
│   │   ├── background/    # Service worker
│   │   ├── popup/         # Extension UI
│   │   └── content/       # Content scripts
│   └── manifest.json      # Extension manifest
├── landing/               # Landing page (static site)
│   ├── index.html         # Main page
│   ├── styles.css         # Styles
│   ├── script.js          # JavaScript
│   └── README.md          # Landing page docs
├── render.yaml            # Render deployment config
├── docker-compose.yml     # Local dev stack
├── README.md              # This file
└── RENDER_DEPLOYMENT.md   # Deployment guide
```

---

## Environment Configuration

Key environment variables (see `backend/.env.example` for complete list):

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/resumeit

# Security (generate with: openssl rand -base64 64)
JWT_SECRET=your_secret_here
JWT_REFRESH_SECRET=your_secret_here
SESSION_SECRET=your_secret_here

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Sessions / Caching
REDIS_URL=redis://:<password>@redis-host:6379

# AI Provider Routing
PRIMARY_LLM_PROVIDER=groq
FALLBACK_1_PROVIDER=gemini
FALLBACK_2_PROVIDER=openai
FALLBACK_3_PROVIDER=together
LLM_PROVIDER_CHAIN=groq,gemini,openai,together
GROQ_DAILY_LIMIT=14000
LLM_PROVIDER_COOLDOWN_MS=15000
# Optional fallback credentials
GEMINI_API_KEY=...
GEMINI_MODEL=models/gemini-1.5-flash
TOGETHER_API_KEY=together_key
OPENAI_API_KEY=sk-your-openai-key

# Extension Premium Redirect
PREMIUM_REDIRECT_URL=https://resumeit.ai/premium?source=extension

# CORS
ALLOWED_ORIGINS=chrome-extension://your-extension-id

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100
```

---

## AI Provider Options

**Primary (Free & Fast) — Groq**
```bash
PRIMARY_LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key
GROQ_MODEL=llama-3.1-8b-instant
```

**Fallback 1 (Free, higher limits) — Google Gemini**
```bash
FALLBACK_1_PROVIDER=gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=models/gemini-1.5-flash
```

**Fallback 2 (Paid, most reliable) — OpenAI**
```bash
FALLBACK_2_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4o-mini
```

**Fallback 3 (High throughput) — Together AI**
```bash
FALLBACK_3_PROVIDER=together
TOGETHER_API_KEY=together_your_key
TOGETHER_MODEL=meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo
```

**Routing Strategy**
- Default chain: `groq → gemini → openai → together`.
- Groq handles up to `GROQ_DAILY_LIMIT` requests/day (14k by default). Once reached, we automatically move to Gemini.
- Any provider that rate-limits or errors is placed on cooldown for `LLM_PROVIDER_COOLDOWN_MS` (15s default) before being considered again.
- Override the order or add/remove providers with `LLM_PROVIDER_CHAIN` (comma-separated) without changing code.

---

## API Endpoints

- `GET /health` - Health check
- `POST /api/v1/auth/google/verify` - Verify Google OAuth token
- `GET /api/v1/auth/logins/history` - Get login history
- `GET /api/v1/user/profile` - Get user profile
- `POST /api/v1/analyze-job` - Analyze job and tailor résumé
- `GET /api/v1/subscription/status` - Get subscription status

---

## Development Commands

### Backend
```bash
cd backend
npm run dev          # Start with hot reload
npm run build        # Build for production
npm run start        # Run production build
npm run typecheck    # TypeScript validation
npm run lint         # ESLint check
npx prisma studio    # Open database GUI
```

### Extension
```bash
cd extension
npm run dev          # Build for development
npm run build        # Build for production
npm run typecheck    # TypeScript validation
```

### Docker
```bash
docker compose up    # Start PostgreSQL + backend
```

---

## Publishing Extension

1. **Build for production**
   ```bash
   cd extension
   API_BASE_URL=https://your-api.onrender.com npm run build
   ```

2. **Update manifest.json**
   - Replace `oauth2.client_id` with production Chrome App client ID
   - Verify `host_permissions`

3. **Create ZIP and upload**
   ```bash
   cd dist && zip -r ../extension.zip * && cd ..
   ```
   Upload to [Chrome Web Store](https://chrome.google.com/webstore/devconsole)

4. **Update backend**
   Add extension ID to `ALLOWED_ORIGINS` in Render dashboard

---

## Troubleshooting

**CORS Errors**
- Add Chrome extension ID to `ALLOWED_ORIGINS`
- Format: `chrome-extension://your-extension-id`

**OAuth Fails**
- Check Google Cloud Console credentials
- Ensure redirect URIs match backend URL
- Use "Chrome App" client type for extension

**Database Connection Issues**
- Use Internal Database URL (not External) on Render
- Verify database and service are in same region

**AI Provider Errors**
- Verify each provider key (Groq, Gemini, OpenAI, Together) is present and valid
- Monitor per-provider limits (Groq free tier ~14k/day, Gemini generous but rate-limited, Together/OpenAI bill per token)
- If a provider starts rate-limiting, the service automatically enters cooldown and falls through the chain—extend the chain or adjust `LLM_PROVIDER_COOLDOWN_MS` if needed

**Cold Starts (Free Tier)**
- Free tier spins down after 15min inactivity
- First request takes ~30s to wake
- Upgrade to Starter ($7/mo) to eliminate

---

## Tech Stack

**Backend:**
- Node.js + TypeScript
- Express.js
- Prisma ORM
- PostgreSQL
- Passport.js (Google OAuth)
- Pino (Logging)
- Stripe (Payments)

**Extension:**
- TypeScript
- Chrome Extension API (Manifest V3)
- esbuild

**AI/LLM:**
- Groq (Primary free tier)
- Google Gemini, OpenAI, Together AI fallbacks
- Hugging Face / OpenRouter (optional legacy providers)

**Deployment:**
- Render (Production)
- Docker (Local development)

---

## License

MIT

---

## Support

- **Deployment:** [RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md)
- **Issues:** [GitHub Issues](https://github.com/vikasvardhanv/resumeIt/issues)
- **Environment:** See `backend/.env.example`

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Submit a pull request

---

Made with ❤️ for job seekers
