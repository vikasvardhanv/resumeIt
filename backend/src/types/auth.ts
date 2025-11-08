import { type Request } from 'express'

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  picture?: string
  subscription?: {
    id: string
    status: string
    plan: string
  }
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser
}

declare global {
  namespace Express {
    interface User extends AuthenticatedUser {}
  }
}
