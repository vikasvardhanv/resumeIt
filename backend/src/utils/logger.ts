import pino, { type TransportSingleOptions } from 'pino'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const level = process.env.LOG_LEVEL || 'info'
const isProduction = process.env.NODE_ENV === 'production'

const prettyTransport = resolvePrettyTransport()

export const logger = prettyTransport
  ? pino({ level, transport: prettyTransport })
  : pino({ level })

// Export default logger instance for convenience
export default logger

function resolvePrettyTransport(): TransportSingleOptions | undefined {
  if (isProduction) return undefined

  const prettyEnv = (process.env.LOG_PRETTY ?? process.env.PRETTY_LOGS ?? '').toLowerCase()
  if (prettyEnv === 'false') return undefined

  try {
    require.resolve('pino-pretty')
  } catch (error) {
    if (prettyEnv === 'true') {
      console.warn('LOG_PRETTY is true but pino-pretty is not installed. Falling back to JSON logs.')
    }
    return undefined
  }

  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'SYS:standard'
    }
  }
}
