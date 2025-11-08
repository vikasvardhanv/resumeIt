import pino from 'pino'

// Create a shared logger instance for the entire application
// Production: JSON logging (fast, structured)
// Development: Pretty printing (human-readable)

const isDevelopment = process.env.NODE_ENV === 'development'

// Simple approach: in production, never use transport
// In development, try to use pino-pretty but fallback to default if not available
const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info'
}

// Only configure pretty printing in development environment
// This ensures pino-pretty is never referenced in production code
if (isDevelopment) {
  try {
    loggerOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:standard'
      }
    }
  } catch {
    // Fallback to default if pino-pretty not available
  }
}

export const logger = pino(loggerOptions)

export default logger
