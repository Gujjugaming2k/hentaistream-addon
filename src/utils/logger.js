const winston = require('winston');
const config = require('../config/env');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      try {
        // Safely stringify, avoiding circular references
        msg += ` ${JSON.stringify(meta, (key, value) => {
          if (value instanceof Error) {
            return {
              message: value.message,
              stack: value.stack,
              name: value.name
            };
          }
          // Skip circular references
          if (typeof value === 'object' && value !== null) {
            if (value.constructor && ['Socket', 'TLSSocket', 'ClientRequest', 'IncomingMessage', 'HTTPParser'].includes(value.constructor.name)) {
              return '[Circular]';
            }
          }
          return value;
        })}`;
      } catch (err) {
        msg += ` [Error stringifying metadata: ${err.message}]`;
      }
    }
    return msg;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

// Add file transports in production
if (config.server.env === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

module.exports = logger;
