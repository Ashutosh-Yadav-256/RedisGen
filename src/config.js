'use strict';

const defaults = {
    port: 6379,
    bind: '127.0.0.1',
    databases: 16,
    maxmemory: 0,
    maxmemory_policy: 'noeviction',
    hz: 10,
    timeout: 0,
    tcp_backlog: 511,
    save: [[900, 1], [300, 10], [60, 10000]],
    appendonly: false,
    appendfsync: 'everysec',
    aof_filename: 'appendonly.aof',
    rdb_filename: 'dump.rdb',
    loglevel: 'notice',
    dir: '.',
    requirepass: '',
    ws_port: 8080
};

class ServerConfig {
    constructor(overrides) {
        this._data = Object.assign({}, defaults);
        if (overrides) {
            for (const key of Object.keys(overrides)) {
                if (key in this._data) {
                    this._data[key] = overrides[key];
                }
            }
        }
    }

    get(key) {
        return this._data[key];
    }

    set(key, value) {
        if (!(key in this._data)) {
            return false;
        }
        this._data[key] = value;
        return true;
    }

    all() {
        return Object.assign({}, this._data);
    }
}

module.exports = { ServerConfig, defaults };
