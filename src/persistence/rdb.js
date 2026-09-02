'use strict';

var fs = require('fs');
var path = require('path');
var logger = require('../utils/logger');

function RdbPersistence(config, store) {
    this._config = config;
    this._store = store;
    this._saveTimer = null;
    this._lastSaveTime = Date.now();
    this._lastSaveDirty = 0;
    this._log = logger.getLogger();
}

RdbPersistence.prototype.getFilePath = function () {
    var dir = this._config.get('dir');
    var filename = this._config.get('rdb_filename');
    return path.resolve(dir, filename);
};

RdbPersistence.prototype.save = function () {
    var filePath = this.getFilePath();
    var snapshot = this._buildSnapshot();

    try {
        var tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(snapshot), 'utf8');
        fs.renameSync(tmpPath, filePath);
        this._lastSaveTime = Date.now();
        this._lastSaveDirty = this._store.dirty;
        this._log.info('RDB: snapshot saved to ' + filePath);
        return true;
    } catch (err) {
        this._log.error('RDB: save failed - ' + err.message);
        return false;
    }
};

RdbPersistence.prototype.load = function () {
    var filePath = this.getFilePath();

    if (!fs.existsSync(filePath)) {
        this._log.info('RDB: no snapshot found at ' + filePath);
        return false;
    }

    try {
        var raw = fs.readFileSync(filePath, 'utf8');
        var snapshot = JSON.parse(raw);
        this._restoreSnapshot(snapshot);
        this._log.info('RDB: loaded snapshot from ' + filePath);
        return true;
    } catch (err) {
        this._log.error('RDB: load failed - ' + err.message);
        return false;
    }
};

RdbPersistence.prototype.startAutoSave = function () {
    var saveRules = this._config.get('save');
    if (!saveRules || saveRules.length === 0) return;

    var self = this;
    this._saveTimer = setInterval(function () {
        self._checkAutoSave(saveRules);
    }, 1000);

    if (this._saveTimer.unref) {
        this._saveTimer.unref();
    }
};

RdbPersistence.prototype.stopAutoSave = function () {
    if (this._saveTimer) {
        clearInterval(this._saveTimer);
        this._saveTimer = null;
    }
};

RdbPersistence.prototype._checkAutoSave = function (rules) {
    var now = Date.now();
    var elapsed = (now - this._lastSaveTime) / 1000;
    var changes = this._store.dirty - this._lastSaveDirty;

    for (var i = 0; i < rules.length; i++) {
        var seconds = rules[i][0];
        var minChanges = rules[i][1];
        if (elapsed >= seconds && changes >= minChanges) {
            this._log.info('RDB: auto-save triggered (' + changes + ' changes in ' + Math.floor(elapsed) + 's)');
            this.save();
            return;
        }
    }
};

RdbPersistence.prototype._buildSnapshot = function () {
    var databases = {};

    for (var i = 0; i < this._store.dbCount; i++) {
        var data = this._store.exportDbData(i);
        if (Object.keys(data).length > 0) {
            databases[i] = {};
            for (var key in data) {
                var entry = data[key];
                databases[i][key] = {
                    type: entry.type,
                    value: this._serializeValue(entry.value, entry.type)
                };
            }
        }
    }

    var expiries = this._store.expiry.exportAll();

    return {
        magic: 'REDISGEN',
        version: 1,
        timestamp: Date.now(),
        databases: databases,
        expiries: expiries
    };
};

RdbPersistence.prototype._restoreSnapshot = function (snapshot) {
    if (snapshot.magic !== 'REDISGEN') {
        throw new Error('invalid snapshot format');
    }

    this._store.flushAll();
    this._store._restoring = true;

    for (var dbIdx in snapshot.databases) {
        var db = parseInt(dbIdx, 10);
        var entries = snapshot.databases[dbIdx];

        for (var key in entries) {
            var entry = entries[key];
            var value = this._deserializeValue(entry.value, entry.type);
            this._store.set(db, key, value, entry.type);
        }
    }

    if (snapshot.expiries) {
        var now = Date.now();
        for (var mapKey in snapshot.expiries) {
            var deadline = snapshot.expiries[mapKey];
            if (deadline > now) {
                this._store.expiry.importAll({ [mapKey]: deadline });
            }
        }
    }

    this._store._restoring = false;
    this._store.resetDirty();
};

RdbPersistence.prototype._serializeValue = function (value, type) {
    if (type === 'hash' && value instanceof Map) {
        return Array.from(value.entries());
    }
    if (type === 'set' && value instanceof Set) {
        return Array.from(value);
    }
    if (type === 'zset' && value && value.members instanceof Map) {
        return {
            members: Array.from(value.members.entries()),
            sorted: value.sorted
        };
    }
    return value;
};

RdbPersistence.prototype._deserializeValue = function (value, type) {
    if (type === 'hash' && Array.isArray(value)) {
        return new Map(value);
    }
    if (type === 'set' && Array.isArray(value)) {
        return new Set(value);
    }
    if (type === 'zset' && value && Array.isArray(value.members)) {
        return {
            members: new Map(value.members),
            sorted: value.sorted || []
        };
    }
    return value;
};

module.exports = { RdbPersistence: RdbPersistence };
