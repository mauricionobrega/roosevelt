'use strict';
var fs = require('fs'),                           // utility library for filesystem access
    path = require('path'),                       // utilities for handling and transforming file paths
    express = require('express'),                 // express http server
    teddy = require('teddy'),                     // teddy templating engine
    less = require('less'),                       // for LESS CSS preprocessing
    formidable = require('formidable'),           // for multipart forms
    toobusy = require('toobusy'),                 // monitors the process and serves 503 responses when it's too busy
    wrench = require('wrench'),                   // recursive file operations
    colors = require('colors'),                   // for coloring the command line tool
    os = require('os'),                           // operating system info
    cluster = require('cluster'),                 // multicore support
    numCPUs = 1,                                  // default number of CPUs to use

    // location of the main module
    appDir = os.platform() !== 'win32' ? module.parent.filename.replace(module.parent.filename.split('/')[module.parent.filename.split('/').length - 1], '') : module.parent.filename.replace(module.parent.filename.split('\\')[module.parent.filename.split('\\').length - 1], ''),

    // storing contents of package.json for later use
    pkg = require(appDir + 'package.json'),

    // string appended to the end of roosevelt system messages in multithreading mode
    threadSuffix = cluster.worker ? ' (thread ' + cluster.worker.id + ')' : '',

    // other utility vars for later use
    server,
    i;

