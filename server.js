/**
 * Cron server for workers
 */

const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));

const argv = require('yargs')
.options({
  'logFile': {
    alias: 'l',
    type: 'string',
    default: 'server.log',
    description: 'log file name'
  },
  'configFile': {
    alias: 'c',
    type: 'string',
    default: 'server.json',
    description: 'config file name'
  }
})
.argv;

var srv_config_filename = argv.configFile;
if (!path.isAbsolute(srv_config_filename)) {
  srv_config_filename = path.join(dir, srv_config_filename);
}
if (!fs.existsSync(srv_config_filename)) {
  var srv_default_config = require('./_server.json');
  fs.writeFileSync(srv_config_filename, JSON.stringify(srv_default_config, null, 2));
}

fs.writeFileSync('c:\\temp\\npm-test\\config.json', JSON.stringify({
  'srv_config_filename': srv_config_filename,
  'dir': dir
}, null, 2));

const srv_config = require(srv_config_filename);

var log_file = srv_config.logFile || argv.logFile;
if (!path.isAbsolute(log_file)) {
  log_file = path.join(dir, log_file);
}

const { createLogger, format, transports } = require('winston');
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
    new transports.File({ filename: log_file })
  ]
});

const Graceful = require('@ladjs/graceful');
const Bree = require('bree');

const bree = new Bree({
  logger: logger,
  jobs: srv_config.jobs || []
});

const graceful = new Graceful({ brees: [bree] });
graceful.listen();

bree.start();