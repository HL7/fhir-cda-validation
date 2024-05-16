import { createLogger, format, transports } from "winston";
import chalk from 'chalk';

const { combine, printf } = format;

const printer = printf(info => {
  let level;
  switch (info.level) {
    case 'info':
      level = chalk.whiteBright.bgGreen(`${info.level} `);
      break;
    case 'warn':
      // (179, 98, 0) = dark dark orange
      level = chalk.whiteBright.bgRgb(179, 98, 0)(`${info.level} `);
      if (!info.silent) noticeLogs.push(info.message);
      break;
    case 'error':
      level = chalk.whiteBright.bgRed(`${info.level}`);
      if (!info.silent) errorLogs.push(info.message);
      break;
    case 'debug':
      level = chalk.whiteBright.bgBlue(`${info.level}`);
      break;
    default:
      break;
  }
  return `${level} ${info.message}`;
});

export const logger = createLogger({
  format: combine(printer),
  transports: [new transports.Console()]
});

export const logMessage = (level: string, message: string): void => {
  logger.log(level, message);
};

export const errorLogs: string[] = [];
export const noticeLogs: string[] = [];