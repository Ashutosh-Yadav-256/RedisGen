'use strict';

function ExpiryManager() {
    this._timers = new Map();
    this._sweepInterval = null;
}

ExpiryManager.prototype.setExpiry = function (db, key, ms) {
    var mapKey = db + ':' + key;
    var deadline = Date.now() + ms;
    this._timers.set(mapKey, deadline);
};

ExpiryManager.prototype.setExpireAt = function (db, key, timestampMs) {
    var mapKey = db + ':' + key;
    this._timers.set(mapKey, timestampMs);
};

ExpiryManager.prototype.getExpiry = function (db, key) {
    var mapKey = db + ':' + key;
    return this._timers.get(mapKey) || -1;
};

ExpiryManager.prototype.removeExpiry = function (db, key) {
    var mapKey = db + ':' + key;
    this._timers.delete(mapKey);
};

ExpiryManager.prototype.isExpired = function (db, key) {
    var mapKey = db + ':' + key;
    var deadline = this._timers.get(mapKey);
    if (deadline === undefined) return false;
    return Date.now() >= deadline;
};

ExpiryManager.prototype.ttlMs = function (db, key) {
    var mapKey = db + ':' + key;
    var deadline = this._timers.get(mapKey);
    if (deadline === undefined) return -1;
    var remaining = deadline - Date.now();
    if (remaining <= 0) return -2;
    return remaining;
};

ExpiryManager.prototype.ttlSec = function (db, key) {
    var ms = this.ttlMs(db, key);
    if (ms < 0) return ms;
    return Math.ceil(ms / 1000);
};

ExpiryManager.prototype.hasExpiry = function (db, key) {
    return this._timers.has(db + ':' + key);
};

ExpiryManager.prototype.startActiveSweep = function (store, hz) {
    if (this._sweepInterval) return;

    var self = this;
    var intervalMs = Math.max(50, Math.floor(1000 / (hz || 10)));

    this._sweepInterval = setInterval(function () {
        self._sweep(store);
    }, intervalMs);

    if (this._sweepInterval.unref) {
        this._sweepInterval.unref();
    }
};

ExpiryManager.prototype.stopActiveSweep = function () {
    if (this._sweepInterval) {
        clearInterval(this._sweepInterval);
        this._sweepInterval = null;
    }
};

ExpiryManager.prototype._sweep = function (store) {
    var maxRounds = 16;
    var round = 0;

    do {
        var now = Date.now();
        var entries = Array.from(this._timers.entries());
        var sampleSize = Math.min(20, entries.length);

        if (sampleSize === 0) return;

        var expired = 0;

        for (var i = 0; i < sampleSize; i++) {
            var idx = Math.floor(Math.random() * entries.length);
            var mapKey = entries[idx][0];
            var deadline = entries[idx][1];

            if (now >= deadline) {
                var sepIdx = mapKey.indexOf(':');
                var dbIndex = parseInt(mapKey.substring(0, sepIdx), 10);
                var key = mapKey.substring(sepIdx + 1);
                store.deleteKey(dbIndex, key);
                this._timers.delete(mapKey);
                expired++;
            }
        }

        round++;
    } while (expired > sampleSize / 4 && round < maxRounds);
};

ExpiryManager.prototype.swapDb = function (a, b) {
    var aPrefix = a + ':';
    var bPrefix = b + ':';
    var aEntries = [];
    var bEntries = [];

    for (var entry of this._timers) {
        var mapKey = entry[0];
        var deadline = entry[1];
        if (mapKey.startsWith(aPrefix)) {
            aEntries.push({ suffix: mapKey.substring(aPrefix.length), deadline: deadline });
            this._timers.delete(mapKey);
        } else if (mapKey.startsWith(bPrefix)) {
            bEntries.push({ suffix: mapKey.substring(bPrefix.length), deadline: deadline });
            this._timers.delete(mapKey);
        }
    }

    for (var i = 0; i < aEntries.length; i++) {
        this._timers.set(bPrefix + aEntries[i].suffix, aEntries[i].deadline);
    }
    for (var j = 0; j < bEntries.length; j++) {
        this._timers.set(aPrefix + bEntries[j].suffix, bEntries[j].deadline);
    }
};

ExpiryManager.prototype.clearDb = function (db) {
    var prefix = db + ':';
    for (var key of this._timers.keys()) {
        if (key.startsWith(prefix)) {
            this._timers.delete(key);
        }
    }
};

ExpiryManager.prototype.clearAll = function () {
    this._timers.clear();
};

Object.defineProperty(ExpiryManager.prototype, 'size', {
    get: function () { return this._timers.size; }
});

ExpiryManager.prototype.exportAll = function () {
    var out = {};
    for (var entry of this._timers) {
        out[entry[0]] = entry[1];
    }
    return out;
};

ExpiryManager.prototype.importAll = function (data) {
    for (var mapKey in data) {
        this._timers.set(mapKey, data[mapKey]);
    }
};

module.exports = { ExpiryManager: ExpiryManager };
