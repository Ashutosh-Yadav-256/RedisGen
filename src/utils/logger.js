'use strict';

const LEVELS = { debug: 0, verbose: 1, notice: 2, warning: 3 };

class Logger {
    constructor(level) {
        this._threshold = LEVELS[level] || LEVELS.notice;
        this._pid = process.pid;
    }

    _format(marker, msg) {
        const now = new Date();
        const ts = now.toISOString().replace('T', ' ').replace('Z', '');
        return `${this._pid}:M ${ts} ${marker} ${msg}`;
    }

    debug(msg) {
        if (this._threshold <= LEVELS.debug) {
            process.stdout.write(this._format('.', msg) + '\n');
        }
    }

    verbose(msg) {
        if (this._threshold <= LEVELS.verbose) {
            process.stdout.write(this._format('-', msg) + '\n');
        }
    }

    info(msg) {
        if (this._threshold <= LEVELS.notice) {
            process.stdout.write(this._format('*', msg) + '\n');
        }
    }

    warn(msg) {
        if (this._threshold <= LEVELS.warning) {
            process.stderr.write(this._format('#', msg) + '\n');
        }
    }

    error(msg) {
        process.stderr.write(this._format('#', msg) + '\n');
    }
}

let _instance = null;

function getLogger(level) {
    if (!_instance || level) {
        _instance = new Logger(level || 'notice');
    }
    return _instance;
}

module.exports = { Logger, getLogger };
