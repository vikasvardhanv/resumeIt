import OpenAI from 'openai'
import { z } from 'zod'
import axios from 'axios'
import Bytez from 'bytez.js'
import { logger } from '../utils/logger.js'

const parseEnvInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((value ?? '').split(/[\s#]/)[0] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const DEFAULT_PROVIDER_CHAIN: ApiProvider[] = ['gemini', 'openai']
const GROQ_DAILY_LIMIT = parseEnvInt(process.env.GROQ_DAILY_LIMIT, 14_000)
const PROVIDER_COOLDOWN_MS = parseEnvInt(process.env.LLM_PROVIDER_COOLDOWN_MS, 5_000)

interface ProviderUsageStats {
  count: number
  cooldownUntil?: number
}

const providerUsage: Partial<Record<ApiProvider, ProviderUsageStats>> = {}
let usageWindowKey = getUsageWindowKey()

// API Provider configuration
type ApiProvider =
  | 'huggingface'
  | 'openrouter'
  | 'groq'
  | 'bytez'
  | 'gemini'
  | 'together'
  | 'openai'

const SUPPORTED_PROVIDERS: ApiProvider[] = [
  'groq',
  'gemini',
  'together',
  'openai',
  'bytez',
  'openrouter',
  'huggingface'
]

interface ApiConfig {
  provider: ApiProvider
  apiKey: string
  baseURL: string
  model: string
}

const normalizeProvider = (value?: string): ApiProvider => {
  if (!value) return 'bytez'
  const lowered = value.trim().toLowerCase() as ApiProvider
  return SUPPORTED_PROVIDERS.includes(lowered) ? lowered : 'bytez'
}

const getProviderKeyEnvVar = (provider: ApiProvider): string => {
  switch (provider) {
    case 'bytez':
      return 'BYTEZ_API_KEY'
    case 'openrouter':
      return 'OPENROUTER_API_KEY'
    case 'groq':
      return 'GROQ_API_KEY'
    case 'together':
      return 'TOGETHER_API_KEY'
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'gemini':
      return 'GEMINI_API_KEY'
    case 'huggingface':
    default:
      return 'HF_TOKEN'
  }
}


const getApiConfig = (provider: ApiProvider): ApiConfig => {
  switch (provider) {
    case 'bytez':
      return {
        provider: 'bytez',
        apiKey: process.env.BYTEZ_API_KEY || '',
        baseURL: 'bytez',
        model: process.env.BYTEZ_MODEL || 'openai/gpt-oss-20b'
      }
    case 'openrouter':
      return {
        provider: 'openrouter',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o'
      }
    case 'groq':
      return {
        provider: 'groq',
        apiKey: process.env.GROQ_API_KEY || '',
        baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        model: process.env.GROQ_MODEL || 'mixtral-8x7b-32768'
      }
    case 'gemini':
      return {
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
        model: process.env.GEMINI_MODEL || 'models/gemini-1.5-flash'
      }
    case 'together':
      return {
        provider: 'together',
        apiKey: process.env.TOGETHER_API_KEY || '',
        baseURL: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
        model: process.env.TOGETHER_MODEL || 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo'
      }
    case 'openai':
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
      }
    case 'huggingface':
    default:
      return {
        provider: 'huggingface',
        apiKey: process.env.HF_TOKEN || '',
        baseURL: 'https://router.huggingface.co/v1',
        model: process.env.HF_MODEL || 'openai/gpt-oss-120b'
      }
  }
}

const HF_RATE_LIMIT_WINDOW_MS = parseEnvInt(process.env.HF_RATE_LIMIT_WINDOW_MS, 60_000)
const HF_MAX_REQUESTS_PER_WINDOW = parseEnvInt(process.env.HF_MAX_REQUESTS_PER_WINDOW, 8)
const HF_MAX_CONCURRENT_REQUESTS = parseEnvInt(process.env.HF_MAX_CONCURRENT_REQUESTS, 1)
const HF_RATE_LIMIT_RETRY_BASE_DELAY_MS = parseEnvInt(process.env.HF_RATE_LIMIT_RETRY_BASE_DELAY_MS, 3_000)
const HF_RATE_LIMIT_MAX_RETRIES = parseEnvInt(process.env.HF_RATE_LIMIT_MAX_RETRIES, 3)

interface HfThrottleState {
  activeRequests: number
  timestamps: number[]
}

const hfThrottleState: HfThrottleState = {
  activeRequests: 0,
  timestamps: []
}

const delay = async (ms: number): Promise<void> => await new Promise(resolve => setTimeout(resolve, ms))

const waitForHfSlot = async (): Promise<void> => {
  if (HF_MAX_REQUESTS_PER_WINDOW <= 0) {
    return
  }

  while (true) {
    const now = Date.now()
    hfThrottleState.timestamps = hfThrottleState.timestamps.filter(ts => now - ts < HF_RATE_LIMIT_WINDOW_MS)

    const withinRequestBudget = hfThrottleState.timestamps.length < HF_MAX_REQUESTS_PER_WINDOW
    const withinConcurrencyBudget = hfThrottleState.activeRequests < HF_MAX_CONCURRENT_REQUESTS

    if (withinRequestBudget && withinConcurrencyBudget) {
      hfThrottleState.timestamps.push(now)
      hfThrottleState.activeRequests++
      return
    }

    const oldestRequest = hfThrottleState.timestamps[0] ?? now
    const waitForWindow = withinRequestBudget
      ? 50
      : Math.max(50, HF_RATE_LIMIT_WINDOW_MS - (now - oldestRequest))

    const waitForConcurrency = withinConcurrencyBudget ? 50 : 75
    await delay(Math.max(waitForWindow, waitForConcurrency))
  }
}

const releaseHfSlot = (): void => {
  if (hfThrottleState.activeRequests > 0) {
    hfThrottleState.activeRequests--
  }
}

const computeRetryDelay = (attempt: number, retryAfterHeader?: string): number => {
  if (retryAfterHeader) {
    const parsedSeconds = Number.parseFloat(retryAfterHeader)
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
      return Math.max(parsedSeconds * 1000, HF_RATE_LIMIT_RETRY_BASE_DELAY_MS)
    }
  }

  const exponentialBackoff = HF_RATE_LIMIT_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = Math.floor(Math.random() * 250)
  return exponentialBackoff + jitter
}

// Create OpenAI client based on provider configuration
const createClient = (config: ApiConfig): OpenAI => {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey || 'placeholder'
  })
}

