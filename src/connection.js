'use strict';

const { RespParser } = require('./protocol/parser');
const { dispatch, isWriteCommand } = require('./commands/registry');

let nextConnectionId = 1;

class ClientConnection {
    constructor(socket, server) {
        this.id = nextConnectionId++;
        this.socket = socket;
        this.server = server;
        this.db = 0;
        this.name = null;
        this.parser = new RespParser();
        this.txQueue = null;
        this.subscriptions = null;
        this.patternSubs = null;
        this.closing = false;
        this.remoteAddr = socket.remoteAddress + ':' + socket.remotePort;

        this._bindEvents();
    }

    _bindEvents() {
        this.socket.on('data', (chunk) => this._onData(chunk));
        this.socket.on('end', () => this._onEnd());
        this.socket.on('error', (err) => this._onError(err));
        this.socket.on('close', () => this._onClose());
        this.socket.setNoDelay(true);
    }

    _onData(chunk) {
        this.parser.append(chunk);
        const commands = this.parser.parse();

        for (let i = 0; i < commands.length; i++) {
            const parsed = commands[i];

            if (!Array.isArray(parsed) || parsed.length === 0) continue;

            const ctx = {
                db: this.db,
                store: this.server.store,
                config: this.server.config,
                connection: this,
                pubsub: this.server.pubsub,
                clientCount: this.server.clientCount
            };

            const response = dispatch(parsed, ctx);

            if (response !== null && response !== undefined) {
                this.write(response);
            }

            if (isWriteCommand(parsed[0]) && this.server.aof) {
                this.server.aof.appendCommand(parsed);
            }

            if (this.closing) {
                this.socket.end();
                return;
            }
        }
    }

    _onEnd() {
        this._cleanup();
    }

    _onError(err) {
        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
            this.server.log.warn('client ' + this.remoteAddr + ' error: ' + err.message);
        }
    }

    _onClose() {
        this._cleanup();
        this.server.removeClient(this);
    }

    _cleanup() {
        if (this.server.pubsub) {
            this.server.pubsub.removeConnection(this);
        }
        this.server.store.unwatchAll(this.id);
    }

    write(data) {
        if (!this.socket.destroyed) {
            this.socket.write(data);
        }
    }

    destroy() {
        this._cleanup();
        if (!this.socket.destroyed) {
            this.socket.destroy();
        }
    }
}

module.exports = { ClientConnection };
