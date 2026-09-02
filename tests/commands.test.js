'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { DataStore, TYPE_STRING, TYPE_LIST, TYPE_HASH, TYPE_SET, TYPE_ZSET } = require('../src/datastore/store');
const { dispatch } = require('../src/commands/registry');
const { PubSubBroker } = require('../src/commands/pubsub');
const { ServerConfig } = require('../src/config');

function makeCtx(store, db) {
    return {
        db: db || 0,
        store: store,
        config: new ServerConfig(),
        connection: { db: db || 0, id: 1, name: null, txQueue: null },
        pubsub: new PubSubBroker(),
        clientCount: 1
    };
}

function exec(store, cmd, db) {
    const parts = cmd.split(' ');
    const ctx = makeCtx(store, db);
    return dispatch(parts, ctx);
}

describe('String Commands', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('SET and GET round-trip', () => {
        const r1 = exec(store, 'SET foo bar');
        assert.ok(r1.includes('+OK'));

        const r2 = exec(store, 'GET foo');
        assert.ok(r2.includes('bar'));
    });

    it('GET returns null for missing key', () => {
        const r = exec(store, 'GET missing');
        assert.ok(r.includes('$-1'));
    });

    it('SET with NX flag skips existing key', () => {
        exec(store, 'SET foo bar');
        exec(store, 'SET foo baz NX');
        const r = exec(store, 'GET foo');
        assert.ok(r.includes('bar'));
    });

    it('SET with XX flag requires existing key', () => {
        exec(store, 'SET foo baz XX');
        const r = exec(store, 'GET foo');
        assert.ok(r.includes('$-1'));
    });

    it('INCR on missing key starts from 0', () => {
        const r = exec(store, 'INCR counter');
        assert.ok(r.includes(':1'));
    });

    it('INCR on existing integer', () => {
        exec(store, 'SET counter 10');
        const r = exec(store, 'INCR counter');
        assert.ok(r.includes(':11'));
    });

    it('DECR decrements', () => {
        exec(store, 'SET counter 5');
        const r = exec(store, 'DECR counter');
        assert.ok(r.includes(':4'));
    });

    it('INCRBY adds specified amount', () => {
        exec(store, 'SET counter 10');
        const r = exec(store, 'INCRBY counter 5');
        assert.ok(r.includes(':15'));
    });

    it('APPEND to existing string', () => {
        exec(store, 'SET foo hello');
        exec(store, 'APPEND foo world');
        const r = exec(store, 'GET foo');
        assert.ok(r.includes('helloworld'));
    });

    it('STRLEN returns length', () => {
        exec(store, 'SET foo hello');
        const r = exec(store, 'STRLEN foo');
        assert.ok(r.includes(':5'));
    });

    it('SETNX only sets if not exists', () => {
        const r1 = exec(store, 'SETNX foo bar');
        assert.ok(r1.includes(':1'));
        const r2 = exec(store, 'SETNX foo baz');
        assert.ok(r2.includes(':0'));
    });

    it('MSET sets multiple keys', () => {
        exec(store, 'MSET a 1 b 2 c 3');
        assert.ok(exec(store, 'GET a').includes('1'));
        assert.ok(exec(store, 'GET b').includes('2'));
        assert.ok(exec(store, 'GET c').includes('3'));
    });

    it('MGET returns multiple values', () => {
        exec(store, 'SET a 1');
        exec(store, 'SET b 2');
        const r = exec(store, 'MGET a b missing');
        assert.ok(r.includes('*3'));
        assert.ok(r.includes('1'));
        assert.ok(r.includes('2'));
        assert.ok(r.includes('$-1'));
    });

    it('GETDEL returns and deletes', () => {
        exec(store, 'SET foo bar');
        const r1 = exec(store, 'GETDEL foo');
        assert.ok(r1.includes('bar'));
        const r2 = exec(store, 'GET foo');
        assert.ok(r2.includes('$-1'));
    });
});

