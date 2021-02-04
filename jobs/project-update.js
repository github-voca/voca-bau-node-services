const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const xml2js = require('xml2js');
const querystring = require('querystring');

const dir = path.dirname(fs.realpathSync(__filename));
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

let base_url = argv.url;
if (!base_url) {
  logger.error(`database url does not exist: ${base_url}`);
  return;
}
else {
  base_url = new URL(base_url);
}
let base_params = querystring.parse(base_url.search.substr(1))

// merge params customizer for arrays
const merge_params = function(a, b) {
  if (_.isArray(a)) {
    return a.concat(b);
  }
};

// HTTP request promise
const http = require('http');
const http_request = function(path, method = null, params = null) {
  let http_url = new URL(path, base_url);
  let http_query = querystring.stringify(_.mergeWith(
      params,
      base_params,
      querystring.parse(http_url.search.substr(1)
    ), merge_params)) || null;
  let post_data = null;

  if (http_query) {
    if (!method || (method == 'GET')) {
      http_url.search = '?' + http_query;
    }
    else {
      post_data = http_query;
    }
  }

  let http_options = {
    protocol: http_url.protocol,
    host: http_url.hostname,
    path: http_url.pathname + http_url.search
  }

  if (http_url.port) http_options.port = http_url.port;
  if (http_url.username && http_url.password) http_options.auth = http_url.username + ':' + http_url.password;
  if (method) http_options.method = method;
  if (post_data) {
    http_options.headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(post_data)
    };
  }

  return new Promise((resolve, reject) => {
    let request = http.request(http_options, (response) => {
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
      http_request('php/db.php/customers'),
      http_request('php/db.php/projects')
    ]);
    customers = customers_response.root;
    projects = projects_response.root;

    logger.log('debug', 'create helper functions...');
    let defaultCustomer = customers.find(customer => customer.type == '1');

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

      let onlv = Object.keys(result).find(key => key.match(/^.*onlv$/i));
      if (!onlv) throw new Error(`ONLV-file ${file} has no valid onlv-tag`);
      let onlv_lv = Object.keys(result[onlv]).find(key => key.match(/^.*\-lv$/i));
      if (!onlv_lv) throw new Error(`ONLV-file ${file} has no valid ...-lv-tag`);
      let onlv_kenndaten = Object.keys(result[onlv][onlv_lv][0]).find(key => key.match(/^.*kenndaten$/i));
      if (!onlv_kenndaten) throw new Error(`ONLV-file ${file} has no valid kenndaten-tag`);

      let onlv_vorhaben = Object.keys(result[onlv][onlv_lv][0][onlv_kenndaten][0]).find(key => key.match(/^.*vorhaben$/i));
      onlv_vorhaben = onlv_vorhaben ? result[onlv][onlv_lv][0][onlv_kenndaten][0][onlv_vorhaben].join() : file;

      let onlv_lvbezeichnung = Object.keys(result[onlv][onlv_lv][0][onlv_kenndaten][0]).find(key => key.match(/^.*lvbezeichnung$/i));
      onlv_lvbezeichnung = onlv_lvbezeichnung ? result[onlv][onlv_lv][0][onlv_kenndaten][0][onlv_lvbezeichnung].join() : '';

      let onlv_lvcode = Object.keys(result[onlv][onlv_lv][0][onlv_kenndaten][0]).find(key => key.match(/^.*lvcode$/i));
      onlv_lvcode = onlv_lvcode ? result[onlv][onlv_lv][0][onlv_kenndaten][0][onlv_lvcode].join() : '';

      let { customer, name } = getCustomerByName(onlv_vorhaben);
      let filedate = stats.mtime.toJSON().match(/^([^T]*)T([^\.]*)\..*/);

      return {
        name: name,
        active: '1',
        customer: customer.id,
        filename: file,
        filesize: '' + stats.size,
        filedate: filedate[1] + ' ' + filedate[2],
        description: onlv_lvbezeichnung,
        address: onlv_vorhaben,
        type: onlv_lvcode
      }
    };

    logger.log('debug', 'check all ONLV-files...')
    let filesONLV = fs.readdirSync(projectsDir).filter(file => file.toUpperCase().endsWith('.ONLV')).map(file => path.join(projectsDir, file));
    let checkedONLV = await Promise.all(filesONLV.map(file => checkONLV(file)));

    logger.log('debug', 'update projects...');
    let pinsert = pupdate = pdelete = 0;
    let requests = [];
    let checked = checkedPLV.concat(checkedONLV);
    checked.forEach(params => {
      let project = projects ? projects.find(project => project.filename == params.filename) : null;
      let method = null;

      if (project) {
        params.id = project.id;
        if (!_.isEqual(project, params)) {
          method = 'PUT';
          pupdate++;
        }
        project.exists = true;
      }
      else {
        method = 'POST';
        pinsert++;
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
        pdelete++;
      }
    });
    
    let responses = await Promise.all(requests.map(request => http_request('php/db.php/projects', request.method, request.params)));

    if (pinsert || pupdate || pdelete) {
      logger.info(`project-update: ${pinsert} new projects, ${pupdate} changed projects and ${pdelete} finished projects`);
    }
    else {
      logger.log('verbose', 'all project files up-to-date!');
    }
  }
  catch (error) {
    logger.error(error.message);
  }
};
main();