import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import session from 'express-session'
import passport from 'passport'
import pino from 'pino'
import pinoHttp from 'pino-http'
// Import routes
import { analyzeJobRouter } from './api/analyzeJob.js'
import { authRouter } from './api/auth.js'
import { userRouter } from './api/user.js'
import { subscriptionRouter } from './api/subscription.js'
import { globalRateLimiter } from './middleware/rateLimit.js'
import { configureAuth } from './config/auth.js'
import { prisma } from './config/prisma.js'

const app = express()
const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
})

// Configure authentication
configureAuth()

// Middleware
app.set('trust proxy', 1)
app.use(pinoHttp({ logger }))
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}))

// CORS configuration for Chrome extension
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    const isAllowed = allowedOrigins.some(allowed => origin.startsWith(allowed))
    if (isAllowed || process.env.NODE_ENV !== 'production') {
      callback(null, true)
      return
    }

    callback(new Error('Origin not allowed by CORS policy'))
  },
  credentials: true,
  exposedHeaders: ['set-cookie']
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Session configuration
// For Chrome extension compatibility in development:
// - sameSite must be 'none' for cross-origin requests
// - But 'none' requires secure: true (HTTPS)
// - For localhost HTTP, we temporarily disable sameSite restrictions
const isProduction = process.env.NODE_ENV === 'production'

app.use(session({
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'resumeit-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'resumeit.sid',
  cookie: {
    secure: isProduction, // true only in production with HTTPS
    httpOnly: true,
    sameSite: isProduction ? 'none' : false, // Disable sameSite in development
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}))

// Passport middleware
app.use(passport.initialize())
app.use(passport.session())

// Rate limiting
app.use(globalRateLimiter)

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

// API routes
app.use('/api/v1/auth', authRouter)
app.use('/api/v1/user', userRouter)
app.use('/api/v1/analyze-job', analyzeJobRouter)
app.use('/api/v1/subscription', subscriptionRouter)

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'ResumeIt API',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/docs',
    endpoints: {
      auth: '/api/v1/auth',
      user: '/api/v1/user',
      analyzeJob: '/api/v1/analyze-job',
      subscription: '/api/v1/subscription'
    }
  })
})

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err, req: req.url }, 'Unhandled error')

  if (process.env.NODE_ENV === 'development') {
    res.status(err.status || 500).json({
      error: err.message,
      stack: err.stack
    })
  } else {
    res.status(err.status || 500).json({
      error: 'Internal Server Error'
    })
  }
})

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

const port = process.env.PORT || 4000

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully')
  await prisma.$disconnect()
  process.exit(0)
})

app.listen(port, () => {
  logger.info({ port }, 'Server started successfully')
})
