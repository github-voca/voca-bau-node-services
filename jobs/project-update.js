const fs = require('fs');
const path = require('path');
const Conf = require('conf');
const http = require('http');
const https = require('https');
const _ = require('lodash');
const xml2js = require('xml2js');
const querystring = require('querystring');
const { createLogger, format, transports } = require('winston');
const { check } = require('yargs');
require('winston-daily-rotate-file');

const config = new Conf({
  cwd: '/voca-bau-node-services',
  watch: true
});
if (!config.get('configs.project-update')) {
  return;
}

let job_logger = { ...config.get('server.logger'), ...config.get('configs.project-update.logger') };
if (!path.isAbsolute(job_logger.dirname || '')) {
  if (path.isAbsolute(config.get('server.logger.dirname') || '')) {
    job_logger.dirname = path.join(config.get('server.logger.dirname'), config.get('configs.project-update.logger.dirname') || '');  
  }
  else {
    job_logger.dirname = path.join(path.dirname(config.path), config.get('server.logger.dirname') || '', config.get('configs.project-update.logger.dirname') || '');
  }
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
    new transports.DailyRotateFile(job_logger)
  ]
});

var projectsDir = config.get('configs.project-update.projectsDir');
if (!path.isAbsolute(projectsDir) || !fs.existsSync(projectsDir)) {
  logger.error(`projects directory invalid: ${projectsDir}`);
  return;
}

let base_url = config.get('configs.project-update.url');
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
    let protocol = http_options.protocol.match(/^https/i) ? https : http;
    let request = protocol.request(http_options, (response) => {
      const { statusCode } = response;
      const contentType = response.headers['content-type'];
    
      let error = null;
      if (statusCode !== 200) {
        error = new Error('Request Failed.\n' +
                          `Status Code: ${statusCode}`);
      } else if (!contentType.match(/^application\/json/i)) {
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
  });
};

