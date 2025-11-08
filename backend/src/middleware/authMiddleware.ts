import { type Request, type Response, type NextFunction } from 'express'
import { prisma } from '../config/prisma.js'

export interface AuthRequest extends Request {
  user?: any
}

export function requireAuth (req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({
      error: 'Authentication required',
      loginUrl: '/auth/google'
    })
  }
  next()
}

export function requirePremium (req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({
      error: 'Authentication required',
      loginUrl: '/auth/google'
    })
  }

  const user = req.user
  if (!user.subscription || user.subscription.plan === 'free') {
    return res.status(403).json({
      error: 'Premium subscription required',
      upgradeUrl: '/upgrade'
    })
  }

  if (user.subscription.status !== 'ACTIVE' && user.subscription.status !== 'TRIALING') {
    return res.status(403).json({
      error: 'Active subscription required',
      upgradeUrl: '/upgrade'
    })
  }

  next()
}

export async function checkUsageLimit (req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    next(); return
  }

  const user = req.user

  // Premium users have unlimited usage
  if (user.subscription?.plan === 'premium') {
    next(); return
  }

  // Development mode: Skip database check if not available
  const isDevelopment = process.env.NODE_ENV === 'development'

  try {
    // Check free tier limits
    const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM

    const usage = await prisma.usageLimit.findUnique({
      where: {
        userId: user.id
      }
    })

    const monthlyLimit = 5 // Free tier limit

    if (usage && usage.month === currentMonth && usage.tailorings >= monthlyLimit) {
      return res.status(429).json({
        error: 'Monthly limit reached',
        message: `You've reached your limit of ${monthlyLimit} resume tailorings this month.`,
        upgradeUrl: '/upgrade'
      })
    }
  } catch (dbError) {
    console.warn('Database not available for usage check:', dbError)

    // In development, allow unlimited usage if database is down
    if (isDevelopment) {
      console.log('✅ Development mode: Skipping usage limit check')
      next(); return
    }

    // In production, fail securely
    return res.status(500).json({
      error: 'Service temporarily unavailable',
      message: 'Unable to check usage limits'
    })
  }

  next()
}
