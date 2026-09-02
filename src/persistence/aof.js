'use strict';

const fs = require('fs');
const path = require('path');
const { getLogger } = require('../utils/logger');
const { RespParser } = require('../protocol/parser');

class AofPersistence {
    constructor(config, store) {
        this._config = config;
        this._store = store;
        this._fd = null;
        this._writeBuffer = [];
        this._syncTimer = null;
        this._log = getLogger();
    }

    getFilePath() {
        const dir = this._config.get('dir');
        const filename = this._config.get('aof_filename');
        return path.resolve(dir, filename);
    }

    open() {
        if (!this._config.get('appendonly')) return;

        const filePath = this.getFilePath();
        try {
            this._fd = fs.openSync(filePath, 'a');
            this._log.info('AOF: opened ' + filePath);
            this._startSync();
        } catch (err) {
            this._log.error('AOF: failed to open - ' + err.message);
        }
    }

    close() {
        this._stopSync();
        this._flush();
        if (this._fd !== null) {
            try { fs.closeSync(this._fd); } catch (e) {}
            this._fd = null;
        }
    }

    appendCommand(cmdParts) {
        if (this._fd === null) return;

        let line = '*' + cmdParts.length + '\r\n';
        for (let i = 0; i < cmdParts.length; i++) {
            const s = String(cmdParts[i]);
            line += '$' + Buffer.byteLength(s) + '\r\n' + s + '\r\n';
        }

        this._writeBuffer.push(line);

        const policy = this._config.get('appendfsync');
        if (policy === 'always') {
            this._flush();
        }
    }

    replay(dispatchFn, ctx) {
        const filePath = this.getFilePath();

        if (!fs.existsSync(filePath)) {
            this._log.info('AOF: no file found at ' + filePath);
            return 0;
        }

        let data;
        try {
            data = fs.readFileSync(filePath);
        } catch (err) {
            this._log.error('AOF: read failed - ' + err.message);
            return 0;
        }

        if (data.length === 0) return 0;

        const parser = new RespParser();
        parser.append(data);
        const commands = parser.parse();

        let replayed = 0;
        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
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
    }

    _flush() {
        if (this._fd === null || this._writeBuffer.length === 0) return;

        const data = this._writeBuffer.join('');
        this._writeBuffer = [];

        try {
            fs.writeSync(this._fd, data);
            const policy = this._config.get('appendfsync');
            if (policy === 'always' || policy === 'everysec') {
                fs.fsyncSync(this._fd);
            }
        } catch (err) {
            this._log.error('AOF: write failed - ' + err.message);
        }
    }

    _startSync() {
        const policy = this._config.get('appendfsync');
        if (policy === 'everysec') {
            this._syncTimer = setInterval(() => {
                this._flush();
            }, 1000);

            if (this._syncTimer.unref) {
                this._syncTimer.unref();
            }
        }
    }

    _stopSync() {
        if (this._syncTimer) {
            clearInterval(this._syncTimer);
            this._syncTimer = null;
        }
    }
}

module.exports = { AofPersistence };
