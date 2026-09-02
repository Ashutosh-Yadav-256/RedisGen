'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DataStore, TYPE_STRING, TYPE_LIST, TYPE_HASH, TYPE_SET } = require('../src/datastore/store');
const { RdbPersistence } = require('../src/persistence/rdb');
const { AofPersistence } = require('../src/persistence/aof');
const { ServerConfig } = require('../src/config');
const { dispatch } = require('../src/commands/registry');
const { PubSubBroker } = require('../src/commands/pubsub');

const TEST_DIR = path.join(__dirname, '.tmp_persist_test');

describe('RDB Persistence', () => {
    let store, config, rdb;

    beforeEach(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
        config = new ServerConfig({ dir: TEST_DIR, rdb_filename: 'test.rdb' });
        store = new DataStore(16);
        rdb = new RdbPersistence(config, store);
    });

    afterEach(() => {
        try {
            const files = fs.readdirSync(TEST_DIR);
            for (const f of files) fs.unlinkSync(path.join(TEST_DIR, f));
            fs.rmdirSync(TEST_DIR);
        } catch (e) {}
    });

    it('save and load round-trip for strings', () => {
        store.set(0, 'key1', 'val1', TYPE_STRING);
        store.set(0, 'key2', 'val2', TYPE_STRING);
        store.set(1, 'key3', 'val3', TYPE_STRING);

        assert.ok(rdb.save());

        const store2 = new DataStore(16);
        const rdb2 = new RdbPersistence(config, store2);
        assert.ok(rdb2.load());

        assert.strictEqual(store2.get(0, 'key1'), 'val1');
        assert.strictEqual(store2.get(0, 'key2'), 'val2');
        assert.strictEqual(store2.get(1, 'key3'), 'val3');
    });

    it('save and load round-trip for lists', () => {
        store.set(0, 'mylist', ['a', 'b', 'c'], 'list');
        assert.ok(rdb.save());

        const store2 = new DataStore(16);
        const rdb2 = new RdbPersistence(config, store2);
        rdb2.load();

        const list = store2.get(0, 'mylist');
        assert.deepStrictEqual(list, ['a', 'b', 'c']);
    });

    it('save and load round-trip for hashes', () => {
        store.set(0, 'myhash', new Map([['f1', 'v1'], ['f2', 'v2']]), 'hash');
        assert.ok(rdb.save());

        const store2 = new DataStore(16);
        const rdb2 = new RdbPersistence(config, store2);
        rdb2.load();

        const hash = store2.get(0, 'myhash');
        assert.ok(hash instanceof Map);
        assert.strictEqual(hash.get('f1'), 'v1');
    });

    it('save and load round-trip for sets', () => {
        store.set(0, 'myset', new Set(['x', 'y', 'z']), 'set');
        assert.ok(rdb.save());

        const store2 = new DataStore(16);
        const rdb2 = new RdbPersistence(config, store2);
        rdb2.load();

        const set = store2.get(0, 'myset');
        assert.ok(set instanceof Set);
        assert.ok(set.has('x'));
        assert.ok(set.has('y'));
    });

    it('preserves expiry across save/load', () => {
        store.set(0, 'expiring', 'val', TYPE_STRING);
        store.expiry.setExpiry(0, 'expiring', 60000);
        rdb.save();

        const store2 = new DataStore(16);
        const rdb2 = new RdbPersistence(config, store2);
        rdb2.load();

        assert.ok(store2.expiry.hasExpiry(0, 'expiring'));
        assert.ok(store2.expiry.ttlMs(0, 'expiring') > 0);
    });

    it('load returns false when no file exists', () => {
        const emptyConfig = new ServerConfig({ dir: TEST_DIR, rdb_filename: 'nonexistent.rdb' });
        const rdb2 = new RdbPersistence(emptyConfig, store);
        assert.strictEqual(rdb2.load(), false);
    });
});

describe('AOF Persistence', () => {
    let store, config, aof;

    beforeEach(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
        config = new ServerConfig({ dir: TEST_DIR, aof_filename: 'test.aof', appendonly: true, appendfsync: 'always' });
        store = new DataStore(16);
        aof = new AofPersistence(config, store);
    });

    afterEach(() => {
        aof.close();
        try {
            const files = fs.readdirSync(TEST_DIR);
            for (const f of files) fs.unlinkSync(path.join(TEST_DIR, f));
            fs.rmdirSync(TEST_DIR);
        } catch (e) {}
    });

    it('appends and replays commands', () => {
        aof.open();
        aof.appendCommand(['SET', 'k1', 'v1']);
        aof.appendCommand(['SET', 'k2', 'v2']);
        aof.appendCommand(['DEL', 'k1']);
        aof.close();

        const store2 = new DataStore(16);
        const aof2 = new AofPersistence(config, store2);

        const ctx = {
            db: 0,
            store: store2,
            config: config,
            connection: { db: 0, id: 0, name: null, txQueue: null },
            pubsub: new PubSubBroker(),
            clientCount: 0
        };

        const count = aof2.replay(dispatch, ctx);
        assert.strictEqual(count, 3);
        assert.strictEqual(store2.get(0, 'k2'), 'v2');
        assert.strictEqual(store2.exists(0, 'k1'), false);
    });

    it('replay with no file returns 0', () => {
        const emptyConfig = new ServerConfig({ dir: TEST_DIR, aof_filename: 'nonexistent.aof', appendonly: true });
        const aof2 = new AofPersistence(emptyConfig, store);
        const count = aof2.replay(dispatch, {});
        assert.strictEqual(count, 0);
    });
});