// OpenRouter specific request function
const makeOpenRouterRequest = async (prompt: string, config: ApiConfig): Promise<any> => {
  const response = await axios.post(
    `${config.baseURL}/chat/completions`,
    {
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2500
    },
    {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'HTTP-Referer': process.env.YOUR_SITE_URL || 'https://resumeit.app',
        'X-Title': process.env.YOUR_SITE_NAME || 'ResumeIt',
        'Content-Type': 'application/json'
      }
    }
  )
  
  return response.data
}

const makeBytezRequest = async (prompt: string, config: ApiConfig): Promise<string> => {
  const apiKey = config.apiKey

  if (!apiKey) {
    throw new Error('BYTEZ_API_KEY is missing. Add it to your environment before running production requests.')
  }

  const sdk = new Bytez(apiKey)
  const bytezModel = sdk.model(config.model || 'openai/gpt-oss-20b')
  const { error, output } = await bytezModel.run([
    {
      role: 'user',
      content: prompt
    }
  ])

  if (error) {
    throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
  }

  if (!output) {
    throw new Error('Bytez returned an empty response.')
  }

  if (typeof output === 'string') {
    return output
  }

  const normalized = (output as any)?.choices?.[0]?.message?.content ??
    (typeof (output as any)?.output === 'string'
      ? (output as any).output
      : null)

  if (typeof normalized === 'string' && normalized.length > 0) {
    return normalized
  }

  return JSON.stringify(output)
}

const makeGeminiRequest = async (prompt: string, config: ApiConfig): Promise<string> => {
  if (!config.apiKey) {
    throw new Error('GEMINI_API_KEY is missing. Add it to your environment before running production requests.')
  }

  const endpoint = `${config.baseURL.replace(/\/$/, '')}/${config.model}:generateContent?key=${config.apiKey}`
  const response = await axios.post(endpoint, {
    contents: [{
      parts: [{ text: prompt }]
    }]
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: parseInt(process.env.GEMINI_TIMEOUT_MS || '30000')
  })

  const candidates = response.data?.candidates
  const candidate = Array.isArray(candidates) ? candidates[0] : undefined
  const parts = candidate?.content?.parts
  const text = Array.isArray(parts)
    ? parts.map((part: any) => typeof part.text === 'string' ? part.text : '').join('\n').trim()
    : ''

  if (!text) {
    throw new Error('Gemini returned an empty response.')
  }

  return text
}

