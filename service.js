#!/usr/bin/env node

/**
 * VoCA-Bau node services
 */

const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const Configstore = require('configstore');
const Service = require('node-windows').Service;

const dir = path.dirname(fs.realpathSync(__filename));
process.chdir(dir); // otherwise node-services/deamon-folder will be created in current directory!

const config = new Configstore('voca-bau-node-services');
if (!config.get('service')) {
  config.all = require('./default-config.json');
  config.set('service.workingDirectory', dir);
}

const argv = yargs
.command('install', 'Install the VoCA-Bau node service')
.command('uninstall', 'Uninstall the VoCA-Bau node service')
.command('start', 'Start the VoCA-Bau node service')
.command('stop', 'Stop the VoCA-Bau node service')
.command('restart', 'Restart the VoCA-Bau node service')
.help()
.alias('help', 'h')
.epilog(`Service directory is ${dir}`)
.epilog(`Config file is ${config.path}`)
.argv;

let svc = new Service(config.get('service'));

if (argv._.includes('install')) {
  svc.install();
}
else if (argv._.includes('uninstall')) {
  svc.uninstall();
}
else if (argv._.includes('start')) {
  svc.start();
}
else if (argv._.includes('stop')) {
  svc.stop();
}
else if (argv._.includes('restart')) {
  svc.restart();
}
else {
  yargs.showHelp();
}

module.exports = svc;