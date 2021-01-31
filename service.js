/**
 * VoCA-Bau node services
 */

const yargs = require('yargs');

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
 .argv;

var fs = require('fs');
var svc_config_filename = argv.svc_config_file || './service.json';
if (!fs.existsSync(svc_config_filename)) {
  yargs.showHelp();
  return 0;
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
return 0;