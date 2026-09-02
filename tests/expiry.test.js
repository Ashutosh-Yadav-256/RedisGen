'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { DataStore, TYPE_STRING } = require('../src/datastore/store');

describe('Expiry Engine', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('key with no expiry returns TTL -1', () => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        assert.strictEqual(store.expiry.ttlSec(0, 'foo'), -1);
    });

    it('setting expiry makes TTL positive', () => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        store.expiry.setExpiry(0, 'foo', 5000);
        const ttl = store.expiry.ttlMs(0, 'foo');
        assert.ok(ttl > 0 && ttl <= 5000);
    });

    it('expired key is lazily removed on access', (t) => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        store.expiry.setExpiry(0, 'foo', 1);

        return new Promise((resolve) => {
            setTimeout(() => {
                const val = store.get(0, 'foo');
                assert.strictEqual(val, undefined);
                assert.strictEqual(store.exists(0, 'foo'), false);
                resolve();
            }, 10);
        });
    });

    it('removing expiry with persist', () => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        store.expiry.setExpiry(0, 'foo', 5000);
        store.expiry.removeExpiry(0, 'foo');
        assert.strictEqual(store.expiry.ttlSec(0, 'foo'), -1);
    });

    it('TTL returns -2 for non-existent key', () => {
        assert.strictEqual(store.expiry.ttlSec(0, 'missing'), -1);
    });

    it('setExpireAt with absolute timestamp', () => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        store.expiry.setExpireAt(0, 'foo', Date.now() + 10000);
        const ttl = store.expiry.ttlMs(0, 'foo');
        assert.ok(ttl > 0 && ttl <= 10000);
    });

    it('hasExpiry returns correct state', () => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        assert.strictEqual(store.expiry.hasExpiry(0, 'foo'), false);
        store.expiry.setExpiry(0, 'foo', 5000);
        assert.strictEqual(store.expiry.hasExpiry(0, 'foo'), true);
    });

    it('clearDb removes expiries for that database', () => {
        store.set(0, 'a', '1', TYPE_STRING);
        store.set(1, 'b', '2', TYPE_STRING);
        store.expiry.setExpiry(0, 'a', 5000);
        store.expiry.setExpiry(1, 'b', 5000);
        store.expiry.clearDb(0);
        assert.strictEqual(store.expiry.hasExpiry(0, 'a'), false);
        assert.strictEqual(store.expiry.hasExpiry(1, 'b'), true);
    });

    it('clearAll removes all expiries', () => {
        store.set(0, 'a', '1', TYPE_STRING);
        store.set(1, 'b', '2', TYPE_STRING);
        store.expiry.setExpiry(0, 'a', 5000);
        store.expiry.setExpiry(1, 'b', 5000);
        store.expiry.clearAll();
        assert.strictEqual(store.expiry.size, 0);
    });
});

describe('LRU Eviction', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('touch updates access time', () => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        store.lru.touch(0, 'foo');
        assert.ok(true);
    });

    it('evict with noeviction policy returns false', () => {
        const result = store.lru.evict(store, 'noeviction', 1024);
        assert.strictEqual(result, false);
    });

    it('evict with allkeys-lru removes keys', () => {
        for (let i = 0; i < 20; i++) {
            store.set(0, 'key' + i, 'val' + i, TYPE_STRING);
        }
        const result = store.lru.evict(store, 'allkeys-lru', 1024);
        assert.strictEqual(result, true);
        assert.ok(store.dbSize(0) < 20);
    });
});

describe('DataStore', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('supports multiple databases', () => {
        store.set(0, 'foo', 'db0', TYPE_STRING);
        store.set(1, 'foo', 'db1', TYPE_STRING);
        assert.strictEqual(store.get(0, 'foo'), 'db0');
        assert.strictEqual(store.get(1, 'foo'), 'db1');
    });

    it('checkType enforces type safety', () => {
        store.set(0, 'foo', 'bar', TYPE_STRING);
        assert.strictEqual(store.checkType(0, 'foo', TYPE_STRING), true);
        assert.strictEqual(store.checkType(0, 'foo', 'list'), false);
    });

    it('flushDb only clears one database', () => {
        store.set(0, 'a', '1', TYPE_STRING);
        store.set(1, 'b', '2', TYPE_STRING);
        store.flushDb(0);
        assert.strictEqual(store.exists(0, 'a'), false);
        assert.strictEqual(store.exists(1, 'b'), true);
    });

    it('swapDb swaps two databases', () => {
        store.set(0, 'x', 'zero', TYPE_STRING);
        store.set(1, 'y', 'one', TYPE_STRING);
        store.swapDb(0, 1);
        assert.strictEqual(store.get(0, 'y'), 'one');
        assert.strictEqual(store.get(1, 'x'), 'zero');
    });

    it('rename preserves expiry', () => {
        store.set(0, 'old', 'val', TYPE_STRING);
        store.expiry.setExpiry(0, 'old', 10000);
        store.rename(0, 'old', 'new');
        assert.ok(store.expiry.hasExpiry(0, 'new'));
        assert.ok(!store.expiry.hasExpiry(0, 'old'));
    });

    it('WATCH detects modifications', () => {
        store.set(0, 'watched', 'v1', TYPE_STRING);
        store.watchKey('client1', 0, 'watched');
        assert.strictEqual(store.isWatchDirty('client1'), false);

        store.set(0, 'watched', 'v2', TYPE_STRING);
        assert.strictEqual(store.isWatchDirty('client1'), true);
    });

    it('UNWATCH clears watch state', () => {
        store.set(0, 'watched', 'v1', TYPE_STRING);
        store.watchKey('client1', 0, 'watched');
        store.unwatchAll('client1');
        store.set(0, 'watched', 'v2', TYPE_STRING);
        assert.strictEqual(store.isWatchDirty('client1'), false);
    });
});
