import pino from 'pino'

// Create a shared logger instance for the entire application
// Production: JSON logging (fast, structured)
// Development: Pretty printing (human-readable)

const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info'
}

// Only add pretty printing in development
if (process.env.NODE_ENV === 'development') {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'SYS:standard'
    }
  }
}

export const logger = pino(loggerOptions)

export default logger
