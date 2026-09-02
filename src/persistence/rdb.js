'use strict';

const fs = require('fs');
const path = require('path');
const { getLogger } = require('../utils/logger');

class RdbPersistence {
    constructor(config, store) {
        this._config = config;
        this._store = store;
        this._saveTimer = null;
        this._lastSaveTime = Date.now();
        this._lastSaveDirty = 0;
        this._log = getLogger();
    }

    getFilePath() {
        const dir = this._config.get('dir');
        const filename = this._config.get('rdb_filename');
        return path.resolve(dir, filename);
    }

    save() {
        const filePath = this.getFilePath();
        const snapshot = this._buildSnapshot();

        try {
            const tmpPath = filePath + '.tmp';
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
    }

    load() {
        const filePath = this.getFilePath();

        if (!fs.existsSync(filePath)) {
            this._log.info('RDB: no snapshot found at ' + filePath);
            return false;
        }

        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const snapshot = JSON.parse(raw);
            this._restoreSnapshot(snapshot);
            this._log.info('RDB: loaded snapshot from ' + filePath);
            return true;
        } catch (err) {
            this._log.error('RDB: load failed - ' + err.message);
            return false;
        }
    }

    startAutoSave() {
        const saveRules = this._config.get('save');
        if (!saveRules || saveRules.length === 0) return;

        this._saveTimer = setInterval(() => {
            this._checkAutoSave(saveRules);
        }, 1000);

        if (this._saveTimer.unref) {
            this._saveTimer.unref();
        }
    }

    stopAutoSave() {
        if (this._saveTimer) {
            clearInterval(this._saveTimer);
            this._saveTimer = null;
        }
    }

    _checkAutoSave(rules) {
        const now = Date.now();
        const elapsed = (now - this._lastSaveTime) / 1000;
        const changes = this._store.dirty - this._lastSaveDirty;

        for (const [seconds, minChanges] of rules) {
            if (elapsed >= seconds && changes >= minChanges) {
                this._log.info('RDB: auto-save triggered (' + changes + ' changes in ' + Math.floor(elapsed) + 's)');
                this.save();
                return;
            }
        }
    }

    _buildSnapshot() {
        const databases = {};

        for (let i = 0; i < this._store.dbCount; i++) {
            const data = this._store.exportDbData(i);
            if (Object.keys(data).length > 0) {
                databases[i] = {};
                for (const key in data) {
                    const entry = data[key];
                    databases[i][key] = {
                        type: entry.type,
                        value: this._serializeValue(entry.value, entry.type)
                    };
                }
            }
        }

        const expiries = this._store.expiry.exportAll();

        return {
            magic: 'REDISGEN',
            version: 1,
            timestamp: Date.now(),
            databases: databases,
            expiries: expiries
        };
    }

    _restoreSnapshot(snapshot) {
        if (snapshot.magic !== 'REDISGEN') {
            throw new Error('invalid snapshot format');
        }

        this._store.flushAll();

        for (const dbIdx in snapshot.databases) {
            const db = parseInt(dbIdx, 10);
            const entries = snapshot.databases[dbIdx];

            for (const key in entries) {
                const entry = entries[key];
                const value = this._deserializeValue(entry.value, entry.type);
                this._store.set(db, key, value, entry.type);
            }
        }

        if (snapshot.expiries) {
            const now = Date.now();
            for (const mapKey in snapshot.expiries) {
                const deadline = snapshot.expiries[mapKey];
                if (deadline > now) {
                    this._store.expiry.importAll({ [mapKey]: deadline });
                }
            }
        }
    }

    _serializeValue(value, type) {
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
    }

    _deserializeValue(value, type) {
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
    }
}

module.exports = { RdbPersistence };
