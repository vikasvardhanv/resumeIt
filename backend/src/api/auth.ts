import { Router, type Request, type Response } from 'express'
import passport from 'passport'
import { requireAuth } from '../middleware/authMiddleware.js'
import { type AuthRequest } from '../types/auth'
import { prisma } from '../config/prisma.js'
import { recordLoginActivity } from '../services/loginActivityService.js'
import { logger } from '../utils/logger.js'

export const authRouter = Router()

// Google OAuth routes
authRouter.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
)

authRouter.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  async (req: AuthRequest, res: Response) => {
    // Successful authentication
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

    if (req.user) {
      await recordLoginActivity(req.user.id, 'google-oauth', {
        via: 'web',
        userAgent: req.headers['user-agent']
      })
    }

    res.redirect(`${frontendUrl}/dashboard?auth=success`)
  }
)

// Chrome Extension Google Token Verification
authRouter.post('/google/verify', async (req: AuthRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const token = authHeader.split(' ')[1]

    // Development mode: Skip database if not available
    const isDevelopment = process.env.NODE_ENV === 'development'

    // Verify the token with Google
    const response = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${token}`)

    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const googleUser = await response.json() as {
      id: string
      email: string
      name: string
      picture?: string
    }

    let user: any

    // Try to use database if available, fall back to mock user in development
    try {
      // Find or create user in database
      user = await prisma.user.findUnique({
        where: { googleId: googleUser.id },
        include: { subscription: true }
      })

      if (!user) {
        // Create new user with free subscription
        user = await prisma.user.create({
          data: {
            googleId: googleUser.id,
            email: googleUser.email,
            name: googleUser.name,
            picture: googleUser.picture,
            subscription: {
              create: {
                status: 'ACTIVE',
                plan: 'free'
              }
            }
          },
          include: { subscription: true }
        })
      }
    } catch (dbError) {
      logger.warn({ error: dbError }, 'Database not available, using development mode')

      // Development mode: Use mock user if database is not available
      if (isDevelopment) {
        user = {
          id: `dev-${googleUser.id}`,
          googleId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          picture: googleUser.picture,
          subscription: {
            id: 'dev-sub',
            plan: 'free',
            status: 'ACTIVE',
            userId: `dev-${googleUser.id}`,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            currentPeriodEnd: null,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
        logger.info({ email: googleUser.email }, 'Development mode: Using mock user')
      } else {
        throw dbError
      }
    }

    // Create session
    req.login(user, (err) => {
      if (err) {
        logger.error({ error: err }, 'Session creation failed')
        return res.status(500).json({ error: 'Session creation failed' })
      }

      recordLoginActivity(user!.id, 'google-token', {
        via: 'extension',
        userAgent: req.headers['user-agent'],
        scope: req.body.scope
      }).catch((activityError) => {
        logger.warn({ error: activityError }, 'Failed to record login activity')
      })

      res.json({
        authenticated: true,
        user: {
          id: user!.id,
          email: user!.email,
          name: user!.name,
          picture: user!.picture,
          subscription: {
            plan: user!.subscription?.plan || 'free',
            status: user!.subscription?.status
          }
        }
      })
    })
  } catch (error) {
    logger.error({ error }, 'Token verification failed')
    res.status(500).json({ error: 'Token verification failed' })
  }
})

// Check authentication status
authRouter.get('/me', requireAuth, (req: AuthRequest, res: Response) => {
  const user = req.user!
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    subscription: user.subscription
  })
})

// Logout
authRouter.post('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' })
    }
    res.json({ message: 'Logged out successfully' })
  })
})

// Check if user is authenticated (for extension)
authRouter.get('/status', async (req: AuthRequest, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.json({
      authenticated: false,
      user: null
    })
  }

  // Fetch fresh user data from database
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { subscription: true }
  })

  if (!user) {
    return res.json({
      authenticated: false,
      user: null
    })
  }

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      subscription: {
        plan: user.subscription?.plan || 'free',
        status: user.subscription?.status
      }
    }
  })
})

authRouter.get('/logins/history', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const history = await prisma.loginActivity.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 20
    })

    res.json(history)
  } catch (error) {
    logger.error({ error, userId: req.user!.id }, 'Failed to fetch login history')
    res.status(500).json({ error: 'Failed to load login history' })
  }
})