const makeTogetherRequest = async (prompt: string, config: ApiConfig): Promise<string> => {
  if (!config.apiKey) {
    throw new Error('TOGETHER_API_KEY is missing. Add it to your environment.')
  }

  const endpoint = `${config.baseURL.replace(/\/$/, '')}/chat/completions`
  const response = await axios.post(endpoint, {
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: parseFloat(process.env.TOGETHER_TEMPERATURE || '0.3'),
    max_tokens: parseInt(process.env.TOGETHER_MAX_TOKENS || '2500'),
    stream: false
  }, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: parseInt(process.env.TOGETHER_TIMEOUT_MS || '30000')
  })

  const content = response.data?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('Together AI returned an empty response.')
  }
  return content
}

// Enhanced response schema with dynamic resume points
export const TailorResponseSchema = z.object({
  tailored: z.object({
    professional_summary: z.string(),
    key_skills: z.array(z.string()),
    experience_bullets: z.array(z.string()),
    suggested_keywords: z.array(z.string()),
    dynamic_resume_points: z.array(z.object({
      category: z.string(),
      points: z.array(z.object({
        text: z.string(),
        impact: z.string(),
        keywords: z.array(z.string())
      }))
    })),
    customization_suggestions: z.array(z.object({
      section: z.string(),
      suggestion: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
      reasoning: z.string()
    }))
  }),
  resume: z.object({
    sections: z.array(z.object({
      heading: z.string(),
      bullets: z.array(z.string()).optional(),
      body: z.string().optional()
    })),
    full_text: z.string()
  }),
  match_score: z.number().min(0).max(100),
  application_strategy: z.object({
    cover_letter_points: z.array(z.string()),
    interview_topics: z.array(z.string()),
    salary_research: z.object({
      range: z.string(),
      factors: z.array(z.string())
    }).optional(),
    networking_suggestions: z.array(z.string())
  }),
  projects: z.array(z.object({
    title: z.string(),
    description: z.string(),
    technologies: z.array(z.string()),
    relevance_score: z.number()
  })),
  competitive_analysis: z.object({
    strengths: z.array(z.string()),
    gaps: z.array(z.string()),
    improvement_areas: z.array(z.string())
  })
})

export type TailorResponse = z.infer<typeof TailorResponseSchema>

