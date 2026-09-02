'use strict';

const { ExpiryManager } = require('./expiry');
const { LRUEviction } = require('./lru');

const TYPE_STRING = 'string';
const TYPE_LIST = 'list';
const TYPE_SET = 'set';
const TYPE_ZSET = 'zset';
const TYPE_HASH = 'hash';

class DataStore {
    constructor(dbCount) {
        this.dbCount = dbCount || 16;
        this._dbs = [];
        this._types = [];
        for (let i = 0; i < this.dbCount; i++) {
            this._dbs.push(new Map());
            this._types.push(new Map());
        }
        this.expiry = new ExpiryManager();
        this.lru = new LRUEviction(5);
        this._dirty = 0;
        this._watchedKeys = new Map();
        this._keyVersions = new Map();
    }

    _checkExpired(db, key) {
        if (this.expiry.isExpired(db, key)) {
            this._dbs[db].delete(key);
            this._types[db].delete(key);
            this.expiry.removeExpiry(db, key);
            this.lru.remove(db, key);
            return true;
        }
        return false;
    }

    get(db, key) {
        this._checkExpired(db, key);
        const val = this._dbs[db].get(key);
        if (val !== undefined) {
            this.lru.touch(db, key);
        }
        return val;
    }

    set(db, key, value, type) {
        this._dbs[db].set(key, value);
        this._types[db].set(key, type || TYPE_STRING);
        this.lru.touch(db, key);
        this._dirty++;
        this._bumpKeyVersion(db, key);
    }

    deleteKey(db, key) {
        const existed = this._dbs[db].delete(key);
        this._types[db].delete(key);
        this.expiry.removeExpiry(db, key);
        this.lru.remove(db, key);
        if (existed) {
            this._dirty++;
            this._bumpKeyVersion(db, key);
        }
        return existed;
    }

    exists(db, key) {
        this._checkExpired(db, key);
        return this._dbs[db].has(key);
    }

    typeOf(db, key) {
        this._checkExpired(db, key);
        return this._types[db].get(key) || 'none';
    }

    checkType(db, key, expected) {
        const actual = this.typeOf(db, key);
        if (actual === 'none') return true;
        return actual === expected;
    }

    keysInDb(db) {
        const out = [];
        for (const key of this._dbs[db].keys()) {
            if (!this._checkExpired(db, key)) {
                out.push(key);
            }
        }
        return out;
    }

    dbSize(db) {
        return this.keysInDb(db).length;
    }

    flushDb(db) {
        this._dbs[db].clear();
        this._types[db].clear();
        this.expiry.clearDb(db);
        this.lru.clearDb(db);
        this._dirty++;
    }

    flushAll() {
        for (let i = 0; i < this.dbCount; i++) {
            this._dbs[i].clear();
            this._types[i].clear();
        }
        this.expiry.clearAll();
        this.lru.clearAll();
        this._dirty++;
    }

    swapDb(a, b) {
        if (a < 0 || a >= this.dbCount || b < 0 || b >= this.dbCount) {
            return false;
        }
        const tmpDb = this._dbs[a];
        const tmpType = this._types[a];
        this._dbs[a] = this._dbs[b];
        this._types[a] = this._types[b];
        this._dbs[b] = tmpDb;
        this._types[b] = tmpType;
        return true;
    }

    randomKey(db) {
        const keys = this.keysInDb(db);
        if (keys.length === 0) return null;
        return keys[Math.floor(Math.random() * keys.length)];
    }

    rename(db, from, to) {
        this._checkExpired(db, from);
        if (!this._dbs[db].has(from)) return false;

        const value = this._dbs[db].get(from);
        const type = this._types[db].get(from);
        const expiryDeadline = this.expiry.getExpiry(db, from);

        this.deleteKey(db, from);
        this.set(db, to, value, type);

        if (expiryDeadline > 0) {
            this.expiry.setExpireAt(db, to, expiryDeadline);
        }

        return true;
    }

    get dirty() {
        return this._dirty;
    }

    resetDirty() {
        this._dirty = 0;
    }

    watchKey(clientId, db, key) {
        const mapKey = db + ':' + key;
        if (!this._watchedKeys.has(clientId)) {
            this._watchedKeys.set(clientId, new Map());
        }
        const version = this._keyVersions.get(mapKey) || 0;
        this._watchedKeys.get(clientId).set(mapKey, version);
    }

    unwatchAll(clientId) {
        this._watchedKeys.delete(clientId);
    }

    isWatchDirty(clientId) {
        const watched = this._watchedKeys.get(clientId);
        if (!watched) return false;

        for (const [mapKey, savedVersion] of watched) {
            const currentVersion = this._keyVersions.get(mapKey) || 0;
            if (currentVersion !== savedVersion) {
                return true;
            }
        }
        return false;
    }

    _bumpKeyVersion(db, key) {
        const mapKey = db + ':' + key;
        const current = this._keyVersions.get(mapKey) || 0;
        this._keyVersions.set(mapKey, current + 1);
    }

    exportDbData(db) {
        const out = {};
        for (const [key, value] of this._dbs[db]) {
            if (!this._checkExpired(db, key)) {
                out[key] = {
                    value: value,
                    type: this._types[db].get(key)
                };
            }
        }
        return out;
    }

    importDbData(db, data) {
        for (const key in data) {
            this._dbs[db].set(key, data[key].value);
            this._types[db].set(key, data[key].type);
        }
    }
}

module.exports = {
    DataStore,
    TYPE_STRING,
    TYPE_LIST,
    TYPE_SET,
    TYPE_ZSET,
    TYPE_HASH
};
