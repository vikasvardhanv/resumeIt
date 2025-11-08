import type { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import type { AuthRequest } from '../types/auth.js'

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((value ?? '').split(/[\s#]/)[0] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const globalWindowMs = parsePositiveInt(process.env.RATE_LIMIT_WINDOW_MS, 900_000)
const globalLimit = parsePositiveInt(process.env.RATE_LIMIT_MAX_REQUESTS, 300)
const analyzeLimit = parsePositiveInt(process.env.ANALYZE_JOB_RATE_LIMIT_MAX, 10)
const analyzeWindowMs = parsePositiveInt(process.env.ANALYZE_JOB_RATE_LIMIT_WINDOW_MS, globalWindowMs)

const build429Handler = (message: string) => (req: Request, res: Response): void => {
  res.status(429).json({
    error: 'Rate limit exceeded',
    detail: message
  })
}

const perUserKeyGenerator = (req: Request): string => {
  const authReq = req as AuthRequest
  if (authReq.user?.id) {
    return `user:${authReq.user.id}`
  }
  return `ip:${req.ip ?? 'unknown'}`
}

export const globalRateLimiter = rateLimit({
  windowMs: globalWindowMs,
  limit: globalLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: build429Handler('Global request rate limit exceeded. Please wait a moment before trying again.')
})

export const analyzeJobLimiter = rateLimit({
  windowMs: analyzeWindowMs,
  limit: analyzeLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: perUserKeyGenerator,
  handler: build429Handler('Resume tailoring request limit reached for your account. Please wait a few minutes or upgrade your plan.')
})