// Enhanced prompt for comprehensive resume tailoring
const ENHANCED_PROMPT = `You are an elite, senior-level ATS resume strategist and resume-writing expert. Your job is to analyze the job description and user resume, then produce a PERFECT, fully dynamic, hyper-realistic set of resume outputs.

JOB DESCRIPTION:
{{job_description}}

CURRENT RESUME:
{{user_resume}}

Your response must be ONLY a valid JSON object.  
Do NOT add any text before or after the JSON.  
The JSON must start with { and end with }.

CRITICAL REQUIREMENTS FOR REALISM + DYNAMIC CONTENT

You must produce content that:
- Sounds like REAL projects done by REAL engineers in REAL companies (no templates, no clichés)
- Avoids generic "improved performance" claims—always explain HOW and with WHAT tools
- Uses **concrete technical details** pulled from the job description and the user's resume
- Includes **reasonable, believable, real-world metrics** such as:
  - "handled 12K+ daily transactions"
  - "reduced query time by 3–4 seconds"
  - "cut manual review cycles by ~2 hours per week"
  - "supported a team of 6 engineers"
- Describes **actual problems and solutions**, not vague accomplishments
- NEVER fabricates technologies the candidate never mentioned, unless the job explicitly requires them and they're logically reasonable
- Never uses percentages at all
- All experience bullets MUST be specific, contextual, and sound human—not robotic or manufactured
- EVERYTHING must be dynamically generated based on the job + resume (no boilerplate or hardcoded phrasing)

EXPERIENCE BULLETS REQUIREMENTS:
- Generate MINIMUM 10-12 ready-to-use resume bullets (can generate more if resume has rich content)
- Each bullet must start with a strong action verb
- Each bullet must be ATS-optimized with keywords from the job description
- Each bullet must include quantifiable metrics or concrete impact
- Bullets must be tailored to the specific job requirements
- Mix technical and soft skills based on job requirements

MATCH SCORE CALCULATION:
Calculate the match_score (0-100) based on:
- Keyword overlap between resume and job description (40% weight)
- Skills match (30% weight)
- Experience level alignment (20% weight)
- Education/certification requirements (10% weight)
Be honest and realistic - don't inflate scores. A 60-75% match is good, 75-85% is excellent, 85%+ is exceptional.

JSON OUTPUT STRUCTURE (MUST FOLLOW EXACTLY)

Return this exact JSON structure:
{
  "tailored": {
    "professional_summary": "ATS-optimized 2-3 sentence summary highlighting relevant experience",
    "key_skills": ["skill1", "skill2", "skill3", "skill4", "skill5", "skill6", "skill7", "skill8"],

    // IMPORTANT: The bullets below are EXAMPLES to show quality level.
    // Generate 10-12 NEW bullets tailored to THIS specific job and resume.
    // Do NOT copy these examples - create original bullets based on the candidate's actual experience.
    "experience_bullets": [
      "Developed and maintained production-grade system handling 15K+ daily requests with 99.9% uptime",
      "Architected scalable microservices reducing query response time from 8s to 800ms",
      "Led cross-functional team of 5 engineers implementing CI/CD pipeline reducing deployment time by 4 hours",
      "Built automated testing framework covering 85% of codebase and catching 95% of bugs pre-production",
      "Optimized database queries reducing server costs by $3K/month while improving performance",
      "Collaborated with product team to design and ship 12 features used by 50K+ active users",
      "Implemented monitoring and alerting system reducing incident response time from 2 hours to 15 minutes",
      "Mentored 3 junior developers improving code review turnaround by 50% and code quality",
      "Migrated legacy monolith to containerized architecture supporting 10x traffic growth",
      "Designed RESTful APIs consumed by 8 internal services and 3 external partners",
      "Conducted technical interviews and built onboarding process reducing ramp-up time by 3 weeks",
      "Established engineering best practices and documentation reducing support tickets by 60%"
    ],
    "suggested_keywords": ["keyword1", "keyword2", "keyword3", "keyword4"],
    "dynamic_resume_points": [
      {
        "category": "Technical Achievements",
        "points": [
          {
            "text": "Specific achievement bullet point",
            "impact": "Quantified business impact",
            "keywords": ["keyword1", "keyword2"]
          }
        ]
      }
    ],
    "customization_suggestions": [
      {
        "section": "Experience",
        "suggestion": "Specific actionable suggestion",
        "priority": "high",
        "reasoning": "Why this matters"
      }
    ]
  },
  "resume": {
    "sections": [
      {
        "heading": "Section Name",
        "bullets": ["bullet 1", "bullet 2"],
        "body": "Section content"
      }
    ],
    "full_text": "Complete resume text"
  },
  "match_score": 75,
  "application_strategy": {
    "cover_letter_points": ["Point 1", "Point 2"],
    "interview_topics": ["Topic 1", "Topic 2"],
    "salary_research": {
      "range": "$80,000 - $120,000",
      "factors": ["Factor 1", "Factor 2"]
    },
    "networking_suggestions": ["Suggestion 1", "Suggestion 2"]
  },
  "projects": [
    {
      "title": "Project Name",
      "description": "Project description",
      "technologies": ["tech1", "tech2"],
      "relevance_score": 85
    }
  ],
  "competitive_analysis": {
    "strengths": [
      "Strong technical background in [specific technology from job description]",
      "Proven track record of [specific achievement type required by job]",
      "Experience with [specific tool/methodology mentioned in job posting]"
    ],
    "gaps": [
      "Job requires [specific skill], which is not prominently featured in resume",
      "Limited evidence of [specific experience type] mentioned in job requirements",
      "Could highlight more experience with [specific technology/domain]"
    ],
    "improvement_areas": [
      "Add specific examples demonstrating [missing skill/experience]",
      "Quantify achievements related to [job requirement]",
      "Emphasize experience with [technology/methodology] if available in work history"
    ]
  }
}

IMPORTANT: Respond ONLY with the JSON object. No explanatory text.`

