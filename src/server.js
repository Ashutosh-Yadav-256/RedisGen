'use strict';

const net = require('net');
const { ServerConfig } = require('./config');
const { DataStore } = require('./datastore/store');
const { ClientConnection } = require('./connection');
const { PubSubBroker } = require('./commands/pubsub');
const { RdbPersistence } = require('./persistence/rdb');
const { AofPersistence } = require('./persistence/aof');
const { getLogger } = require('./utils/logger');
const { dispatch } = require('./commands/registry');

class RedisGenServer {
    constructor(options) {
        this.config = new ServerConfig(options);
        this.log = getLogger(this.config.get('loglevel'));
        this.store = new DataStore(this.config.get('databases'));
        this.pubsub = new PubSubBroker();
        this.rdb = new RdbPersistence(this.config, this.store);
        this.aof = new AofPersistence(this.config, this.store);
        this._clients = new Set();
        this._server = null;
        this._startTime = Date.now();
    }

    start() {
        const port = this.config.get('port');
        const bind = this.config.get('bind');

        this._printBanner(port);

        this._loadData();

        this._server = net.createServer((socket) => {
            this._onConnection(socket);
        });

        this._server.maxConnections = 10000;

        this._server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                this.log.error('Port ' + port + ' is already in use. Shutting down.');
                process.exit(1);
            }
            this.log.error('Server error: ' + err.message);
        });

        this._server.listen(port, bind, () => {
            this.log.info('Ready to accept connections on port ' + port);
        });

        this.store.expiry.startActiveSweep(this.store, this.config.get('hz'));
        this.rdb.startAutoSave();

        if (this.config.get('appendonly')) {
            this.aof.open();
        }

        this._setupShutdown();
    }

    _onConnection(socket) {
        const conn = new ClientConnection(socket, this);
        this._clients.add(conn);
        this.log.debug('Client connected: ' + conn.remoteAddr + ' (id=' + conn.id + ')');
    }

    removeClient(conn) {
        this._clients.delete(conn);
        this.log.debug('Client disconnected: ' + conn.remoteAddr + ' (id=' + conn.id + ')');
    }

    get clientCount() {
        return this._clients.size;
    }

    _loadData() {
        const loaded = this.rdb.load();

        if (this.config.get('appendonly')) {
            const ctx = {
                db: 0,
                store: this.store,
                config: this.config,
                connection: { db: 0, id: 0, name: null },
                pubsub: this.pubsub,
                clientCount: 0
            };

            const count = this.aof.replay(dispatch, ctx);
            if (count > 0) {
                this.log.info('AOF: replayed ' + count + ' commands');
            }
        }
    }

    _printBanner(port) {
        const lines = [
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
        for (const line of lines) {
            process.stdout.write(line + '\n');
        }
    }

    _setupShutdown() {
        const graceful = () => {
            this.log.info('Shutting down...');

            this.store.expiry.stopActiveSweep();
            this.rdb.stopAutoSave();

            this.rdb.save();
            this.aof.close();

            for (const client of this._clients) {
                client.destroy();
            }
            this._clients.clear();

            if (this._server) {
                this._server.close(() => {
                    this.log.info('Server stopped.');
                    process.exit(0);
                });
            }

            setTimeout(() => {
                process.exit(0);
            }, 3000);
        };

        process.on('SIGINT', graceful);
        process.on('SIGTERM', graceful);
    }

    stop() {
        this.store.expiry.stopActiveSweep();
        this.rdb.stopAutoSave();
        this.aof.close();

        for (const client of this._clients) {
            client.destroy();
        }
        this._clients.clear();

        if (this._server) {
            this._server.close();
            this._server = null;
        }
    }
}

function parseCliArgs() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i].replace(/^--/, '');

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
    const options = parseCliArgs();
    const server = new RedisGenServer(options);
    server.start();
}

module.exports = { RedisGenServer };
