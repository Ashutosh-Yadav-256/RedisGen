'use strict';

var ExpiryManager = require('./expiry').ExpiryManager;
var LRUEviction = require('./lru').LRUEviction;

var TYPE_STRING = 'string';
var TYPE_LIST = 'list';
var TYPE_SET = 'set';
var TYPE_ZSET = 'zset';
var TYPE_HASH = 'hash';

function DataStore(dbCount, config) {
    this.dbCount = dbCount || 16;
    this._config = config || null;
    this._dbs = [];
    this._types = [];
    for (var i = 0; i < this.dbCount; i++) {
        this._dbs.push(new Map());
        this._types.push(new Map());
    }
    this.expiry = new ExpiryManager();
    this.lru = new LRUEviction(5);
    this._dirty = 0;
    this._watchedKeys = new Map();
    this._keyVersions = new Map();
    this._restoring = false;
}

DataStore.prototype._checkExpired = function (db, key) {
    if (this.expiry.isExpired(db, key)) {
        this._dbs[db].delete(key);
        this._types[db].delete(key);
        this.expiry.removeExpiry(db, key);
        this.lru.remove(db, key);
        return true;
    }
    return false;
};

DataStore.prototype.get = function (db, key) {
    this._checkExpired(db, key);
    var val = this._dbs[db].get(key);
    if (val !== undefined) {
        this.lru.touch(db, key);
    }
    return val;
};

DataStore.prototype.set = function (db, key, value, type) {
    if (!this._restoring && this._config) {
        var rejected = this.enforceMemoryLimit();
        if (rejected) return false;
    }
    this._dbs[db].set(key, value);
    this._types[db].set(key, type || TYPE_STRING);
    this.lru.touch(db, key);
    if (!this._restoring) {
        this._dirty++;
        this._bumpKeyVersion(db, key);
    }
    return true;
};

DataStore.prototype.markDirty = function (db, key) {
    this._dirty++;
    this._bumpKeyVersion(db, key);
    this.lru.touch(db, key);
};

DataStore.prototype.deleteKey = function (db, key) {
    var existed = this._dbs[db].delete(key);
    this._types[db].delete(key);
    this.expiry.removeExpiry(db, key);
    this.lru.remove(db, key);
    if (existed) {
        this._dirty++;
        this._bumpKeyVersion(db, key);
    }
    return existed;
};

DataStore.prototype.exists = function (db, key) {
    this._checkExpired(db, key);
    return this._dbs[db].has(key);
};

DataStore.prototype.typeOf = function (db, key) {
    this._checkExpired(db, key);
    return this._types[db].get(key) || 'none';
};

DataStore.prototype.checkType = function (db, key, expected) {
    var actual = this.typeOf(db, key);
    if (actual === 'none') return true;
    return actual === expected;
};

DataStore.prototype.keysInDb = function (db) {
    var out = [];
    for (var key of this._dbs[db].keys()) {
        if (!this._checkExpired(db, key)) {
            out.push(key);
        }
    }
    return out;
};

DataStore.prototype.dbSize = function (db) {
    return this.keysInDb(db).length;
};

DataStore.prototype.flushDb = function (db) {
    this._dbs[db].clear();
    this._types[db].clear();
    this.expiry.clearDb(db);
    this.lru.clearDb(db);
    this._dirty++;
};

DataStore.prototype.flushAll = function () {
    for (var i = 0; i < this.dbCount; i++) {
        this._dbs[i].clear();
        this._types[i].clear();
    }
    this.expiry.clearAll();
    this.lru.clearAll();
    this._dirty++;
};

DataStore.prototype.swapDb = function (a, b) {
    if (a < 0 || a >= this.dbCount || b < 0 || b >= this.dbCount) {
        return false;
    }
    var tmpDb = this._dbs[a];
    var tmpType = this._types[a];
    this._dbs[a] = this._dbs[b];
    this._types[a] = this._types[b];
    this._dbs[b] = tmpDb;
    this._types[b] = tmpType;
    this.expiry.swapDb(a, b);
    this.lru.swapDb(a, b);
    return true;
};

DataStore.prototype.randomKey = function (db) {
    var keys = this.keysInDb(db);
    if (keys.length === 0) return null;
    return keys[Math.floor(Math.random() * keys.length)];
};

DataStore.prototype.rename = function (db, from, to) {
    this._checkExpired(db, from);
    if (!this._dbs[db].has(from)) return false;

    var value = this._dbs[db].get(from);
    var type = this._types[db].get(from);
    var expiryDeadline = this.expiry.getExpiry(db, from);

    this.deleteKey(db, from);
    this.set(db, to, value, type);

    if (expiryDeadline > 0) {
        this.expiry.setExpireAt(db, to, expiryDeadline);
    }

    return true;
};

DataStore.prototype.enforceMemoryLimit = function () {
    if (!this._config) return false;
    var maxmem = this._config.get('maxmemory');
    if (!maxmem || maxmem <= 0) return false;

    var used = process.memoryUsage().heapUsed;
    if (used <= maxmem) return false;

    var policy = this._config.get('maxmemory_policy') || 'noeviction';
    if (policy === 'noeviction') return true;

    var attempts = 0;
    while (used > maxmem && attempts < 128) {
        var freed = this.lru.evict(this, policy, used - maxmem);
        if (!freed) return true;
        used = process.memoryUsage().heapUsed;
        attempts++;
    }

    return used > maxmem;
};

Object.defineProperty(DataStore.prototype, 'dirty', {
    get: function () { return this._dirty; }
});

DataStore.prototype.resetDirty = function () {
    this._dirty = 0;
};

DataStore.prototype.watchKey = function (clientId, db, key) {
    var mapKey = db + ':' + key;
    if (!this._watchedKeys.has(clientId)) {
        this._watchedKeys.set(clientId, new Map());
    }
    var version = this._keyVersions.get(mapKey) || 0;
    this._watchedKeys.get(clientId).set(mapKey, version);
};

DataStore.prototype.unwatchAll = function (clientId) {
    this._watchedKeys.delete(clientId);
};

DataStore.prototype.isWatchDirty = function (clientId) {
    var watched = this._watchedKeys.get(clientId);
    if (!watched) return false;

    for (var entry of watched) {
        var mapKey = entry[0];
        var savedVersion = entry[1];
        var currentVersion = this._keyVersions.get(mapKey) || 0;
        if (currentVersion !== savedVersion) {
            return true;
        }
    }
    return false;
};

DataStore.prototype._bumpKeyVersion = function (db, key) {
    var mapKey = db + ':' + key;
    var current = this._keyVersions.get(mapKey) || 0;
    this._keyVersions.set(mapKey, current + 1);
};

DataStore.prototype.exportDbData = function (db) {
    var out = {};
    for (var entry of this._dbs[db]) {
        var key = entry[0];
        var value = entry[1];
        if (!this._checkExpired(db, key)) {
            out[key] = {
                value: value,
                type: this._types[db].get(key)
            };
        }
    }
    return out;
};

DataStore.prototype.importDbData = function (db, data) {
    for (var key in data) {
        this._dbs[db].set(key, data[key].value);
        this._types[db].set(key, data[key].type);
    }
};

module.exports = {
    DataStore: DataStore,
    TYPE_STRING: TYPE_STRING,
    TYPE_LIST: TYPE_LIST,
    TYPE_SET: TYPE_SET,
    TYPE_ZSET: TYPE_ZSET,
    TYPE_HASH: TYPE_HASH
};