export async function generateTailored (jobDescription: string, resumeText: string): Promise<TailorResponse> {
  resetUsageWindowIfNeeded()
  const providers = getProviderChain()

  if (providers.length === 0) {
    throw new Error('No AI providers configured. Please set PRIMARY_LLM_PROVIDER / FALLBACK_* or LLM_PROVIDER_CHAIN.')
  }

  logger.info({
    msg: '🚀 [LLM] Starting tailoring request',
    providerChain: providers.join(' → '),
    jobDescriptionLength: jobDescription.length,
    resumeLength: resumeText.length
  })

  let lastError: Error | null = null
  const attemptedProviders: string[] = []
  const skippedProviders: string[] = []

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]
    const config = getApiConfig(provider)

    logger.info({
      msg: `🔄 [LLM] Attempting provider ${i + 1}/${providers.length}`,
      provider,
      model: config.model,
      endpoint: config.baseURL
    })

    if (!isProviderConfigured(provider)) {
      const keyName = getProviderKeyEnvVar(provider)
      logger.warn({
        msg: `⚠️  Skipping provider - missing API key`,
        provider,
        keyName
      })
      skippedProviders.push(`${provider} (missing key)`)
      continue
    }

    const skipReason = getSkipReason(provider)
    if (skipReason) {
      logger.warn({
        msg: `⚠️  Skipping provider`,
        provider,
        reason: skipReason
      })
      skippedProviders.push(`${provider} (${skipReason})`)
      continue
    }

    attemptedProviders.push(provider)

    try {
      const startTime = Date.now()
      const result = await generateWithProvider(provider, jobDescription, resumeText)
      const duration = Date.now() - startTime

      recordProviderSuccess(provider)

      logger.info({
        msg: '✅ [LLM] Request successful',
        provider,
        model: config.model,
        duration,
        matchScore: result.match_score,
        bulletsGenerated: result.tailored?.experience_bullets?.length || 0,
        keySkills: result.tailored?.key_skills?.length || 0,
        suggestedKeywords: result.tailored?.suggested_keywords?.length || 0,
        projects: result.projects?.length || 0,
        attemptedProviders,
        skippedProviders: skippedProviders.length > 0 ? skippedProviders : undefined
      })

      return result
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error))

      logger.error({
        msg: '❌ [LLM] Provider failed',
        provider,
        model: config.model,
        error: lastError.message,
        willFallback: i < providers.length - 1
      })

      if (i < providers.length - 1) {
        logger.info({ msg: '🔄 Falling back to next provider' })
      }

      continue
    }
  }

  logger.error({
    msg: '❌ [LLM] All providers failed',
    attemptedProviders,
    skippedProviders,
    lastError: lastError?.message
  })

  throw lastError ?? new Error('All AI providers failed. Please try again.')
}

