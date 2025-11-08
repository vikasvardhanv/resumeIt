import OpenAI from 'openai'
import { z } from 'zod'
import axios from 'axios'
import Bytez from 'bytez.js'

const parseEnvInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((value ?? '').split(/[\s#]/)[0] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// API Provider configuration
type ApiProvider = 'huggingface' | 'openrouter' | 'groq' | 'bytez'

interface ApiConfig {
  provider: ApiProvider
  apiKey: string
  baseURL: string
  model: string
}

const getProviderKeyEnvVar = (provider: ApiProvider): string => {
  switch (provider) {
    case 'bytez':
      return 'BYTEZ_API_KEY'
    case 'openrouter':
      return 'OPENROUTER_API_KEY'
    case 'groq':
      return 'GROQ_API_KEY'
    case 'huggingface':
    default:
      return 'HF_TOKEN'
  }
}


const getApiConfig = (): ApiConfig => {
  const provider = (process.env.LLM_PROVIDER || 'groq') as ApiProvider
  
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
const createClient = (): OpenAI => {
  const config = getApiConfig()
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey || 'placeholder'
  })
}

// OpenRouter specific request function
const makeOpenRouterRequest = async (prompt: string, model: string): Promise<any> => {
  const config = getApiConfig()
  
  const response = await axios.post(
    `${config.baseURL}/chat/completions`,
    {
      model: model,
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

const makeBytezRequest = async (prompt: string, model: string): Promise<string> => {
  const apiKey = process.env.BYTEZ_API_KEY

  if (!apiKey) {
    throw new Error('BYTEZ_API_KEY is missing. Add it to your environment before running production requests.')
  }

  const sdk = new Bytez(apiKey)
  const bytezModel = sdk.model(model || 'openai/gpt-oss-20b')
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
const ENHANCED_PROMPT = `You are an expert ATS-optimized resume consultant. Analyze the job and resume, then respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.

JOB DESCRIPTION:
{{job_description}}

CURRENT RESUME:
{{user_resume}}

CRITICAL: Your response must be ONLY valid JSON, starting with { and ending with }. No additional text.

For "experience_bullets", provide 5-8 polished, ready-to-use resume bullet points that:
- Start with strong action verbs (Led, Developed, Implemented, Achieved, etc.)
- Include specific metrics and quantified results where possible
- Are directly relevant to the job description requirements
- Follow the STAR method (Situation, Task, Action, Result)
- Can be copied directly into the resume without editing
- Are tailored to match the job's key requirements and keywords

Return this exact JSON structure:
{
  "tailored": {
    "professional_summary": "ATS-optimized 2-3 sentence summary highlighting relevant experience",
    "key_skills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
    "experience_bullets": ["Ready-to-use bullet 1 with metrics", "Ready-to-use bullet 2 with impact", "Ready-to-use bullet 3 with achievement", "Ready-to-use bullet 4 with results", "Ready-to-use bullet 5 with quantified value"],
    "suggested_keywords": ["keyword1", "keyword2", "keyword3"],
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
    "strengths": ["Strength 1", "Strength 2"],
    "gaps": ["Gap 1", "Gap 2"],
    "improvement_areas": ["Area 1", "Area 2"]
  }
}

IMPORTANT: Respond ONLY with the JSON object. No explanatory text.`

export async function generateTailored (jobDescription: string, resumeText: string): Promise<TailorResponse> {
  const config = getApiConfig()
  
  // Validate API key based on provider
  console.log('🔍 Provider:', config.provider)
  console.log('🔍 API Key check:', config.apiKey ? 'FOUND' : 'NOT FOUND')
  console.log('🤖 Using model:', config.model)

  const keyName = getProviderKeyEnvVar(config.provider)

  if (!config.apiKey ||
      config.apiKey === 'placeholder' ||
      config.apiKey.length < 10) {
    console.error(`❌ Invalid ${keyName}`)
    throw new Error(`Invalid or missing ${keyName}. Please check your .env file.`)
  }

  // Create enhanced prompt
  const prompt = ENHANCED_PROMPT
    .replace('{{job_description}}', jobDescription.slice(0, 3500))
    .replace('{{user_resume}}', resumeText.slice(0, 3500))

  try {
    let content: string | null = null

    if (config.provider === 'bytez') {
      console.log('🚀 Calling Bytez API...')
      content = await makeBytezRequest(prompt, config.model)
    } else if (config.provider === 'openrouter') {
      // OpenRouter API call
      console.log('🚀 Calling OpenRouter API...')
      const response = await makeOpenRouterRequest(prompt, config.model)
      content = response?.choices?.[0]?.message?.content ?? null
    } else if (config.provider === 'groq') {
      // Groq API call with optimizations and retry logic
      console.log('🚀 Calling Groq API...')
      const client = createClient()
      
      // Groq-specific optimizations
      const maxTokens = parseInt(process.env.GROQ_MAX_TOKENS || '4000')
      const temperature = parseFloat(process.env.GROQ_TEMPERATURE || '0.3')
      const timeoutMs = parseInt(process.env.GROQ_TIMEOUT_MS || '30000')
      
      console.log(`⚙️ Groq Config - Max Tokens: ${maxTokens}, Temperature: ${temperature}, Timeout: ${timeoutMs}ms`)
      
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
          console.log(`⚠️ Groq API attempt ${attempt}/${maxRetries} failed:`, groqError.message)
          
          if (attempt === maxRetries) {
            throw groqError // Last attempt, throw the error
          }
          
          // Wait before retry (exponential backoff: 1s, 2s, 4s)
          const waitTime = Math.pow(2, attempt - 1) * 1000
          console.log(`🔄 Retrying Groq API in ${waitTime}ms...`)
          await delay(waitTime)
        }
      }

      if (!completion) {
        throw new Error('Unable to generate tailoring after contacting Groq multiple times. Please wait 30 seconds and try again.')
      }

      content = completion.choices[0]?.message?.content ?? null
    } else {
      // Hugging Face API call with rate limiting
      const client = createClient()
      let completion: OpenAI.Chat.Completions.ChatCompletion | undefined
      
      for (let attempt = 1; attempt <= HF_RATE_LIMIT_MAX_RETRIES; attempt++) {
        console.log(`🚀 Calling Hugging Face API (attempt ${attempt}/${HF_RATE_LIMIT_MAX_RETRIES})...`)
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
          console.warn(`⚠️ Hugging Face rate limit hit (attempt ${attempt}). Retrying in ${retryDelayMs}ms...`)
          await delay(retryDelayMs)
          continue
        }
      }

      if (!completion) {
        throw new Error('Unable to generate tailoring after multiple attempts due to upstream rate limiting. Please wait 30 seconds and try again.')
      }

      content = completion.choices[0]?.message?.content ?? null
    }

    if (!content) {
      console.error('❌ Empty response from model')
      throw new Error('AI model returned empty response. Please try again.')
    }

    console.log('✅ Received response from model')
    console.log('📝 Response length:', content.length)
    console.log('📝 Response preview (first 200 chars):', content.substring(0, 200))

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
      console.error('❌ No valid JSON brackets found in response')
      console.error('Raw content preview:', content.substring(0, 500))
      throw new Error('AI model did not return JSON. It may be busy or the model needs to warm up. Please wait 30 seconds and try again.')
    }

    // Extract only the JSON part
    cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1)

    // Additional validation - count brackets
    const openBrackets = (cleanContent.match(/\{/g) || []).length
    const closeBrackets = (cleanContent.match(/\}/g) || []).length

    if (openBrackets !== closeBrackets) {
      console.error(`❌ Mismatched brackets: ${openBrackets} open, ${closeBrackets} close`)
      throw new Error('AI model returned incomplete JSON. Please try again.')
    }

    console.log('🔍 Extracted JSON length:', cleanContent.length)
    console.log('🔍 JSON preview:', cleanContent.substring(0, 100) + '...')

    let json
    try {
      json = JSON.parse(cleanContent)
    } catch (parseError: any) {
      console.error('❌ JSON parse error:', parseError.message)
      console.error('Failed JSON preview:', cleanContent.substring(0, 500))

      // Try to give more specific error
      if (parseError.message.includes('Unexpected token')) {
        throw new Error('AI model returned malformed JSON. The model may still be loading. Please wait 30 seconds and try again.')
      }

      throw new Error(`AI model returned invalid JSON: ${parseError.message}. Please try again.`)
    }

    // Validate response structure
    const parsed = TailorResponseSchema.safeParse(json)
    if (!parsed.success) {
      console.error('❌ Schema validation failed:', parsed.error.issues)
      throw new Error('AI model response missing required fields. Please try again.')
    }

    console.log('✅ Response validated successfully')
    return parsed.data
  } catch (error: any) {
    console.error('❌ LLM Service Error:', error)

    // Handle specific API errors
    if (error.status === 401) {
      const keyName = getProviderKeyEnvVar(config.provider)
      throw new Error(`Invalid ${config.provider} API token. Please check ${keyName} in .env file.`)
    }

    if (error.status === 402) {
      if (config.provider === 'openrouter') {
        throw new Error('OpenRouter account has insufficient credits. Please add credits at https://openrouter.ai/credits or switch to Hugging Face by setting LLM_PROVIDER=huggingface')
      }
      throw new Error('Payment required. Please check your API account billing.')
    }

    if (error.status === 429) {
      if (config.provider === 'groq') {
        throw new Error('⏱️ Groq rate limit exceeded. You have 30 requests per minute. Please wait a moment before trying again.')
      }
      throw new Error('⏱️ Rate limit exceeded. Please wait a moment before trying again.')
    }

    if (error.status === 503 || error.message?.includes('loading')) {
      throw new Error('AI model is loading. Please wait 30 seconds and try again.')
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new Error(`Cannot connect to ${config.provider} API. Please check your internet connection.`)
    }

    // Re-throw our custom errors
    if (error.message?.includes('TOKEN') ||
        error.message?.includes('API_KEY') ||
        error.message?.includes('empty response') ||
        error.message?.includes('invalid JSON') ||
        error.message?.includes('missing required fields')) {
      throw error
    }

    // Generic error
    throw new Error(`AI service error: ${error.message || 'Unknown error'}. Please try again.`)
  }
}
