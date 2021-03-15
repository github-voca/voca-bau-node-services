const fs = require('fs');
const path = require('path');
const Conf = require('conf');
const http = require('http');
const https = require('https');
const _ = require('lodash');
const xml2js = require('xml2js');
const querystring = require('querystring');
const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');

const config = new Conf({
  cwd: '/voca-bau-node-services',
  watch: true
});
if (!config.get('configs.import-pictures')) {
  return;
}

let job_logger = { ...config.get('server.logger'), ...config.get('configs.import-pictures.logger') };
if (!path.isAbsolute(job_logger.dirname || '')) {
  if (path.isAbsolute(config.get('server.logger.dirname') || '')) {
    job_logger.dirname = path.join(config.get('server.logger.dirname'), config.get('configs.import-pictures.logger.dirname') || '');  
  }
  else {
    job_logger.dirname = path.join(path.dirname(config.path), config.get('server.logger.dirname') || '', config.get('configs.import-pictures.logger.dirname') || '');
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

var projectsDir = config.get('configs.import-pictures.projectsDir');
if (!path.isAbsolute(projectsDir) || !fs.existsSync(projectsDir)) {
  logger.error(`projects directory invalid: ${projectsDir}`);
  return;
}

let base_url = config.get('configs.import-pictures.url');
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
    let protocol = http_options.protocol.match(/^https/i) == 'https' ? https : http;
    let request = protocol.request(http_options, (response) => {
      try {
        const { statusCode } = response;
        if (statusCode !== 200) throw new Error(`request failed with status code: ${statusCode}`);
          
        const contentType = response.headers['content-type'];
        let rawData = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { rawData += chunk; });
        response.on('end', () => {
          try {
            if (contentType.match(/^application\/json/)) {
              var json = JSON.parse(rawData);
              if (!json.success) throw new Error(json.message);
              resolve(json);
            }
            else {
              resolve(rawData);
            }

          }
          catch (error) {
            reject(error);
          }
        });
        response.on('error', (error) => {
          reject(error)
        });
      }
      catch (error) {
        response.resume();
        reject(error);
        return;
      }
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
    logger.log('verbose', 'import pictures from database...');
    let [ impi_response ] = await Promise.all([
      http_request('php/db.php/import-pictures'),
    ]);
    impi = impi_response.root;

    logger.log('debug', 'create import picturefiles promise...');
    let importPictureFile = async function(record) {
      let extname = path.extname(record.projectfilename);
      let basename = path.basename(record.projectfilename, extname);
      let dirname = path.join(projectsDir, basename + (extname.match(/\.plv/i) ? '.bsdocs' : '.BSDOCS'));
      if (!fs.existsSync(dirname)) throw new Error(`project directory ${dirname} does not exist`);

      let importdir = path.join(dirname, 'Photo');
      if (!fs.existsSync(importdir)) importdir = path.join(dirname, 'Photos');
      if (!fs.existsSync(importdir)) fs.mkdirSync(importdir);

      let picturedir = path.join(importdir, record.filedate.match(/^(\d*\-\d*).*/)[1]);
      if (!fs.existsSync(picturedir)) fs.mkdirSync(picturedir);
      if (record.status == '6') {
        picturedir = path.join(picturedir, 'Internal-Use-Only');
        if (!fs.existsSync(picturedir)) fs.mkdirSync(picturedir);
      }

      let filename = path.join(picturedir, record.filename);
      if (fs.existsSync(filename)) filename = path.join(picturedir, record.uuid + path.extname(record.filename));

      let rawData = await http_request('php/db.php/picturefiles', 'GET', {
        'uuid': record.uuid,
        'download': 'file',
        '__content': 'dataurl'
      });
      let data = rawData.replace(/^data:image\/\w+;base64,/,'');
      let buf = Buffer.from(data, 'base64');
      fs.writeFileSync(filename, buf);

      record.status = '5';
      await http_request('php/db.php/picturefiles', 'PUT', {
        'uuid': record.uuid,
        'status': record.status
      });
      return record;
    };

    logger.log('debug', 'import picturefiles...')
    let done = await Promise.all(impi.map(record => importPictureFile(record)));

    logger.log('debug', 'update pictures...');
    let updates = 0;
    done.forEach(record => {
      if (record.status == '5') updates++;
    });
    
    await http_request('php/db.php/import-pictures', 'PUT');

    if (updates) {
      logger.info(`import-pictures: ${updates} new pictures imported!`);
    }
    else {
      logger.info('import-pictures: no new pictures to import!');
    }
  }
  catch (error) {
    logger.error(error.message);
  }
};
main();