async function generateWithProvider (provider: ApiProvider, jobDescription: string, resumeText: string): Promise<TailorResponse> {
  const config = getApiConfig(provider)

  logger.debug({
    msg: '🔍 Validating provider configuration',
    provider: config.provider,
    model: config.model,
    hasApiKey: !!config.apiKey
  })

  const keyName = getProviderKeyEnvVar(config.provider)

  if (!config.apiKey ||
      config.apiKey === 'placeholder' ||
      config.apiKey.length < 10) {
    logger.error({
      msg: '❌ Invalid or missing API key',
      provider: config.provider,
      keyName
    })
    const error = new Error(`Invalid or missing ${keyName}. Please check your .env file.`)
    attachProviderMetadata(error, config.provider)
    throw error
  }

  // Create enhanced prompt
  const prompt = ENHANCED_PROMPT
    .replace('{{job_description}}', jobDescription.slice(0, 3500))
    .replace('{{user_resume}}', resumeText.slice(0, 3500))

  try {
    let content: string | null = null

    if (config.provider === 'bytez') {
      logger.info({ msg: '🚀 Calling Bytez API', model: config.model })
      content = await makeBytezRequest(prompt, config)
    } else if (config.provider === 'openrouter') {
      logger.info({ msg: '🚀 Calling OpenRouter API', model: config.model })
      const response = await makeOpenRouterRequest(prompt, config)
      content = response?.choices?.[0]?.message?.content ?? null
    } else if (config.provider === 'groq') {
      const maxTokens = parseInt(process.env.GROQ_MAX_TOKENS || '4000')
      const temperature = parseFloat(process.env.GROQ_TEMPERATURE || '0.3')
      const timeoutMs = parseInt(process.env.GROQ_TIMEOUT_MS || '30000')

      logger.info({
        msg: '🚀 Calling Groq API',
        model: config.model,
        maxTokens,
        temperature,
        timeoutMs
      })

      const client = createClient(config)
      
      // Retry logic for Groq (up to 3 attempts with exponential backoff)
      const maxRetries = 3
      let completion: OpenAI.Chat.Completions.ChatCompletion | undefined

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          completion = await Promise.race([
            client.chat.completions.create({
              model: config.model,
              messages: [{ role: 'user', content: prompt }],
              temperature: temperature,
              max_tokens: maxTokens,
              stream: false
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Groq API timeout')), timeoutMs)
            )
          ])
          break // Success, exit retry loop
        } catch (groqError: any) {
          logger.warn({
            msg: '⚠️ Groq API attempt failed',
            attempt,
            maxRetries,
            error: groqError.message
          })

          if (attempt === maxRetries) {
            throw groqError // Last attempt, throw the error
          }

          // Wait before retry (exponential backoff: 1s, 2s, 4s)
          const waitTime = Math.pow(2, attempt - 1) * 1000
          logger.info({ msg: '🔄 Retrying Groq API', waitTimeMs: waitTime })
          await delay(waitTime)
        }
      }

      if (!completion) {
        throw new Error('Unable to generate tailoring after contacting Groq multiple times. Please wait 30 seconds and try again.')
      }

      content = completion.choices[0]?.message?.content ?? null
    } else if (config.provider === 'gemini') {
      logger.info({ msg: '🚀 Calling Google Gemini API', model: config.model })
      content = await makeGeminiRequest(prompt, config)
    } else if (config.provider === 'together') {
      logger.info({ msg: '🚀 Calling Together API', model: config.model })
      content = await makeTogetherRequest(prompt, config)
    } else if (config.provider === 'openai') {
      logger.info({ msg: '🚀 Calling OpenAI API', model: config.model })
      const client = createClient(config)
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.3'),
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS || '2500')
      })
      content = completion.choices[0]?.message?.content ?? null
    } else if (config.provider === 'huggingface') {
      // Hugging Face API call with rate limiting
      const client = createClient(config)
      let completion: OpenAI.Chat.Completions.ChatCompletion | undefined

      for (let attempt = 1; attempt <= HF_RATE_LIMIT_MAX_RETRIES; attempt++) {
        logger.info({
          msg: '🚀 Calling Hugging Face API',
          model: config.model,
          attempt,
          maxAttempts: HF_RATE_LIMIT_MAX_RETRIES
        })
        await waitForHfSlot()

        let retryDelayMs: number | null = null

        try {
          completion = await client.chat.completions.create({
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 2500
          })
          break
        } catch (apiError: any) {
          if (apiError?.status === 429 && attempt < HF_RATE_LIMIT_MAX_RETRIES) {
            const retryAfter = apiError?.headers?.['retry-after'] ?? apiError?.headers?.['Retry-After']
            retryDelayMs = computeRetryDelay(attempt, retryAfter)
          } else {
            throw apiError
          }
        } finally {
          releaseHfSlot()
        }

        if (retryDelayMs !== null) {
          logger.warn({
            msg: '⚠️ Hugging Face rate limit hit',
            attempt,
            retryDelayMs
          })
          await delay(retryDelayMs)
          continue
        }
      }

      if (!completion) {
        throw new Error('Unable to generate tailoring after multiple attempts due to upstream rate limiting. Please wait 30 seconds and try again.')
      }

      content = completion.choices[0]?.message?.content ?? null
    } else {
      throw new Error(`Unsupported provider: ${config.provider}`)
    }

    if (!content) {
      logger.error({ msg: '❌ Empty response from model', provider: config.provider })
      throw new Error('AI model returned empty response. Please try again.')
    }

    logger.debug({
      msg: '✅ Received response from model',
      provider: config.provider,
      responseLength: content.length
    })

    // Clean and parse JSON
    let cleanContent = content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .replace(/^[^\{]*/, '') // Remove everything before first {
      .replace(/[^\}]*$/, '') // Remove everything after last }
      .trim()

    // Find JSON object boundaries (more aggressive)
    const jsonStart = cleanContent.indexOf('{')
    const jsonEnd = cleanContent.lastIndexOf('}')

    if (jsonStart === -1 || jsonEnd === -1) {
      logger.error({
        msg: '❌ No valid JSON brackets found in response',
        provider: config.provider,
        contentPreview: content.substring(0, 200)
      })
      throw new Error('AI model did not return JSON. It may be busy or the model needs to warm up. Please wait 30 seconds and try again.')
    }

    // Extract only the JSON part
    cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1)

    // Additional validation - count brackets
    const openBrackets = (cleanContent.match(/\{/g) || []).length
    const closeBrackets = (cleanContent.match(/\}/g) || []).length

    if (openBrackets !== closeBrackets) {
      logger.error({
        msg: '❌ Mismatched brackets in JSON response',
        provider: config.provider,
        openBrackets,
        closeBrackets
      })
      throw new Error('AI model returned incomplete JSON. Please try again.')
    }

    logger.debug({
      msg: '🔍 Extracted JSON from response',
      provider: config.provider,
      jsonLength: cleanContent.length
    })

    let json
    try {
      json = JSON.parse(cleanContent)
    } catch (parseError: any) {
      logger.error({
        msg: '❌ JSON parse error',
        provider: config.provider,
        error: parseError.message,
        contentPreview: cleanContent.substring(0, 200)
      })

      // Try to give more specific error
      if (parseError.message.includes('Unexpected token')) {
        throw new Error('AI model returned malformed JSON. The model may still be loading. Please wait 30 seconds and try again.')
      }

      throw new Error(`AI model returned invalid JSON: ${parseError.message}. Please try again.`)
    }

    // Validate response structure
    const parsed = TailorResponseSchema.safeParse(json)
    if (!parsed.success) {
      logger.error({
        msg: '❌ Schema validation failed',
        provider: config.provider,
        issues: parsed.error.issues
      })
      throw new Error('AI model response missing required fields. Please try again.')
    }

    logger.info({
      msg: '✅ Response validated successfully',
      provider: config.provider,
      model: config.model
    })
    return parsed.data
  } catch (error: any) {
    handleProviderError(config, error)
  }
}

