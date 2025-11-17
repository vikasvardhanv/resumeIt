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
    console.log('⚠️  [USAGE LIMIT] Skipping check - user not authenticated')
    next(); return
  }

  const user = req.user

  // Premium users have unlimited usage
  if (user.subscription?.plan === 'premium') {
    console.log(`✅ [USAGE LIMIT] Premium user ${user.email} - unlimited access`)
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

    const monthlyLimit = parseInt(process.env.FREE_TIER_MONTHLY_LIMIT || '100') // Free tier limit (100 for testing)
    const currentUsage = (usage && usage.month === currentMonth) ? usage.tailorings : 0

    console.log(`📊 [USAGE LIMIT] Free tier check for ${user.email}:`)
    console.log(`   Month: ${currentMonth}`)
    console.log(`   Usage: ${currentUsage}/${monthlyLimit}`)
    console.log(`   Remaining: ${monthlyLimit - currentUsage}`)

    if (usage && usage.month === currentMonth && usage.tailorings >= monthlyLimit) {
      console.warn(`🚫 [USAGE LIMIT] Monthly limit exceeded for ${user.email}`)
      return res.status(429).json({
        error: 'Monthly limit reached',
        message: `You've reached your limit of ${monthlyLimit} resume tailorings this month.`,
        detail: `Usage: ${usage.tailorings}/${monthlyLimit} for ${currentMonth}`,
        upgradeUrl: '/upgrade'
      })
    }

    console.log(`✅ [USAGE LIMIT] Within limits - allowing request`)
  } catch (dbError) {
    console.warn('⚠️  [USAGE LIMIT] Database error:', dbError)

    // In development, allow unlimited usage if database is down
    if (isDevelopment) {
      console.log('✅ [USAGE LIMIT] Development mode: Bypassing check')
      next(); return
    }

    // In production, fail securely
    console.error('❌ [USAGE LIMIT] Production mode: Blocking request due to DB error')
    return res.status(500).json({
      error: 'Service temporarily unavailable',
      message: 'Unable to check usage limits'
    })
  }

  next()
}
