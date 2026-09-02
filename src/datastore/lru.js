'use strict';

class LRUEviction {
    constructor(maxSamples) {
        this._accessTime = new Map();
        this._maxSamples = maxSamples || 5;
    }

    touch(db, key) {
        this._accessTime.set(db + ':' + key, Date.now());
    }

    remove(db, key) {
        this._accessTime.delete(db + ':' + key);
    }

    evict(store, policy, bytesToFree) {
        if (policy === 'noeviction') {
            return false;
        }

        let evicted = 0;
        const targetEvictions = 10;

        for (let round = 0; round < targetEvictions; round++) {
            const candidate = this._pickCandidate(store, policy);
            if (!candidate) break;

            store.deleteKey(candidate.db, candidate.key);
            this.remove(candidate.db, candidate.key);
            evicted++;
        }

        return evicted > 0;
    }

    _pickCandidate(store, policy) {
        let best = null;
        let bestTime = Infinity;

        const dbCount = store.dbCount;
        const populatedDbs = [];

        for (let d = 0; d < dbCount; d++) {
            const k = store.keysInDb(d);
            if (k.length > 0) populatedDbs.push({ idx: d, keys: k });
        }

        if (populatedDbs.length === 0) return null;

        for (let sample = 0; sample < this._maxSamples; sample++) {
            const db = populatedDbs[Math.floor(Math.random() * populatedDbs.length)];
            const key = db.keys[Math.floor(Math.random() * db.keys.length)];
            const mapKey = db.idx + ':' + key;

            if (policy === 'volatile-lru') {
                if (!store.expiry.hasExpiry(db.idx, key)) continue;
            }

            const lastAccess = this._accessTime.get(mapKey) || 0;
            if (lastAccess < bestTime) {
                bestTime = lastAccess;
                best = { db: db.idx, key: key };
            }
        }

        return best;
    }

    clearDb(db) {
        const prefix = db + ':';
        for (const key of this._accessTime.keys()) {
            if (key.startsWith(prefix)) {
                this._accessTime.delete(key);
            }
        }
    }

    clearAll() {
        this._accessTime.clear();
    }
}

module.exports = { LRUEviction };
