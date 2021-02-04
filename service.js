#!/usr/bin/env node

/**
 * VoCA-Bau node services
 */

const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));

const yargs = require('yargs');
const argv = yargs
.command('install', 'Install the VoCA-Bau node service')
.command('uninstall', 'Uninstall the VoCA-Bau node service')
.command('start', 'Start the VoCA-Bau node service')
.command('stop', 'Stop the VoCA-Bau node service')
.command('restart', 'Restart the VoCA-Bau node service')
.options({
  configFile: {
    alias: 'c',
    type: 'string',
    default: 'service.json',
    description: 'the service config filename'
  },
  default: {
    alias: 'd',
    type: 'boolean',
    description: 'create default config file'
  }
})
.help()
.alias('help', 'h')
.epilog(`current config file directory is ${dir}`)
.argv;

var svc_config_filename = argv.configFile;
if (!path.isAbsolute(svc_config_filename)) {
  svc_config_filename = path.join(dir, svc_config_filename);
}
if (!fs.existsSync(svc_config_filename)) {
  if (!argv.default) {
    yargs.showHelp();
    return;
  }
  var svc_default_config = require('./_service.json');
  svc_default_config.workingDirectory = dir;
  fs.writeFileSync(svc_config_filename, JSON.stringify(svc_default_config, null, 2));
}

const svc_config = require(svc_config_filename);

var Service = require('node-windows').Service;
var svc = new Service(svc_config);

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