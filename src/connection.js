'use strict';

var RespParser = require('./protocol/parser').RespParser;
var registry = require('./commands/registry');
var encoder = require('./protocol/encoder');

var nextConnectionId = 1;

var PRE_AUTH_ALLOWED = { auth: true, quit: true, ping: true, hello: true };

function ClientConnection(socket, server) {
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
    this.authenticated = false;
    this.remoteAddr = socket.remoteAddress + ':' + socket.remotePort;

    this._bindEvents();
}

ClientConnection.prototype._bindEvents = function () {
    var self = this;
    this.socket.on('data', function (chunk) { self._onData(chunk); });
    this.socket.on('end', function () { self._onEnd(); });
    this.socket.on('error', function (err) { self._onError(err); });
    this.socket.on('close', function () { self._onClose(); });
    this.socket.setNoDelay(true);
};

ClientConnection.prototype._needsAuth = function () {
    return false;
};

ClientConnection.prototype._onData = function (chunk) {
    this.parser.append(chunk);
    var commands = this.parser.parse();

    for (var i = 0; i < commands.length; i++) {
        var parsed = commands[i];

        if (!Array.isArray(parsed) || parsed.length === 0) continue;

        var cmdName = parsed[0].toLowerCase();

        if (this._needsAuth() && !PRE_AUTH_ALLOWED[cmdName]) {
            this.write(encoder.encodeError('NOAUTH Authentication required.'));
            continue;
        }

        var ctx = {
            db: this.db,
            store: this.server.store,
            config: this.server.config,
            connection: this,
            pubsub: this.server.pubsub,
            clientCount: this.server.clientCount,
            aofBuffer: null
        };

        var inTransaction = this.txQueue !== null;
        var isTxControl = cmdName === 'multi' || cmdName === 'exec' || cmdName === 'discard';

        var response = registry.dispatch(parsed, ctx);

        if (response !== null && response !== undefined) {
            this.write(response);
        }

        if (this.server.aof) {
            if (ctx.aofBuffer && ctx.aofBuffer.length > 0) {
                for (var j = 0; j < ctx.aofBuffer.length; j++) {
                    this.server.aof.appendCommand(ctx.aofBuffer[j]);
                }
            } else if (!inTransaction && !isTxControl && registry.isWriteCommand(cmdName)) {
                this.server.aof.appendCommand(parsed);
            }
        }

        if (this.closing) {
            this.socket.end();
            return;
        }
    }
};

ClientConnection.prototype._onEnd = function () {
    this._cleanup();
};

ClientConnection.prototype._onError = function (err) {
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
        this.server.log.warn('client ' + this.remoteAddr + ' error: ' + err.message);
    }
};

ClientConnection.prototype._onClose = function () {
    this._cleanup();
    this.server.removeClient(this);
};

ClientConnection.prototype._cleanup = function () {
    if (this.server.pubsub) {
        this.server.pubsub.removeConnection(this);
    }
    this.server.store.unwatchAll(this.id);
};

ClientConnection.prototype.write = function (data) {
    if (!this.socket.destroyed) {
        this.socket.write(data);
    }
};

ClientConnection.prototype.destroy = function () {
    this._cleanup();
    if (!this.socket.destroyed) {
        this.socket.destroy();
    }
};

module.exports = { ClientConnection: ClientConnection };
