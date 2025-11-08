import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { prisma } from './prisma.js'

export function configureAuth () {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL:
          process.env.GOOGLE_CALLBACK_URL ||
          `${process.env.API_BASE_URL || 'https://resumeit-cdqp.onrender.com'}/api/v1/auth/google/callback`,
        scope: ['profile', 'email']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value
          if (!email) {
            done(new Error('No email found in Google profile'), false); return
          }

          let user = await prisma.user.findUnique({
            where: { googleId: profile.id },
            include: { subscription: true }
          })

          if (!user) {
            // Create new user
            user = await prisma.user.create({
              data: {
                googleId: profile.id,
                email,
                name: profile.displayName || 'User',
                picture: profile.photos?.[0]?.value,
                subscription: {
                  create: {
                    status: 'ACTIVE',
                    plan: 'free'
                  }
                }
              },
              include: { subscription: true }
            })
          } else {
            // Update existing user info
            user = await prisma.user.update({
              where: { id: user.id },
              data: {
                name: profile.displayName || user.name,
                picture: profile.photos?.[0]?.value || user.picture
              },
              include: { subscription: true }
            })
          }

          done(null, {
            ...user,
            picture: user.picture || undefined
          } as any)
        } catch (error) {
          console.error('Auth error:', error)
          done(error, false)
        }
      }
    )
  )

  passport.serializeUser((user: any, done) => {
    done(null, user.id)
  })

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        include: { subscription: true }
      })
      done(null, user
        ? {
            ...user,
            picture: user.picture || undefined
          } as any
        : null)
    } catch (error) {
      done(error, null)
    }
  })
}
