# ResumeIt

AI-powered Chrome extension that automatically tailors your résumé to match job postings. Built with TypeScript, Express, Prisma, and React.

**🚀 Deploy to Render:** See [RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md) for complete deployment instructions.

---

## Features

- 🤖 **AI-Powered Tailoring** - Automatically customize résumés for specific job postings
- 🔐 **Google OAuth Authentication** - Secure login with Google accounts
- 📊 **Usage Tracking** - Monitor API usage and enforce rate limits
- 💳 **Premium Tiers** - Stripe integration for paid subscriptions (optional)
- 🔄 **Multi-Provider LLM** - Support for Groq, OpenAI, Hugging Face, OpenRouter, Bytez
- 🌐 **Chrome Extension** - Seamless browser integration
- 📝 **Login Auditing** - Track authentication events for security

---

## Quick Start

### Prerequisites

- Node.js 20.x and npm 10+
- PostgreSQL 14+ (or Docker)
- Chrome browser
- [Groq API key](https://console.groq.com) (free tier available)
- [Google OAuth credentials](https://console.cloud.google.com)

### Local Development

1. **Clone and setup backend**
   ```bash
   git clone https://github.com/vikasvardhanv/resumeIt.git
   cd resumeIt/backend
   npm install
   cp .env.example .env
   # Edit .env with your credentials
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
   - `GROQ_API_KEY`
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

# AI Provider (Groq recommended)
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here

# CORS
ALLOWED_ORIGINS=chrome-extension://your-extension-id

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100
```

---

## AI Provider Options

**Groq** (Recommended - Fast & Free Tier)
```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key
GROQ_MODEL=llama-3.1-8b-instant
```

**Alternatives:**
- OpenAI: `LLM_PROVIDER=openai` + `OPENAI_API_KEY`
- Hugging Face: `LLM_PROVIDER=huggingface` + `HF_TOKEN`
- OpenRouter: `LLM_PROVIDER=openrouter` + `OPENROUTER_API_KEY`
- Bytez: `LLM_PROVIDER=bytez` + `BYTEZ_API_KEY`

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
- Verify API key is valid
- Check rate limits (Groq free: 30 req/min)

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
- Groq (Primary)
- OpenAI, Hugging Face, OpenRouter (Alternatives)

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
