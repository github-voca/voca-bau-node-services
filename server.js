/**
 * Cron server for workers
 */

const fs = require('fs');
const path = require('path');
const Conf = require('conf');
const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const Graceful = require('@ladjs/graceful');
const Bree = require('bree');

const config = new Conf({
  cwd: '/voca-bau-node-services',
  watch: true
});
if (!config.get('server')) {
  return;
}
process.chdir(config.get('service.workingDirectory'));

let server_logger = config.get('server.logger');
if (!path.isAbsolute(server_logger.dirname)) {
  server_logger.dirname = path.join(path.dirname(config.path), server_logger.dirname);
}

const { combine, timestamp, label, printf } = format;
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});
const logger = createLogger({
  format: combine(
    timestamp(),
    logFormat
  ),
  transports: [
    new transports.DailyRotateFile(server_logger)
  ]
});

const bree = new Bree({
  logger: logger,
  jobs: config.get('server.jobs')
});

const graceful = new Graceful({ brees: [bree] });
graceful.listen();

bree.start();