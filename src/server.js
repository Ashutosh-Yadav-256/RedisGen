'use strict';

var net = require('net');
var ServerConfig = require('./config').ServerConfig;
var DataStore = require('./datastore/store').DataStore;
var ClientConnection = require('./connection').ClientConnection;
var PubSubBroker = require('./commands/pubsub').PubSubBroker;
var RdbPersistence = require('./persistence/rdb').RdbPersistence;
var AofPersistence = require('./persistence/aof').AofPersistence;
var logger = require('./utils/logger');
var registry = require('./commands/registry');

function RedisGenServer(options) {
    this.config = new ServerConfig(options);
    this.log = logger.getLogger(this.config.get('loglevel'));
    this.store = new DataStore(this.config.get('databases'), this.config);
    this.pubsub = new PubSubBroker();
    this.rdb = new RdbPersistence(this.config, this.store);
    this.aof = new AofPersistence(this.config, this.store);
    this._clients = new Set();
    this._server = null;
    this._startTime = Date.now();
}

RedisGenServer.prototype.start = function () {
    var self = this;
    var port = this.config.get('port');
    var bind = this.config.get('bind');

    this._printBanner(port);

    this._loadData();

    this._server = net.createServer(function (socket) {
        self._onConnection(socket);
    });

    this._server.maxConnections = 10000;

    this._server.on('error', function (err) {
        if (err.code === 'EADDRINUSE') {
            self.log.error('Port ' + port + ' is already in use. Shutting down.');
            process.exit(1);
        }
        self.log.error('Server error: ' + err.message);
    });

    this._server.listen(port, bind, function () {
        self.log.info('Ready to accept connections on port ' + port);
    });

    this.store.expiry.startActiveSweep(this.store, this.config.get('hz'));
    this.rdb.startAutoSave();

    if (this.config.get('appendonly')) {
        this.aof.open();
    }

    this._setupShutdown();
};

RedisGenServer.prototype._onConnection = function (socket) {
    var conn = new ClientConnection(socket, this);
    this._clients.add(conn);
    this.log.debug('Client connected: ' + conn.remoteAddr + ' (id=' + conn.id + ')');
};

RedisGenServer.prototype.removeClient = function (conn) {
    this._clients.delete(conn);
    this.log.debug('Client disconnected: ' + conn.remoteAddr + ' (id=' + conn.id + ')');
};

Object.defineProperty(RedisGenServer.prototype, 'clientCount', {
    get: function () { return this._clients.size; }
});

RedisGenServer.prototype._loadData = function () {
    var useAof = this.config.get('appendonly');

    if (useAof) {
        var ctx = {
            db: 0,
            store: this.store,
            config: this.config,
            connection: { db: 0, id: 0, name: null, txQueue: null },
            pubsub: this.pubsub,
            clientCount: 0,
            aofBuffer: null
        };

        this.store._restoring = true;
        var count = this.aof.replay(registry.dispatch, ctx);
        this.store._restoring = false;
        this.store.resetDirty();

        if (count > 0) {
            this.log.info('AOF: replayed ' + count + ' commands');
        }
    } else {
        this.rdb.load();
    }
};

RedisGenServer.prototype._printBanner = function (port) {
    var lines = [
        '',
        '  ____          _ _      ____',
        ' |  _ \\ ___  __| (_)___ / ___| ___ _ __',
        " | |_) / _ \\/ _` | / __| |  _ / _ \\ '_ \\",
        ' |  _ <  __/ (_| | \\__ \\ |_| |  __/ | | |',
        ' |_| \\_\\___|\\__,_|_|___/\\____|\\___|_| |_|',
        '',
        '  Port: ' + port,
        '  PID:  ' + process.pid,
        '  Node: ' + process.version,
        ''
    ];
    for (var i = 0; i < lines.length; i++) {
        process.stdout.write(lines[i] + '\n');
    }
};

RedisGenServer.prototype._setupShutdown = function () {
    var self = this;
    var graceful = function () {
        self.log.info('Shutting down...');

        self.store.expiry.stopActiveSweep();
        self.rdb.stopAutoSave();

        self.rdb.save();

        if (self.config.get('appendonly')) {
            self.aof.truncate();
        }

        self.aof.close();

        for (var client of self._clients) {
            client.destroy();
        }
        self._clients.clear();

        if (self._server) {
            self._server.close(function () {
                self.log.info('Server stopped.');
                process.exit(0);
            });
        }

        setTimeout(function () {
            process.exit(0);
        }, 3000);
    };

    process.on('SIGINT', graceful);
    process.on('SIGTERM', graceful);
};

RedisGenServer.prototype.stop = function () {
    this.store.expiry.stopActiveSweep();
    this.rdb.stopAutoSave();
    this.aof.close();

    for (var client of this._clients) {
        client.destroy();
    }
    this._clients.clear();

    if (this._server) {
        this._server.close();
        this._server = null;
    }
};

function parseCliArgs() {
    var args = process.argv.slice(2);
    var options = {};

    for (var i = 0; i < args.length; i++) {
        var arg = args[i].replace(/^--/, '');

        switch (arg) {
            case 'port':
                options.port = parseInt(args[++i], 10);
                break;
            case 'bind':
                options.bind = args[++i];
                break;
            case 'databases':
                options.databases = parseInt(args[++i], 10);
                break;
            case 'maxmemory':
                options.maxmemory = parseInt(args[++i], 10);
                break;
            case 'maxmemory-policy':
                options.maxmemory_policy = args[++i];
                break;
            case 'appendonly':
                options.appendonly = args[++i].toLowerCase() === 'yes';
                break;
            case 'dir':
                options.dir = args[++i];
                break;
            case 'loglevel':
                options.loglevel = args[++i];
                break;
            case 'hz':
                options.hz = parseInt(args[++i], 10);
                break;
            default:
                break;
        }
    }

    return options;
}

if (require.main === module) {
    var options = parseCliArgs();
    var server = new RedisGenServer(options);
    server.start();
}

module.exports = { RedisGenServer: RedisGenServer };