module.exports = function(params) {
  params = params || {};

  var app = express(), // initialize express

      // run custom express configs if supplied
      onServerStart = function() {
        if (params.onServerStart && typeof params.onServerStart === 'function') {
          params.onServerStart(app);
        }
      },

      // defines app.get values that roosevelt exposes through express
      setMemberVars = function() {

        // expose submodules
        app.set('express', express);
        app.set('teddy', teddy);
        app.set('formidable', formidable);

        // expose directory the main module is in
        app.set('appDir', appDir);

        // expose package.json
        pkg.rooseveltConfig = pkg.rooseveltConfig || {};
        app.set('package', pkg);

        // set app name from package.json
        app.set('appName', pkg.name || 'Roosevelt Express');

        // define staticsRoot before other params because other params depend on it
        params.staticsRoot = params.staticsRoot || pkg.rooseveltConfig.staticsRoot || 'statics/';
        app.set('staticsRoot', path.normalize(params.staticsRoot));

        // source remaining params from params argument, then package.json, then defaults
        params = {
          port: params.port || pkg.rooseveltConfig.port || process.env.NODE_PORT || 43711,
          modelsPath: params.modelsPath || pkg.rooseveltConfig.modelsPath || 'mvc/models/',
          viewsPath: params.viewsPath || pkg.rooseveltConfig.viewsPath || 'mvc/views/',
          controllersPath: params.controllersPath || pkg.rooseveltConfig.controllersPath || 'mvc/controllers/',
          notFoundPage: params.notFoundPage || pkg.rooseveltConfig.notFoundPage || '404.js',
          internalServerErrorPage: params.internalServerErrorPage || pkg.rooseveltConfig.internalServerErrorPage || '500.js',
          serviceUnavailablePage: params.serviceUnavailablePage || pkg.rooseveltConfig.serviceUnavailablePage || '503.js',
          staticsRoot: params.staticsRoot, // default hierarchy defined above because below params depend on this one being predefined
          cssPath: params.cssPath || pkg.rooseveltConfig.cssPath || params.staticsRoot + 'css/',
          lessPath: params.lessPath || pkg.rooseveltConfig.lessPath || params.staticsRoot + 'less/',
          lessCompileWhitelist: params.lessCompileWhitelist || pkg.rooseveltConfig.lessCompileWhitelist || [],
          publicFolder: params.publicFolder || pkg.rooseveltConfig.publicFolder || 'public/',
          prefixStaticsWithVersion: params.prefixStaticsWithVersion || pkg.rooseveltConfig.prefixStaticsWithVersion || false,
          versionNumberLessVar: params.versionNumberLessVar || pkg.rooseveltConfig.versionNumberLessVar || undefined,
          publicStatics: params.publicStatics || pkg.rooseveltConfig.publicStatics || ['css', 'images', 'js'],
          alwaysHostStatics: params.alwaysHostStatics || pkg.rooseveltConfig.alwaysHostStatics || false,
          disableLogger: params.disableLogger || pkg.rooseveltConfig.disableLogger || false,
          localhostOnly: params.localhostOnly || pkg.rooseveltConfig.localhostOnly || true,
          disableMultipart: params.disableMultipart || pkg.rooseveltConfig.disableMultipart || false,
          formidableSettings: params.formidableSettings || pkg.formidableSettings || {},
          maxLagPerRequest: params.maxLagPerRequest || pkg.maxLagPerRequest || 70,
          shutdownTimeout: params.shutdownTimeout || pkg.shutdownTimeout || 30000,
          onServerStart: params.onServerStart || undefined,
          onReqStart: params.onReqStart || undefined,
          onReqBeforeRoute: params.onReqBeforeRoute || undefined,
          onReqAfterRoute: params.onReqAfterRoute || undefined
        };

        // define maximum number of miliseconds to wait for a given request to finish
        toobusy.maxLag(params.maxLagPerRequest);

        // ensure formidableSettings is an object
        if (typeof params.formidableSettings !== 'object') {
          params.formidableSettings = {};
        }

        // add trailing slashes where necessary
        ['modelsPath', 'viewsPath', 'controllersPath', 'staticsRoot', 'publicFolder', 'cssPath', 'lessPath'].forEach(function(i) {
          var path = params[i],
              finalChar = path.charAt(path.length - 1);
          params[i] = (finalChar !== '/' && finalChar !== '\\') ? path + '/' : path;
        });

        // map mvc paths
        app.set('modelsPath', path.normalize(appDir + params.modelsPath));
        app.set('viewsPath', path.normalize(appDir + params.viewsPath));
        app.set('controllersPath', path.normalize(appDir + params.controllersPath));

        // map statics paths
        app.set('cssPath', path.normalize(appDir + params.cssPath));
        app.set('lessPath', path.normalize(appDir + params.lessPath));
        app.set('publicFolder', path.normalize(appDir + params.publicFolder));

        // determine statics prefix if any
        params.staticsPrefix = params.prefixStaticsWithVersion ? pkg.version || '' : '';

        // ensure 404 page exists
        params.notFoundPage = app.get('controllersPath') + params.notFoundPage;
        if (!fs.existsSync(params.notFoundPage)) {
          params.notFoundPage = appDir + 'node_modules/roosevelt/defaultErrorPages/controllers/404.js';
        }

        // ensure 500 page exists
        if (!fs.existsSync(params.internalServerErrorPage)) {
          params.internalServerErrorPage = appDir + 'node_modules/roosevelt/defaultErrorPages/controllers/500.js';
        }

        // ensure 503 page exists
        if (!fs.existsSync(params.serviceUnavailablePage)) {
          params.serviceUnavailablePage = appDir + 'node_modules/roosevelt/defaultErrorPages/controllers/503.js';
        }

        app.set('params', params);

        // enable gzip compression
        app.use(express.compress());

        // bind user-defined middleware which fires at the beginning of a request if supplied
        if (params.onReqStart && typeof params.onReqStart === 'function') {
          app.use(params.onReqStart);
        }
      },

      // activate LESS CSS preprocessing
      preprocessCSS = function() {

        var versionFile = app.get('lessPath') + 'version.less',
            versionCode = '/* do not edit; generated automatically by Roosevelt */ @' + params.versionNumberLessVar + ': \'' + pkg.version + '\';',
            lessFiles = params.lessCompileWhitelist.length ? params.lessCompileWhitelist : wrench.readdirSyncRecursive(app.get('lessPath')),
            parser = new less.Parser({
              paths: app.get('lessPath')
            });

        // make css directory if not present
        if (!fs.existsSync(app.get('cssPath'))) {
          fs.mkdirSync(app.get('cssPath'));
          console.log(((pkg.name || 'Roosevelt') + ' making new directory ' + app.get('cssPath').replace(app.get('appDir'), '') + threadSuffix).yellow);
        }

        // write app version to version.less to force statics versioning
        if (params.versionNumberLessVar) {
          if (fs.readFileSync(versionFile, 'utf8') !== versionCode) {
            fs.writeFile(versionFile, versionCode, function(err) {
              if (err) {
                console.error(((pkg.name || 'Roosevelt') + ' failed to write version.less file!' + threadSuffix).red);
                console.error(err);
              }
              else {
                console.log(((pkg.name || 'Roosevelt') + ' writing new version.less to reflect new version: ' + pkg.version + threadSuffix).green);
              }
            });
          }
        }

        lessFiles.forEach(function(file) {
          (function(file) {
            parser.parse(fs.readFileSync(app.get('lessPath') + file, 'utf8'), function(e, tree) {
              var newFile = app.get('cssPath') + file.replace('.less', '.css');
              console.log(((pkg.name || 'Roosevelt') + ' writing new CSS file ' + newFile + threadSuffix).green);
              fs.writeFileSync(newFile, tree.toCSS({
                compress: true,
                yuicompress: true
              }));
            });
          })(file);
        });
      },

      // configure specific express options
      setExpressConfigs = function() {

        // set port
        app.set('port', params.port);

        // remove unnecessary response headers
        app.disable('x-powered-by');
        app.disable('etag');

        // close connections gracefully if server is being shut down
        app.use(function(req, res, next) {
          if (app.get('roosevelt:state') !== 'disconnecting') {
            next();
          }
          else {
            require(params.serviceUnavailablePage)(app, req, res);
          }
        });

        // dumps http requests to the console
        if (!params.disableLogger) {
          app.use(express.logger());
        }

        // defines req.body by parsing http requests
        app.use(express.json());
        app.use(express.urlencoded());

        // enables PUT and DELETE requests via <input type='hidden' name='_method' value='put'/> and suchlike
        app.use(express.methodOverride());

        // 500 internal server error page
        app.use(function(err, req, res, next){
          console.error(err.stack);
          require(params.internalServerErrorPage)(app, err, req, res);
        });

        // set templating engine
        app.set('views', app.get('viewsPath'));
        app.set('view engine', 'html');
        app.engine('html', app.get('teddy').__express);

        // list all view files to determine number of extensions
        var viewFiles = wrench.readdirSyncRecursive(app.get('viewsPath')),
            extensions = {};

        // make list of extensions
        viewFiles.forEach(function(file) {
          var extension = file.substring(file.lastIndexOf('.') + 1, file.length);
          extensions[extension] = extension;
        });

        // use teddy as renderer for all view file types
        Object.keys(extensions).forEach(function(extension) {
          app.engine(extension, app.get('teddy').__express);
        });
      },

      mapRoutes = function() {
        var controllerFiles,
            publicDir;

        // serve 503 page if the process is too busy
        app.use(function(req, res, next) {
          if (toobusy()) {
            require(params.serviceUnavailablePage)(app, req, res);
          }
          else {
            next();
          }
        });

        // bind user-defined middleware which fires just before executing the controller if supplied
        if (params.onReqBeforeRoute && typeof params.onReqBeforeRoute === 'function') {
          app.use(params.onReqBeforeRoute);
        }

        if (!params.disableMultipart) {
          // middleware to handle forms with formidable
          app.use(function(req, res, next) {
            var form, contentType = req.headers['content-type'];

            if (typeof contentType === 'string' && contentType.indexOf('multipart/form-data') > -1) {
              form = new formidable.IncomingForm(params.formidableSettings);
              form.parse(req, function(err, fields, files) {
                if (err) {
                  console.error(((pkg.name || 'Roosevelt') + ' failed to parse multipart form at ' + req.url + threadSuffix).red);
                  console.error(err);
                  next(err);
                  return;
                }
                req.body = fields; // pass along form fields
                req.files = files; // pass along files

                // remove tmp files after request finishes
                var cleanup = function() {
                  Object.keys(files).forEach(function(file) {
                    var filePath = files[file].path;
                    if (typeof filePath === 'string') {
                      fs.exists(filePath, function(exists) {
                        fs.unlink(filePath, function(err) {
                          if (err) {
                            if (err.errno === 34 && err.code === 'ENOENT') {
                              return; // ignore file not found error
                            }
                            else {
                              console.error(((pkg.name || 'Roosevelt') + ' failed to remove tmp file: ' + filePath + threadSuffix).red);
                              console.error(err);
                            }
                          }
                        });
                      });
                    }
                  });
                };
                res.once('finish', cleanup);
                res.once('close', cleanup);
                next();
              });
            }
            else {
              next();
            }
          });
        }

        // bind user-defined middleware which fires after request ends if supplied
        if (params.onReqAfterRoute && typeof params.onReqAfterRoute === 'function') {
          app.use(function(req, res, next) {
            var afterEnd = function() {
              params.onReqAfterRoute(req, res);
            };
            res.once('finish', afterEnd);
            res.once('close', afterEnd);
            res.once('error', afterEnd);
            next();
          });
        }

        // method for roosevelt users to conveniently load models from their controllers
        app.set('model', function(model) {
          return require(app.get('modelsPath') + model);
        });

        // get public folder up and running
        publicDir = path.normalize(params.publicFolder);

        // make public folder itself if it doesn't exist
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir);
          console.log(((pkg.name || 'Roosevelt') + ' making new directory ' + publicDir.replace(app.get('appDir'), '') + threadSuffix).yellow);
        }

        // make statics prefix folder if the setting is enabled
        if (params.staticsPrefix) {
          publicDir += path.normalize(params.staticsPrefix + '/');
          if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir);
            console.log(((pkg.name || 'Roosevelt') + ' making new directory ' + publicDir.replace(app.get('appDir'), '') + threadSuffix).yellow);
          }
        }

        // make symlinks to public statics
        params.publicStatics.forEach(function(pubStatic) {
          var linkTarget = (appDir + publicDir + pubStatic),
              staticTarget = (appDir + params.staticsRoot + pubStatic);

          // make static target folder if it hasn't yet been created
          if (!fs.existsSync(staticTarget)) {
            fs.mkdirSync(staticTarget);
            console.log(((pkg.name || 'Roosevelt') + ' making new directory ' + staticTarget.replace(app.get('appDir'), '') + threadSuffix).yellow);
          }

          // make symlink if it doesn't yet exist
          if (!fs.existsSync(linkTarget) || !fs.lstatSync(linkTarget) || !fs.lstatSync(linkTarget).isSymbolicLink()) {
            fs.symlinkSync(staticTarget, linkTarget, 'junction');
            console.log(((pkg.name || 'Roosevelt') + ' making new symlink ').cyan + (linkTarget.replace(app.get('appDir'), '')).yellow + (' pointing to ').cyan + (staticTarget.replace(app.get('appDir'), '')).yellow + (threadSuffix).cyan);
          }
        });

        // map statics for developer mode
        if (params.alwaysHostStatics || app.get('env') === 'development') {
          app.use('/' + params.staticsPrefix, express.static(appDir + app.get('staticsRoot')));
        }

        // build list of controller files
        app.use(app.router);
        try {
          controllerFiles = wrench.readdirSyncRecursive(app.get('controllersPath'));
        }
        catch (e) {
          console.error(((pkg.name || 'Roosevelt') + ' fatal error: could not load controller files from ' + app.get('controllersPath') + threadSuffix).red);
          console.error(e);
        }

        // load all controllers
        controllerFiles.forEach(function(controllerName) {
          var notFoundPage = os.platform() !== 'win32' ? controllerName.indexOf(params.notFoundPage.split('/').pop()) : controllerName.indexOf(params.notFoundPage.split('\\').pop());
          if (notFoundPage < 0) {
            try {
              if (fs.statSync(app.get('controllersPath') + controllerName).isFile()) {
                require(app.get('controllersPath') + controllerName)(app);
              }
            }
            catch (e) {
              console.error(((pkg.name || 'Roosevelt') + ' failed to load controller file: ' + controllerName + '. Please make sure it is coded correctly. See documentation at http://github.com/kethinov/roosevelt for examples.' + threadSuffix).red);
              console.error(e);
            }
          }
        });

        // load 404 controller last so that it doesn't supersede the others
        try {
          require(params.notFoundPage)(app);
        }
        catch (e) {
          console.error(((pkg.name || 'Roosevelt') + ' failed to load 404 controller file: ' + params.notFoundPage + '. Please make sure it is coded correctly. See documentation at http://github.com/kethinov/roosevelt for examples.' + threadSuffix).red);
          console.error(e);
        }
      },

      gracefulShutdown = function() {
        app.set('roosevelt:state', 'disconnecting');
        console.log(("\n" + (pkg.name || 'Roosevelt') + ' received kill signal, attempting to shut down gracefully.' + threadSuffix).magenta);
        server.close(function() {
          console.log(((pkg.name || 'Roosevelt') + ' successfully closed all connections and shut down gracefully.' + threadSuffix).magenta);
          process.exit();
        });
        setTimeout(function() {
          console.error(((pkg.name || 'Roosevelt') + ' could not close all connections in time; forcefully shutting down.' + threadSuffix).red);
          process.exit(1);
        }, app.get('params').shutdownTimeout);
      };

  app.configure(function() {
    onServerStart();
    setMemberVars();
    preprocessCSS();
    setExpressConfigs();
    mapRoutes();
  });

  // determine number of CPUs to use
  process.argv.some(function(val, index, array) {
    var arg = array[index + 1],
        max = os.cpus().length;
    if (val === '-cores') {
      if (arg === 'max') {
        numCPUs = max;
      }
      else {
        arg = parseInt(arg);
        if (arg <= max && arg > 0) {
          numCPUs = arg;
        }
        else {
          console.error(((pkg.name || 'Roosevelt') + ' warning: invalid value "' + array[index + 1] + '" supplied to -cores param.' + threadSuffix).red);
          numCPUs = 1;
        }
      }
      return;
    }
  });

  // start server
  if (cluster.isMaster && numCPUs > 1) {
    for (i = 0; i < numCPUs; i++) {
      cluster.fork();
    }
    cluster.on('exit', function(worker, code, signal) {
      console.log(((pkg.name || 'Roosevelt') + ' thread ' + worker.process.pid + ' died').magenta);
    });
  }
  else {
    server = app.listen(app.get('port'), (params.localhostOnly && app.get('env') !== 'development' ? 'localhost' : null), function() {
      console.log((pkg.name + ' server listening on port ' + app.get('port') + ' (' + app.get('env') + ' mode)' + threadSuffix).bold);
    });
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  }

  return app;
};