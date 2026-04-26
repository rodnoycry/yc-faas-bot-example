import { DISABLE_LOGS } from "../env.js"

const dummyLogger = {
    log: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    group: () => {},
    groupEnd: () => {},
    groupCollapsed: () => {},
    dir: () => {},
} as unknown as typeof console

/**
 * Logger service that prints messages to the console
 * only in development mode
 */
export const logger = DISABLE_LOGS ? dummyLogger : console