describe('Key Commands', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('DEL removes keys', () => {
        exec(store, 'SET foo bar');
        exec(store, 'SET baz qux');
        const r = exec(store, 'DEL foo baz missing');
        assert.ok(r.includes(':2'));
    });

    it('EXISTS counts existing keys', () => {
        exec(store, 'SET foo bar');
        const r = exec(store, 'EXISTS foo missing');
        assert.ok(r.includes(':1'));
    });

    it('TYPE returns correct type', () => {
        exec(store, 'SET foo bar');
        const r = exec(store, 'TYPE foo');
        assert.ok(r.includes('string'));
    });

    it('KEYS with glob pattern', () => {
        exec(store, 'SET hello world');
        exec(store, 'SET help me');
        exec(store, 'SET foo bar');
        const r = exec(store, 'KEYS hel*');
        assert.ok(r.includes('hello'));
        assert.ok(r.includes('help'));
        assert.ok(!r.includes('foo'));
    });

    it('RENAME works', () => {
        exec(store, 'SET old val');
        exec(store, 'RENAME old new');
        assert.ok(exec(store, 'GET new').includes('val'));
        assert.ok(exec(store, 'GET old').includes('$-1'));
    });

    it('PERSIST removes TTL', () => {
        exec(store, 'SET foo bar');
        exec(store, 'EXPIRE foo 100');
        exec(store, 'PERSIST foo');
        const r = exec(store, 'TTL foo');
        assert.ok(r.includes(':-1'));
    });
});

describe('List Commands', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('LPUSH and LRANGE', () => {
        exec(store, 'LPUSH mylist c b a');
        const r = exec(store, 'LRANGE mylist 0 -1');
        assert.ok(r.includes('a'));
        assert.ok(r.includes('b'));
        assert.ok(r.includes('c'));
    });

    it('RPUSH and LLEN', () => {
        exec(store, 'RPUSH mylist 1 2 3');
        const r = exec(store, 'LLEN mylist');
        assert.ok(r.includes(':3'));
    });

    it('LPOP and RPOP', () => {
        exec(store, 'RPUSH mylist a b c');
        const l = exec(store, 'LPOP mylist');
        assert.ok(l.includes('a'));
        const r = exec(store, 'RPOP mylist');
        assert.ok(r.includes('c'));
    });

    it('LINDEX returns element at index', () => {
        exec(store, 'RPUSH mylist a b c');
        const r = exec(store, 'LINDEX mylist 1');
        assert.ok(r.includes('b'));
    });

    it('LSET modifies element', () => {
        exec(store, 'RPUSH mylist a b c');
        exec(store, 'LSET mylist 1 z');
        const r = exec(store, 'LINDEX mylist 1');
        assert.ok(r.includes('z'));
    });

    it('auto-deletes empty list', () => {
        exec(store, 'RPUSH mylist a');
        exec(store, 'LPOP mylist');
        const r = exec(store, 'EXISTS mylist');
        assert.ok(r.includes(':0'));
    });
});

describe('Hash Commands', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('HSET and HGET', () => {
        exec(store, 'HSET myhash field1 val1');
        const r = exec(store, 'HGET myhash field1');
        assert.ok(r.includes('val1'));
    });

    it('HDEL removes fields', () => {
        exec(store, 'HSET myhash f1 v1 f2 v2');
        exec(store, 'HDEL myhash f1');
        assert.ok(exec(store, 'HEXISTS myhash f1').includes(':0'));
        assert.ok(exec(store, 'HEXISTS myhash f2').includes(':1'));
    });

    it('HLEN counts fields', () => {
        exec(store, 'HSET myhash a 1 b 2 c 3');
        const r = exec(store, 'HLEN myhash');
        assert.ok(r.includes(':3'));
    });

    it('HINCRBY increments field', () => {
        exec(store, 'HSET myhash counter 10');
        const r = exec(store, 'HINCRBY myhash counter 5');
        assert.ok(r.includes(':15'));
    });

    it('HGETALL returns all fields and values', () => {
        exec(store, 'HSET myhash name test age 25');
        const r = exec(store, 'HGETALL myhash');
        assert.ok(r.includes('name'));
        assert.ok(r.includes('test'));
        assert.ok(r.includes('age'));
        assert.ok(r.includes('25'));
    });
});

