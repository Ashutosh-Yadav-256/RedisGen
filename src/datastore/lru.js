'use strict';

function LRUEviction(maxSamples) {
    this._accessTime = new Map();
    this._maxSamples = maxSamples || 5;
}

LRUEviction.prototype.touch = function (db, key) {
    this._accessTime.set(db + ':' + key, Date.now());
};

LRUEviction.prototype.remove = function (db, key) {
    this._accessTime.delete(db + ':' + key);
};

LRUEviction.prototype.evict = function (store, policy, bytesToFree) {
    if (policy === 'noeviction') {
        return false;
    }

    var evicted = 0;
    var targetEvictions = 10;

    for (var round = 0; round < targetEvictions; round++) {
        var candidate = this._pickCandidate(store, policy);
        if (!candidate) break;

        store.deleteKey(candidate.db, candidate.key);
        this.remove(candidate.db, candidate.key);
        evicted++;
    }

    return evicted > 0;
};

LRUEviction.prototype._pickCandidate = function (store, policy) {
    var best = null;
    var bestTime = Infinity;

    var dbCount = store.dbCount;
    var populatedDbs = [];

    for (var d = 0; d < dbCount; d++) {
        var k = store.keysInDb(d);
        if (k.length > 0) populatedDbs.push({ idx: d, keys: k });
    }

    if (populatedDbs.length === 0) return null;

    for (var sample = 0; sample < this._maxSamples; sample++) {
        var db = populatedDbs[Math.floor(Math.random() * populatedDbs.length)];
        var key = db.keys[Math.floor(Math.random() * db.keys.length)];
        var mapKey = db.idx + ':' + key;

        if (policy === 'volatile-lru') {
            if (!store.expiry.hasExpiry(db.idx, key)) continue;
        }

        var lastAccess = this._accessTime.get(mapKey) || 0;
        if (lastAccess < bestTime) {
            bestTime = lastAccess;
            best = { db: db.idx, key: key };
        }
    }

    return best;
};

LRUEviction.prototype.swapDb = function (a, b) {
    var aPrefix = a + ':';
    var bPrefix = b + ':';
    var aEntries = [];
    var bEntries = [];

    for (var entry of this._accessTime) {
        var mapKey = entry[0];
        var ts = entry[1];
        if (mapKey.startsWith(aPrefix)) {
            aEntries.push({ suffix: mapKey.substring(aPrefix.length), ts: ts });
            this._accessTime.delete(mapKey);
        } else if (mapKey.startsWith(bPrefix)) {
            bEntries.push({ suffix: mapKey.substring(bPrefix.length), ts: ts });
            this._accessTime.delete(mapKey);
        }
    }

    for (var i = 0; i < aEntries.length; i++) {
        this._accessTime.set(bPrefix + aEntries[i].suffix, aEntries[i].ts);
    }
    for (var j = 0; j < bEntries.length; j++) {
        this._accessTime.set(aPrefix + bEntries[j].suffix, bEntries[j].ts);
    }
};

LRUEviction.prototype.clearDb = function (db) {
    var prefix = db + ':';
    for (var key of this._accessTime.keys()) {
        if (key.startsWith(prefix)) {
            this._accessTime.delete(key);
        }
    }
};

LRUEviction.prototype.clearAll = function () {
    this._accessTime.clear();
};

module.exports = { LRUEviction: LRUEviction };
