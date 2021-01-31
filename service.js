#!/usr/bin/env node

/**
 * VoCA-Bau node services
 */

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));

const argv = yargs
.command('install', 'Install the VoCA-Bau node service', {
  svc_config_file: {
    description: 'the service config filename',
    alias: 'f',
    type: 'string'
  }
})
.command('uninstall', 'Uninstall the VoCA-Bau node service', {
  svc_config_file: {
    description: 'the service config filename',
    alias: 'f',
    type: 'string'
  }
})
.command('start', 'Start the VoCA-Bau node service', {
  svc_config_file: {
    description: 'the service config filename',
    alias: 'f',
    type: 'string'
  }
})
.command('stop', 'Stop the VoCA-Bau node service', {
  svc_config_file: {
    description: 'the service config filename',
    alias: 'f',
    type: 'string'
  }
})
.command('restart', 'Restart the VoCA-Bau node service', {
  svc_config_file: {
    description: 'the service config filename',
    alias: 'f',
    type: 'string'
  }
})
.help()
.alias('help', 'h')
.epilog(`current config file directory is ${dir}`)
.argv;

var svc_config_filename = argv.svc_config_file || path.join(dir, '/service.json');
if (!fs.existsSync(svc_config_filename)) {
  var svc_default_config = require('./_service.json');
  svc_default_config.workingDirectory = process.cwd();
  fs.writeFileSync(svc_config_filename, JSON.stringify(svc_default_config, null, 2));
}

var svc_config = require(svc_config_filename);
var Service = require('node-windows').Service;
var svc = new Service(svc_config);

if (argv._.includes('install')) {
 if (!svc.exists) svc.install();
}
else if (argv._.includes('uninstall')) {
 if (svc.exists) svc.uninstall();
}
else if (argv._.includes('start')) {
 if (svc.exists) svc.start();
}
else if (argv._.includes('stop')) {
 if (svc.exists) svc.stop();
}
else if (argv._.includes('restart')) {
 if (svc.exists) svc.restart();
}
else {
  yargs.showHelp();
}

module.exports = svc;