function getProviderChain (): ApiProvider[] {
  const chainEnv = process.env.LLM_PROVIDER_CHAIN
  const fromChain = chainEnv
    ? chainEnv.split(',').map(item => item.trim()).filter(Boolean).map(normalizeProvider)
    : []

  if (fromChain.length > 0) {
    return dedupeProviders(fromChain)
  }

  const priorityChain = buildPriorityChain()
  if (priorityChain.length > 0) {
    return dedupeProviders(priorityChain)
  }

  return DEFAULT_PROVIDER_CHAIN.slice()
}

function buildPriorityChain (): ApiProvider[] {
  const stages = [
    process.env.PRIMARY_LLM_PROVIDER,
    process.env.FALLBACK_1_PROVIDER,
    process.env.FALLBACK_2_PROVIDER,
    process.env.FALLBACK_3_PROVIDER
  ]

  return stages
    .map(value => value?.trim())
    .filter(Boolean)
    .map(value => normalizeProvider(value!))
}

function dedupeProviders (providers: ApiProvider[]): ApiProvider[] {
  const seen = new Set<ApiProvider>()
  const ordered: ApiProvider[] = []
  for (const p of providers) {
    if (!SUPPORTED_PROVIDERS.includes(p)) continue
    if (seen.has(p)) continue
    seen.add(p)
    ordered.push(p)
  }
  return ordered
}

function resetUsageWindowIfNeeded (): void {
  const nowKey = getUsageWindowKey()
  if (nowKey !== usageWindowKey) {
    usageWindowKey = nowKey
    for (const key of Object.keys(providerUsage)) {
      delete providerUsage[key as ApiProvider]
    }
  }
}

