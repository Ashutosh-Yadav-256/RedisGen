'use strict';

var fs = require('fs');
var path = require('path');
var logger = require('../utils/logger');
var RespParser = require('../protocol/parser').RespParser;

function AofPersistence(config, store) {
    this._config = config;
    this._store = store;
    this._fd = null;
    this._writeBuffer = [];
    this._syncTimer = null;
    this._log = logger.getLogger();
}

AofPersistence.prototype.getFilePath = function () {
    var dir = this._config.get('dir');
    var filename = this._config.get('aof_filename');
    return path.resolve(dir, filename);
};

AofPersistence.prototype.open = function () {
    if (!this._config.get('appendonly')) return;

    var filePath = this.getFilePath();
    try {
        this._fd = fs.openSync(filePath, 'a');
        this._log.info('AOF: opened ' + filePath);
        this._startSync();
    } catch (err) {
        this._log.error('AOF: failed to open - ' + err.message);
    }
};

AofPersistence.prototype.close = function () {
    this._stopSync();
    this._flush();
    if (this._fd !== null) {
        try { fs.closeSync(this._fd); } catch (e) {}
        this._fd = null;
    }
};

AofPersistence.prototype.truncate = function () {
    var filePath = this.getFilePath();
    this.close();
    try {
        fs.writeFileSync(filePath, '', 'utf8');
        this._log.info('AOF: truncated ' + filePath);
    } catch (err) {
        this._log.error('AOF: truncate failed - ' + err.message);
    }
    this.open();
};

AofPersistence.prototype.appendCommand = function (cmdParts) {
    if (this._fd === null) return;

    var line = '*' + cmdParts.length + '\r\n';
    for (var i = 0; i < cmdParts.length; i++) {
        var s = String(cmdParts[i]);
        line += '$' + Buffer.byteLength(s) + '\r\n' + s + '\r\n';
    }

    this._writeBuffer.push(line);

    var policy = this._config.get('appendfsync');
    if (policy === 'always') {
        this._flush();
    }
};

AofPersistence.prototype.replay = function (dispatchFn, ctx) {
    var filePath = this.getFilePath();

    if (!fs.existsSync(filePath)) {
        this._log.info('AOF: no file found at ' + filePath);
        return 0;
    }

    var data;
    try {
        data = fs.readFileSync(filePath);
    } catch (err) {
        this._log.error('AOF: read failed - ' + err.message);
        return 0;
    }

    if (data.length === 0) return 0;

    var parser = new RespParser();
    parser.append(data);
    var commands = parser.parse();

    var replayed = 0;
    for (var i = 0; i < commands.length; i++) {
        var cmd = commands[i];
        if (Array.isArray(cmd) && cmd.length > 0) {
            try {
                dispatchFn(cmd, ctx);
                replayed++;
            } catch (err) {
                this._log.error('AOF: replay error at command ' + replayed + ' - ' + err.message);
            }
        }
    }

    this._log.info('AOF: replayed ' + replayed + ' commands from ' + filePath);
    return replayed;
};

AofPersistence.prototype._flush = function () {
    if (this._fd === null || this._writeBuffer.length === 0) return;

    var data = this._writeBuffer.join('');
    this._writeBuffer = [];

    try {
        fs.writeSync(this._fd, data);
        var policy = this._config.get('appendfsync');
        if (policy === 'always' || policy === 'everysec') {
            fs.fsyncSync(this._fd);
        }
    } catch (err) {
        this._log.error('AOF: write failed - ' + err.message);
    }
};

AofPersistence.prototype._startSync = function () {
    var policy = this._config.get('appendfsync');
    if (policy === 'everysec') {
        var self = this;
        this._syncTimer = setInterval(function () {
            self._flush();
        }, 1000);

        if (this._syncTimer.unref) {
            this._syncTimer.unref();
        }
    }
};

AofPersistence.prototype._stopSync = function () {
    if (this._syncTimer) {
        clearInterval(this._syncTimer);
        this._syncTimer = null;
    }
};

module.exports = { AofPersistence: AofPersistence };
