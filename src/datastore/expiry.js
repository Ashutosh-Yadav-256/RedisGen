'use strict';

class ExpiryManager {
    constructor() {
        this._timers = new Map();
        this._sweepInterval = null;
    }

    setExpiry(db, key, ms) {
        const mapKey = db + ':' + key;
        const deadline = Date.now() + ms;
        this._timers.set(mapKey, deadline);
    }

    setExpireAt(db, key, timestampMs) {
        const mapKey = db + ':' + key;
        this._timers.set(mapKey, timestampMs);
    }

    getExpiry(db, key) {
        const mapKey = db + ':' + key;
        return this._timers.get(mapKey) || -1;
    }

    removeExpiry(db, key) {
        const mapKey = db + ':' + key;
        this._timers.delete(mapKey);
    }

    isExpired(db, key) {
        const mapKey = db + ':' + key;
        const deadline = this._timers.get(mapKey);
        if (deadline === undefined) return false;
        return Date.now() >= deadline;
    }

    ttlMs(db, key) {
        const mapKey = db + ':' + key;
        const deadline = this._timers.get(mapKey);
        if (deadline === undefined) return -1;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return -2;
        return remaining;
    }

    ttlSec(db, key) {
        const ms = this.ttlMs(db, key);
        if (ms < 0) return ms;
        return Math.ceil(ms / 1000);
    }

    hasExpiry(db, key) {
        return this._timers.has(db + ':' + key);
    }

    startActiveSweep(store, hz) {
        if (this._sweepInterval) return;

        const intervalMs = Math.max(50, Math.floor(1000 / (hz || 10)));

        this._sweepInterval = setInterval(() => {
            this._sweep(store);
        }, intervalMs);

        if (this._sweepInterval.unref) {
            this._sweepInterval.unref();
        }
    }

    stopActiveSweep() {
        if (this._sweepInterval) {
            clearInterval(this._sweepInterval);
            this._sweepInterval = null;
        }
    }

    _sweep(store) {
        const now = Date.now();
        const entries = Array.from(this._timers.entries());
        const sampleSize = Math.min(20, entries.length);

        if (sampleSize === 0) return;

        let expired = 0;

        for (let i = 0; i < sampleSize; i++) {
            const idx = Math.floor(Math.random() * entries.length);
            const [mapKey, deadline] = entries[idx];

            if (now >= deadline) {
                const sepIdx = mapKey.indexOf(':');
                const dbIndex = parseInt(mapKey.substring(0, sepIdx), 10);
                const key = mapKey.substring(sepIdx + 1);
                store.deleteKey(dbIndex, key);
                this._timers.delete(mapKey);
                expired++;
            }
        }

        if (expired > sampleSize / 4) {
            this._sweep(store);
        }
    }

    clearDb(db) {
        const prefix = db + ':';
        for (const key of this._timers.keys()) {
            if (key.startsWith(prefix)) {
                this._timers.delete(key);
            }
        }
    }

    clearAll() {
        this._timers.clear();
    }

    get size() {
        return this._timers.size;
    }

    exportAll() {
        const out = {};
        for (const [mapKey, deadline] of this._timers) {
            out[mapKey] = deadline;
        }
        return out;
    }

    importAll(data) {
        for (const mapKey in data) {
            this._timers.set(mapKey, data[mapKey]);
        }
    }
}

module.exports = { ExpiryManager };
