import { Router, type Response } from 'express'
import { z } from 'zod'
import multer from 'multer'
import crypto from 'crypto'
import { generateTailored } from '../services/llmService.js'
import { parseResume } from '../services/resumeParser.js'
import { requireAuth, checkUsageLimit } from '../middleware/authMiddleware.js'
import { analyzeJobLimiter } from '../middleware/rateLimit.js'
import { type AuthRequest } from '../types/auth'
import { prisma } from '../config/prisma.js'

export const analyzeJobRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
})

const JobPostingPayloadSchema = z.object({
  title: z.string().min(2),
  company: z.string().optional(),
  location: z.string().optional(),
  description: z.string().min(30),
  requirements: z.array(z.string().min(3)).optional(),
  source: z.string().optional(),
  pageUrl: z.string().url().optional(),
  hash: z.string().min(6).optional()
})

type JobPostingPayload = z.infer<typeof JobPostingPayloadSchema>

interface NormalizedJob {
  title: string
  company?: string
  location?: string
  description: string
  requirements: string[]
  source: string
  pageUrl?: string
  hash: string
}

analyzeJobRouter.post('/', requireAuth, analyzeJobLimiter, checkUsageLimit, upload.single('resume'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Resume file is required' })
    }
    if (!req.body.jobPosting) {
      return res.status(400).json({ success: false, error: 'Job posting data is required' })
    }

    const parsedResume = await parseResume(req.file.buffer)
    const resumeText = normalizeResumeText(parsedResume.text)

    let jobPayload: JobPostingPayload
    try {
      const raw = typeof req.body.jobPosting === 'string' ? JSON.parse(req.body.jobPosting) : req.body.jobPosting
      jobPayload = JobPostingPayloadSchema.parse(raw)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: 'Invalid job posting payload', details: error.issues })
      }
      return res.status(400).json({ success: false, error: 'Unable to parse job posting payload' })
    }

    const job = normalizeJobPayload(jobPayload)
    const jobPrompt = buildJobPrompt(job)

    const result = await generateTailored(jobPrompt, resumeText)

    // Save resume and tailoring to database
    const user = req.user!
    const isDevelopment = process.env.NODE_ENV === 'development'

    let tailoringId = `dev-${Date.now()}`

    try {
      // Save resume if not exists
      let resumeRecord = await prisma.resume.findFirst({
        where: {
          userId: user.id,
          name: req.file.originalname,
          size: req.file.size
        }
      })

      if (!resumeRecord) {
        resumeRecord = await prisma.resume.create({
          data: {
            userId: user.id,
            name: req.file.originalname,
            content: req.file.buffer.toString('base64'),
            mimeType: req.file.mimetype,
            size: req.file.size
          }
        })
      }

      // Save tailoring result
      const tailoring = await prisma.tailoring.create({
        data: {
          userId: user.id,
          resumeId: resumeRecord.id,
          jobTitle: job.title,
          jobCompany: job.company,
          jobDescription: job.description,
          result: result as any,
          matchScore: result.match_score
        }
      })

      tailoringId = tailoring.id

      // Update usage tracking
      const currentMonth = new Date().toISOString().slice(0, 7)
      await prisma.usageLimit.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          tailorings: 1,
          month: currentMonth
        },
        update: {
          tailorings: { increment: 1 },
          month: currentMonth
        }
      })
    } catch (dbError) {
      console.warn('Database not available, skipping save:', dbError)
      if (isDevelopment) {
        console.log('✅ Development mode: Returning results without database save')
      } else {
        // In production, we want to know about database issues
        throw dbError
      }
    }

    res.json({
      success: true,
      id: tailoringId,
      job,
      resume: result.resume,
      tailored: result.tailored,
      match_score: result.match_score,
      competitive_analysis: result.competitive_analysis,
      application_strategy: result.application_strategy,
      projects: result.projects,
      metadata: {
        resume_format: parsedResume.format,
        resume_characters: resumeText.length,
        job_characters: jobPrompt.length
      }
    })
  } catch (error) {
    console.error('❌ Analyze job error:', error)

    const errorMessage = (error as Error).message || 'Unknown error'

    // Handle specific error types with proper status codes
    if (errorMessage.includes('HF_TOKEN') || errorMessage.includes('GROQ_API_KEY') || errorMessage.includes('API token')) {
      return res.status(500).json({
        success: false,
        error: 'AI service configuration error',
        detail: errorMessage
      })
    }

    if (errorMessage.includes('Rate limit')) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        detail: errorMessage
      })
    }

    if (errorMessage.includes('loading') || errorMessage.includes('busy')) {
      return res.status(503).json({
        success: false,
        error: 'AI service temporarily unavailable',
        detail: errorMessage
      })
    }

    if (errorMessage.includes('internet') || errorMessage.includes('connect')) {
      return res.status(503).json({
        success: false,
        error: 'Cannot connect to AI service',
        detail: errorMessage
      })
    }

    // Generic error
    res.status(500).json({
      success: false,
      error: 'Tailoring failed',
      detail: errorMessage
    })
  }
})

function normalizeJobPayload (payload: JobPostingPayload): NormalizedJob {
  const description = normalizeJobDescription(payload.description)
  const requirements = (payload.requirements ?? [])
    .map((req) => req.replace(/\s+/g, ' ').trim())
    .filter((req) => req.length > 0)
    .slice(0, 12)

  const hash = payload.hash && payload.hash.length >= 6
    ? payload.hash
    : createJobHash(payload.title, payload.company, description)

  const source = (payload.source?.trim() || safeHostname(payload.pageUrl) || 'unknown').toLowerCase()

  return {
    title: payload.title.trim(),
    company: payload.company?.trim() || undefined,
    location: payload.location?.trim() || undefined,
    description,
    requirements,
    source,
    pageUrl: payload.pageUrl,
    hash
  }
}

function buildJobPrompt (job: NormalizedJob): string {
  const lines = [
    `Job Title: ${job.title}`,
    job.company ? `Company: ${job.company}` : undefined,
    job.location ? `Location: ${job.location}` : undefined,
    `Source: ${job.source}`,
    job.pageUrl ? `Posting URL: ${job.pageUrl}` : undefined,
    '',
    'Core Description:',
    job.description
  ]

  if (job.requirements.length > 0) {
    lines.push('', 'Key Requirements:', ...job.requirements.map((req) => `- ${req}`))
  }

  const prompt = lines.filter(Boolean).join('\n')
  return prompt.length > 8000 ? `${prompt.slice(0, 7990)}…` : prompt
}

function normalizeResumeText (text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u2022/g, '•')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, 8000)
}

function normalizeJobDescription (text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000)
}

function safeHostname (url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function createJobHash (title: string, company: string | undefined, description: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(title.trim())
  if (company) hash.update(company.trim())
  hash.update(description.slice(0, 1024))
  return hash.digest('hex').slice(0, 32)
}
