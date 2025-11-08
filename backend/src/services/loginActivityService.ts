import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'

type Provider =
  | 'google-oauth'
  | 'google-token'

interface LoginMetadata {
  via?: 'web' | 'extension'
  userAgent?: string
  scope?: string
  [key: string]: unknown
}

export async function recordLoginActivity (
  userId: string,
  provider: Provider,
  metadata: LoginMetadata = {}
): Promise<void> {
  try {
    await prisma.loginActivity.create({
      data: {
        userId,
        provider,
        metadata: metadata as Prisma.InputJsonValue
      }
    })
  } catch (error) {
    console.warn('Login activity recording failed:', error)
  }
}