describe('Set Commands', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('SADD and SMEMBERS', () => {
        exec(store, 'SADD myset a b c');
        const r = exec(store, 'SMEMBERS myset');
        assert.ok(r.includes('a'));
        assert.ok(r.includes('b'));
        assert.ok(r.includes('c'));
    });

    it('SCARD counts members', () => {
        exec(store, 'SADD myset a b c');
        const r = exec(store, 'SCARD myset');
        assert.ok(r.includes(':3'));
    });

    it('SISMEMBER checks membership', () => {
        exec(store, 'SADD myset hello');
        assert.ok(exec(store, 'SISMEMBER myset hello').includes(':1'));
        assert.ok(exec(store, 'SISMEMBER myset world').includes(':0'));
    });

    it('SREM removes members', () => {
        exec(store, 'SADD myset a b c');
        exec(store, 'SREM myset b');
        assert.ok(exec(store, 'SCARD myset').includes(':2'));
    });

    it('SUNION unions sets', () => {
        exec(store, 'SADD s1 a b');
        exec(store, 'SADD s2 b c');
        const r = exec(store, 'SUNION s1 s2');
        assert.ok(r.includes('a'));
        assert.ok(r.includes('b'));
        assert.ok(r.includes('c'));
    });

    it('SINTER intersects sets', () => {
        exec(store, 'SADD s1 a b c');
        exec(store, 'SADD s2 b c d');
        const r = exec(store, 'SINTER s1 s2');
        assert.ok(r.includes('b'));
        assert.ok(r.includes('c'));
        assert.ok(!r.includes('a'));
        assert.ok(!r.includes('d'));
    });

    it('SDIFF computes difference', () => {
        exec(store, 'SADD s1 a b c');
        exec(store, 'SADD s2 b c d');
        const r = exec(store, 'SDIFF s1 s2');
        assert.ok(r.includes('a'));
        assert.ok(!r.includes('b'));
    });
});

describe('Sorted Set Commands', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('ZADD and ZSCORE', () => {
        exec(store, 'ZADD myzset 1 one 2 two 3 three');
        const r = exec(store, 'ZSCORE myzset two');
        assert.ok(r.includes('2'));
    });

    it('ZRANK returns position', () => {
        exec(store, 'ZADD myzset 1 a 2 b 3 c');
        assert.ok(exec(store, 'ZRANK myzset a').includes(':0'));
        assert.ok(exec(store, 'ZRANK myzset c').includes(':2'));
    });

    it('ZCARD counts members', () => {
        exec(store, 'ZADD myzset 1 a 2 b');
        assert.ok(exec(store, 'ZCARD myzset').includes(':2'));
    });

    it('ZRANGE returns range', () => {
        exec(store, 'ZADD myzset 1 a 2 b 3 c');
        const r = exec(store, 'ZRANGE myzset 0 -1');
        assert.ok(r.includes('a'));
        assert.ok(r.includes('b'));
        assert.ok(r.includes('c'));
    });

    it('ZINCRBY increments score', () => {
        exec(store, 'ZADD myzset 5 member');
        exec(store, 'ZINCRBY myzset 3 member');
        const r = exec(store, 'ZSCORE myzset member');
        assert.ok(r.includes('8'));
    });

    it('ZREM removes members', () => {
        exec(store, 'ZADD myzset 1 a 2 b 3 c');
        exec(store, 'ZREM myzset b');
        assert.ok(exec(store, 'ZCARD myzset').includes(':2'));
    });
});

describe('Server Commands', () => {
    let store;

    beforeEach(() => {
        store = new DataStore(16);
    });

    it('PING returns PONG', () => {
        const r = exec(store, 'PING');
        assert.ok(r.includes('PONG'));
    });

    it('PING with message echoes it', () => {
        const r = exec(store, 'PING hello');
        assert.ok(r.includes('hello'));
    });

    it('ECHO returns the message', () => {
        const r = exec(store, 'ECHO testmsg');
        assert.ok(r.includes('testmsg'));
    });

    it('DBSIZE returns count', () => {
        exec(store, 'SET a 1');
        exec(store, 'SET b 2');
        const r = exec(store, 'DBSIZE');
        assert.ok(r.includes(':2'));
    });

    it('FLUSHDB clears database', () => {
        exec(store, 'SET a 1');
        exec(store, 'SET b 2');
        exec(store, 'FLUSHDB');
        assert.ok(exec(store, 'DBSIZE').includes(':0'));
    });

    it('WRONGTYPE error on type mismatch', () => {
        exec(store, 'RPUSH mylist a b');
        const r = exec(store, 'INCR mylist');
        assert.ok(r.includes('WRONGTYPE'));
    });
});
