import type { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import type { AuthRequest } from '../types/auth.js'
import { logger } from '../utils/logger.js'

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((value ?? '').split(/[\s#]/)[0] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const globalWindowMs = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 900_000)
const globalLimit = parsePositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 300)
const analyzeLimit = parsePositiveInt(process.env.ANALYZE_JOB_RATE_LIMIT_MAX, 10)
const analyzeWindowMs = parsePositiveInt(process.env.ANALYZE_JOB_RATE_LIMIT_WINDOW_MS, globalWindowMs)

// Log rate limit configuration on startup
logger.info({
  globalWindowMs,
  globalLimit,
  analyzeLimit,
  analyzeWindowMs
}, '🚦 Rate limit configuration loaded')

const build429Handler = (message: string, limitType: string) => (req: Request, res: Response): void => {
  const authReq = req as AuthRequest
  const userInfo = authReq.user?.id ? `user:${authReq.user.id}` : `ip:${req.ip}`

  logger.warn({
    limitType,
    userInfo,
    path: req.path,
    method: req.method,
    message
  }, `🚫 Rate limit exceeded: ${limitType}`)

  res.status(429).json({
    error: 'Rate limit exceeded',
    detail: message
  })
}

const perUserKeyGenerator = (req: Request): string => {
  const authReq = req as AuthRequest
  const key = authReq.user?.id ? `user:${authReq.user.id}` : `ip:${req.ip ?? 'unknown'}`

  logger.debug({
    key,
    userId: authReq.user?.id,
    ip: req.ip,
    path: req.path
  }, '🔑 Generated rate limit key')

  return key
}

// Add skip function to log successful requests
const skipSuccessfulRequest = (req: Request, res: Response): boolean => {
  const authReq = req as AuthRequest
  logger.debug({
    path: req.path,
    method: req.method,
    user: authReq.user?.id,
    statusCode: res.statusCode
  }, '✅ Request passed rate limit check')
  return false // Don't skip, allow the request
}

export const globalRateLimiter = rateLimit({
  windowMs: globalWindowMs,
  limit: globalLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipSuccessfulRequest,
  handler: build429Handler('Global request rate limit exceeded. Please wait a moment before trying again.', 'GLOBAL')
})

export const analyzeJobLimiter = rateLimit({
  windowMs: analyzeWindowMs,
  limit: analyzeLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: perUserKeyGenerator,
  handler: build429Handler('Resume tailoring request limit reached for your account. Please wait a few minutes or upgrade your plan.', 'ANALYZE_JOB')
})

// Add a separate middleware for logging after rate limiter sets headers
export const logAnalyzeJobRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const authReq = req as AuthRequest
  const remaining = res.getHeader('RateLimit-Remaining')
  const limit = res.getHeader('RateLimit-Limit')
  const reset = res.getHeader('RateLimit-Reset')
  const resetDate = reset ? new Date(Number(reset) * 1000) : null

  logger.info({
    rateLimitType: 'ANALYZE_JOB',
    path: req.path,
    method: req.method,
    user: authReq.user?.id || 'anonymous',
    email: authReq.user?.email,
    remaining,
    limit,
    reset,
    resetDate: resetDate?.toISOString(),
    resetIn: resetDate ? `${Math.ceil((resetDate.getTime() - Date.now()) / 1000)}s` : null,
    windowMs: analyzeWindowMs,
    limitConfig: analyzeLimit
  }, `📊 [RATE LIMIT] Analyze job check - ${remaining || 'N/A'}/${limit || analyzeLimit} remaining`)

  next()
}