// main method
let main = async function() {
  try {
    logger.log('verbose', 'load customers and projects from database...');
    let [ customers_response, projects_response, projectfolders_response ] = await Promise.all([
      http_request('php/db.php/customers'),
      http_request('php/db.php/projects'),
      http_request('php/db.php/projectfolders')
    ]);
    customers = customers_response.root;
    projects = projects_response.root;
    projectfolders = projectfolders_response.root;

    logger.log('debug', 'create helper functions...');
    let defaultCustomer = customers.find(customer => customer.type == '1');

    let getCustomerByFile = function(file) {
      file = file.split(path.sep).slice(-2).join(path.sep);
      let name = path.basename(file, path.extname(file));
      let customer = customers.find(customer => (customer.type != '1') && (file.match(new RegExp(customer.description, 'i'))));

      if (customer) {
        name = file.match(new RegExp(customer.description, 'i'))[1] || name;
      }
      else {
        customer = defaultCustomer;
      }
      return { customer: customer, name: name };
    };

    let getProjectFolderByFile = function(file) {
      let name = new RegExp('^' + file.split(path.sep).slice(-2)[0] + '$', 'i');
      return projectfolders.find(projectfolder => projectfolder.name.match(name));
    }

    logger.log('debug', 'create checkPLV promise...');
    let checkPLV = async function(file) {
      let stats = fs.statSync(file);
      let content = fs.readFileSync(file, 'latin1');
      
      let plv_lvbezeichnung = content.slice(439,482).toString().trim();
      let plv_vorhaben = content.slice(396,439).toString().trim();
      let plv_lvcode = content.slice(482,497).toString().trim();

      let { customer, name } = getCustomerByFile(file + '|' + plv_vorhaben);
      let projectfolder = getProjectFolderByFile(file);

      let filedate = stats.mtime.toJSON().match(/^([^T]*)T([^\.]*)\..*/);

      return {
        name: name,
        active: '1',
        customer: customer.id,
        projectfolder: projectfolder.id,
        filename: file,
        filesize: '' + stats.size,
        filedate: filedate[1] + ' ' + filedate[2],
        description: plv_lvbezeichnung,
        address: plv_vorhaben,
        type: plv_lvcode
      };
    };

    logger.log('debug', 'check all PLV-files...')
    let filesPLV = [];
    projectfolders.forEach(projectfolder => {
      let folder = path.join(projectsDir, projectfolder.name);
      if (fs.existsSync(folder)) {
        filesPLV = filesPLV.concat(fs.readdirSync(folder).filter(file => file.toUpperCase().endsWith('.PLV')).map(file => path.join(folder, file)));
      }
      else {
        logger.info(`check PLV-files in folder ${folder} failed (not exists)`);
      }
    });
    let checkedPLV = await Promise.all(filesPLV.map(file => checkPLV(file)));

    // logger.log('debug', 'create checkONLV promise...');
    // let checkONLV = async function(file) {
    //   let stats = fs.statSync(file);
    //   let content = fs.readFileSync(file, 'utf8');
  
    //   let parser = new xml2js.Parser();
    //   let result = await parser.parseStringPromise(content);

    //   let onlv = Object.keys(result).find(key => key.match(/^.*onlv$/i));
    //   if (!onlv) throw new Error(`ONLV-file ${file} has no valid onlv-tag`);
    //   let onlv_lv = Object.keys(result[onlv]).find(key => key.match(/^.*\-lv$/i));
    //   if (!onlv_lv) throw new Error(`ONLV-file ${file} has no valid ...-lv-tag`);
    //   let onlv_kenndaten = Object.keys(result[onlv][onlv_lv][0]).find(key => key.match(/^.*kenndaten$/i));
    //   if (!onlv_kenndaten) throw new Error(`ONLV-file ${file} has no valid kenndaten-tag`);

    //   let onlv_vorhaben = Object.keys(result[onlv][onlv_lv][0][onlv_kenndaten][0]).find(key => key.match(/^.*vorhaben$/i));
    //   onlv_vorhaben = onlv_vorhaben ? result[onlv][onlv_lv][0][onlv_kenndaten][0][onlv_vorhaben].join() : '';

    //   let onlv_lvbezeichnung = Object.keys(result[onlv][onlv_lv][0][onlv_kenndaten][0]).find(key => key.match(/^.*lvbezeichnung$/i));
    //   onlv_lvbezeichnung = onlv_lvbezeichnung ? result[onlv][onlv_lv][0][onlv_kenndaten][0][onlv_lvbezeichnung].join() : '';

    //   let onlv_lvcode = Object.keys(result[onlv][onlv_lv][0][onlv_kenndaten][0]).find(key => key.match(/^.*lvcode$/i));
    //   onlv_lvcode = onlv_lvcode ? result[onlv][onlv_lv][0][onlv_kenndaten][0][onlv_lvcode].join() : '';

    //   let { customer, name } = getCustomerByFile(file + '|' + onlv_vorhaben);
    //   let projectfolder = getProjectFolderByFile(file);
    //   let filedate = stats.mtime.toJSON().match(/^([^T]*)T([^\.]*)\..*/);

    //   return {
    //     name: name,
    //     active: '1',
    //     customer: customer.id,
    //     projectfolder: projectfolder.id,
    //     filename: file,
    //     filesize: '' + stats.size,
    //     filedate: filedate[1] + ' ' + filedate[2],
    //     description: onlv_lvbezeichnung,
    //     address: onlv_vorhaben,
    //     type: onlv_lvcode
    //   }
    // };

    // logger.log('debug', 'check all ONLV-files...')
    // let filesONLV = [];
    // projectfolders.forEach(projectfolder => {
    //   let folder = path.join(projectsDir, projectfolder.name);
    //   if (fs.existsSync(folder)) {
    //     filesONLV = filesONLV.concat(fs.readdirSync(folder).filter(file => file.toUpperCase().endsWith('.ONLV')).map(file => path.join(folder, file)));
    //   }
    //   else {
    //     logger.info(`check ONLV-files in folder ${folder} failed (not exists)`);
    //   }
    // });
    // let checkedONLV = await Promise.all(filesONLV.map(file => checkONLV(file)));
    
    logger.log('debug', 'update projects...');
    let pinsert = pupdate = pdelete = 0;
    let requests = [];
    let checked = checkedPLV; // .concat(checkedONLV);
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
    
    // let responses = await Promise.all(requests.map(request => http_request('php/db.php/projects', request.method, request.params)));
    // max. 10 concurrent connections
    let maxcon = 10;
    for (let i = 0; i < requests.length; i += maxcon) {
      await Promise.all(requests.slice(i, i + maxcon).map(request => http_request('php/db.php/projects', request.method, request.params)));
    }

    if (pinsert || pupdate || pdelete) {
      logger.info(`project-update: ${pinsert} new projects, ${pupdate} changed projects and ${pdelete} finished projects`);
    }
    else {
      logger.info('project-update: all project files up-to-date!');
    }
  }
  catch (error) {
    logger.error(error.message);
  }
};
main();