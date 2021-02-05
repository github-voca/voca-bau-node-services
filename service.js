#!/usr/bin/env node

/**
 * VoCA-Bau node services
 */

const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const Conf = require('conf');
const { Service, EventLogger } = require('node-windows');

const argv = yargs
.scriptName('voca-bau-node-services')
.command('install', 'Install the VoCA-Bau node service')
.command('uninstall', 'Uninstall the VoCA-Bau node service')
.command('start', 'Start the VoCA-Bau node service')
.command('stop', 'Stop the VoCA-Bau node service')
.command('restart', 'Restart the VoCA-Bau node service')
.help()
.alias('help', 'h')
.argv;

const config = new Conf({
  cwd: '/voca-bau-node-services',
  defaults: require('./default-config.json'),
  watch: true
});
config.set('service.workingDirectory', path.dirname(fs.realpathSync(__filename)));
process.chdir(config.get('service.workingDirectory'));

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
