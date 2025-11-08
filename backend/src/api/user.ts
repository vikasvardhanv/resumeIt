import { Router, type Response } from 'express'
import { requireAuth } from '../middleware/authMiddleware.js'
import { type AuthRequest } from '../types/auth'
import { prisma } from '../config/prisma.js'

export const userRouter = Router()

// Get user profile
userRouter.get('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        subscription: true,
        _count: {
          select: {
            resumes: true,
            tailorings: true
          }
        }
      }
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      subscription: user.subscription,
      stats: {
        resumes: user._count.resumes,
        tailorings: user._count.tailorings
      },
      createdAt: user.createdAt
    })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ error: 'Failed to get profile' })
  }
})

// Get user's resumes
userRouter.get('/resumes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const resumes = await prisma.resume.findMany({
      where: { userId: req.user!.id },
      include: {
        _count: {
          select: { tailorings: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json(resumes.map((resume: any) => ({
      id: resume.id,
      name: resume.name,
      size: resume.size,
      mimeType: resume.mimeType,
      tailorings: resume._count.tailorings,
      createdAt: resume.createdAt,
      updatedAt: resume.updatedAt
    })))
  } catch (error) {
    console.error('Get resumes error:', error)
    res.status(500).json({ error: 'Failed to get resumes' })
  }
})

// Get user's tailoring history
userRouter.get('/tailorings', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)
    const skip = (page - 1) * limit

    const [tailorings, total] = await Promise.all([
      prisma.tailoring.findMany({
        where: { userId: req.user!.id },
        include: {
          resume: {
            select: { name: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.tailoring.count({
        where: { userId: req.user!.id }
      })
    ])

    res.json({
      tailorings: tailorings.map((t: any) => ({
        id: t.id,
        jobTitle: t.jobTitle,
        jobCompany: t.jobCompany,
        matchScore: t.matchScore,
        resumeName: t.resume.name,
        createdAt: t.createdAt
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Get tailorings error:', error)
    res.status(500).json({ error: 'Failed to get tailorings' })
  }
})

// Get specific tailoring result
userRouter.get('/tailorings/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const tailoring = await prisma.tailoring.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id
      },
      include: {
        resume: {
          select: { name: true }
        }
      }
    })

    if (!tailoring) {
      return res.status(404).json({ error: 'Tailoring not found' })
    }

    res.json(tailoring)
  } catch (error) {
    console.error('Get tailoring error:', error)
    res.status(500).json({ error: 'Failed to get tailoring' })
  }
})

// Update user profile
userRouter.patch('/profile', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required' })
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { name },
      include: { subscription: true }
    })

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      subscription: user.subscription
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Delete user account
userRouter.delete('/account', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.user.delete({
      where: { id: req.user!.id }
    })

    res.json({ message: 'Account deleted successfully' })
  } catch (error) {
    console.error('Delete account error:', error)
    res.status(500).json({ error: 'Failed to delete account' })
  }
})