function getUsageWindowKey (): string {
  return new Date().toISOString().slice(0, 10)
}

function getUsageStats (provider: ApiProvider): ProviderUsageStats {
  if (!providerUsage[provider]) {
    providerUsage[provider] = { count: 0 }
  }
  return providerUsage[provider]!
}

function getSkipReason (provider: ApiProvider): string | null {
  const stats = getUsageStats(provider)

  if (stats.cooldownUntil && Date.now() < stats.cooldownUntil) {
    const seconds = Math.ceil((stats.cooldownUntil - Date.now()) / 1000)
    return `cooldown (${seconds}s remaining)`
  }

  if (provider === 'groq' && GROQ_DAILY_LIMIT > 0 && stats.count >= GROQ_DAILY_LIMIT) {
    return `daily quota reached (${GROQ_DAILY_LIMIT})`
  }

  return null
}

function recordProviderSuccess (provider: ApiProvider): void {
  const stats = getUsageStats(provider)
  stats.count++
}

function markProviderCooldown (provider: ApiProvider, ms: number): void {
  const stats = getUsageStats(provider)
  stats.cooldownUntil = Date.now() + Math.max(ms, 1_000)
}

function isProviderConfigured (provider: ApiProvider): boolean {
  const keyName = getProviderKeyEnvVar(provider)
  const key = process.env[keyName]
  if (!key || key.length < 8) {
    return false
  }
  return true
}

function handleProviderError (config: ApiConfig, error: any): never {
  const status = error?.status ?? error?.response?.status
  const message = error?.message ?? error?.response?.data?.error ?? error?.response?.data?.error?.message
  const messageLower = (message || '').toLowerCase()

  console.error(`❌ LLM Service Error (provider=${config.provider}, status=${status}):`, message || error)

  const wrap = (err: Error): never => {
    attachProviderMetadata(err, config.provider, status)
    ;(err as any).rawError = error
    throw err
  }

  // Handle specific API errors
  if (status === 401) {
    const keyName = getProviderKeyEnvVar(config.provider)
    return wrap(new Error(`Invalid ${config.provider} API token. Please check ${keyName} in .env file.`))
  }

  if (status === 402) {
    if (config.provider === 'openrouter') {
      return wrap(new Error('OpenRouter account has insufficient credits. Please add credits or switch providers via LLM_PROVIDER_CHAIN.'))
    }
    return wrap(new Error('Payment required. Please check your API account billing.'))
  }

  if (status === 429) {
    // Mark provider with cooldown to trigger fallback
    markProviderCooldown(config.provider, PROVIDER_COOLDOWN_MS)
    if (config.provider === 'groq') {
      return wrap(new Error(`${config.provider} rate limit hit. Falling back to next provider.`))
    }
    if (config.provider === 'gemini') {
      return wrap(new Error(`${config.provider} rate limit hit. Falling back to OpenAI.`))
    }
    return wrap(new Error(`${config.provider} rate limit exceeded. Trying next provider.`))
  }

  if (status === 503 || messageLower.includes('loading')) {
    return wrap(new Error('AI model is loading. Please wait 30 seconds and try again.'))
  }

  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return wrap(new Error(`Cannot connect to ${config.provider} API. Please check your internet connection.`))
  }

  // Re-throw our custom errors
  const normalizedMessage = (message || '').toUpperCase()
  if (normalizedMessage.includes('TOKEN') ||
      normalizedMessage.includes('API_KEY') ||
      normalizedMessage.includes('EMPTY RESPONSE') ||
      normalizedMessage.includes('INVALID JSON') ||
      normalizedMessage.includes('MISSING REQUIRED FIELDS')) {
    return wrap(error instanceof Error ? error : new Error(String(message ?? error)))
  }

  if (messageLower.includes('upgrade your account') || messageLower.includes('insufficient credit')) {
    markProviderCooldown(config.provider, Math.max(PROVIDER_COOLDOWN_MS, 60_000))
  }

  // Generic error
  return wrap(new Error(`AI service error: ${message || 'Unknown error'}. Please try again.`))
}

function attachProviderMetadata (err: Error, provider: ApiProvider, status?: number): void {
  (err as any).provider = provider
  if (status !== undefined && status !== null) {
    (err as any).status = status
  }
}
