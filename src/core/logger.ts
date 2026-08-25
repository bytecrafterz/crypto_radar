import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.logLevel,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});

export function child(name: string) {
  return logger.child({ mod: name });
}
