const fs = require('fs');
const path = require('path');
const dir = path.dirname(fs.realpathSync(__filename));
const _ = require('lodash');
const xml2js = require('xml2js');
const querystring = require('querystring');

const argv = require('yargs')
.options({
  'logFile': {
    alias: 'l',
    type: 'string',
    default: 'project-update.log',
    description: 'log file name'
  },
  'projectsDir': {
    alias: 'p',
    type: 'string',
    description: 'projects directory'
  },
  'url': {
    alias: 'u',
    type: 'string',
    description: 'database url (e.g. http://<username>:<password>@<domain>'
  },
  'verbose': {
    alias: 'v',
    type: 'boolean',
    descritpion: 'generate verbose log file output'
  },
  'debug': {
    alias: 'd',
    type: 'boolean',
    descritpion: 'generate debug log file output'
  }
})
.argv;

var log_file = argv.logFile;
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
    new transports.File({
      filename: log_file,
      level: argv.debug ? 'debug' : argv.verbose ? 'verbose' : 'info'
    })
  ]
});

var projectsDir = argv.projectsDir;
if (!path.isAbsolute(projectsDir)) {
  projectsDir = path.join(dir, projectsDir);
}
if (!fs.existsSync(projectsDir)) {
  logger.error(`projects directory does not exist: ${projectsDir}`);
  return;
}

var url = argv.url;
if (!url) {
  logger.error(`database url does not exist: ${url}`);
  return;
}
else {
  url = new URL(url);
}

var http_options = {
  protocol: url.protocol,
  host: url.host
}
if (url.port) http_options.port = url.port;
if (url.username && url.password) http_options.auth = url.username + ':' + url.password;

const http = require('http');
const http_request = function(path, method, params) {
  let options = { ...http_options };
  let post_data = null;

  if (path) options.path = path;
  if (method) options.method = method;
  if (params) {
    if (method == 'GET') {
      options.path = path + '?' + querystring.stringify(params);
    }
    else {
      post_data = querystring.stringify(params);
      if (!options.headers) options.headers = {};
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.headers['Content-Length'] = Buffer.byteLength(post_data);
    }
  }

  return new Promise((resolve, reject) => {
    let request = http.request(options, (response) => {
      const { statusCode } = response;
      const contentType = response.headers['content-type'];
    
      let error = null;
      if (statusCode !== 200) {
        error = new Error('Request Failed.\n' +
                          `Status Code: ${statusCode}`);
      } else if (!/^application\/json/.test(contentType)) {
        error = new Error('Invalid content-type.\n' +
                          `Expected application/json but received ${contentType}`);
      }
      if (error) {
        // Consume response data to free up memory
        response.resume();
        reject(error);
        return;
      }
    
      let rawData = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { rawData += chunk; });
      response.on('end', () => {
        try {
          var json = JSON.parse(rawData);
          if (!json.success) throw new Error(json.message);
          resolve(json);
        }
        catch (e) {
          reject(e);
        }
      });
      response.on('error', (error) => {
        reject(error)
      })
    });
    if (post_data) {
      request.write(post_data);
    }
    request.end();
  })
};

// main method
let main = async function() {
  try {
    logger.log('verbose', 'load customers and projects from database...');
    let [ customers_response, projects_response ] = await Promise.all([
      http_request('/php/db.php/customers'),
      http_request('/php/db.php/projects')
    ]);
    customers = customers_response.root;
    projects = projects_response.root;

    logger.log('debug', 'create helper functions...');
    let defaultCustomer = customers.find(customer => customer.catchall == '1');

    let getCustomerByName = function(name) {
      let customer = customers.find(customer => name.match(new RegExp('^' + customer.name, 'i')));
      if (customer) {
        name = name.match(new RegExp('^' + customer.name + '[^\\w]*(.*)$', 'i'))[1];
      }
      else {
        customer = defaultCustomer;
      }
      return { customer: customer, name: name };
    };

    logger.log('debug', 'create checkPLV promise...');
    let checkPLV = async function(file) {
      let stats = fs.statSync(file);
      let content = fs.readFileSync(file, 'latin1');

      let { customer, name } = getCustomerByName(content.slice(1152,1195).toString().trim());
      let filedate = stats.mtime.toJSON().match(/^([^T]*)T([^\.]*)\..*/);

      return {
        name: name,
        active: '1',
        customer: customer.id,
        filename: file,
        filesize: '' + stats.size,
        filedate: filedate[1] + ' ' + filedate[2],
        description: content.slice(439,482).toString().trim(),
        address: content.slice(396,439).toString().trim(),
        type: content.slice(482,497).toString().trim()
      };
    };

    logger.log('debug', 'check all PLV-files...')
    let filesPLV = fs.readdirSync(projectsDir).filter(file => file.toUpperCase().endsWith('.PLV')).map(file => path.join(projectsDir, file));
    let checkedPLV = await Promise.all(filesPLV.map(file => checkPLV(file)));

    logger.log('debug', 'create checkONLV promise...');
    let checkONLV = async function(file) {
      let stats = fs.statSync(file);
      let content = fs.readFileSync(file, 'utf8');
  
      let parser = new xml2js.Parser();
      let result = await parser.parseStringPromise(content);

      let { customer, name } = getCustomerByName((result['onlv']['ausschreibungs-lv'][0]['kenndaten'][0]['vorhaben'] || []).join());
      let filedate = stats.mtime.toJSON().match(/^([^T]*)T([^\.]*)\..*/);

      return {
        name: name,
        active: '1',
        customer: customer.id,
        filename: file,
        filesize: '' + stats.size,
        filedate: filedate[1] + ' ' + filedate[2],
        description: '',
        address: '',
        type: (result['onlv']['ausschreibungs-lv'][0]['kenndaten'][0]['lvcode'] || []).join()
      }
    };

    logger.log('debug', 'check all ONLV-files...')
    let filesONLV = fs.readdirSync(projectsDir).filter(file => file.toUpperCase().endsWith('.ONLV')).map(file => path.join(projectsDir, file));
    let checkedONLV = await Promise.all(filesONLV.map(file => checkONLV(file)));

    logger.log('debug', 'update projects...');
    let requests = [];
    let checked = checkedPLV.concat(checkedONLV);
    checked.forEach(params => {
      let project = projects.find(project => project.filename == params.filename);

      let method = null;

      if (project) {
        params.id = project.id;
        if (!_.isEqual(project, params)) method = 'PUT';
        project.exists = true;
      }
      else {
        method = 'POST';
      }

      if (method) {
        requests.push({
          method: method,
          params: params
        });
      }
    });
    projects.forEach(project => {
      if (!project.exists) {
        requests.push({
          method: 'DELETE',
          params: project
        })
      }
    });
    
    let responses = await Promise.all(requests.map(request => http_request('/php/db.php/projects', request.method, request.params)));

    logger.info('all project files up-to-date!');
  }
  catch (error) {
    logger.error(error.message);
  }
};
main();