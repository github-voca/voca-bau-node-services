const Graceful = require('@ladjs/graceful');
const winston = require('winston');
const Bree = require('bree');

var srv_config = require("./server.json");

const bree = new Bree({
  logger: winston.createLogger({
    transports: [
      new winston.transports.File({ filename: srv_config.log_file })
    ]
  }),
  jobs: srv_config.jobs
});

const graceful = new Graceful({ brees: [bree] });
graceful.listen();

bree.start();