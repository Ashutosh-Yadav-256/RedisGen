'use strict';

const encoder = require('../protocol/encoder');
const { TYPE_HASH } = require('../datastore/store');

function getHash(store, db, key) {
    if (!store.checkType(db, key, TYPE_HASH)) return null;
    let map = store.get(db, key);
    if (map === undefined) {
        map = new Map();
        store.set(db, key, map, TYPE_HASH);
    }
    return map;
}

function cmdHset(args, ctx) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) return encoder.wrongArgCount('hset');

    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    let map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    let added = 0;
    for (let i = 1; i < args.length; i += 2) {
        if (!map.has(args[i])) added++;
        map.set(args[i], args[i + 1]);
    }

    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);
    return encoder.integerReply(added);
}

function cmdHget(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('hget');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    if (!map) return encoder.nullBulk();

    const val = map.get(args[1]);
    if (val === undefined) return encoder.nullBulk();
    return encoder.encodeBulkString(val);
}

function cmdHdel(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('hdel');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    if (!map) return encoder.integerReply(0);

    let removed = 0;
    for (let i = 1; i < args.length; i++) {
        if (map.delete(args[i])) removed++;
    }

    if (map.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdHgetall(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hgetall');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    if (!map || map.size === 0) return encoder.emptyArray();

    const result = [];
    for (const [field, value] of map) {
        result.push(field);
        result.push(value);
    }

    return encoder.encodeArray(result);
}

function cmdHmset(args, ctx) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) return encoder.wrongArgCount('hmset');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    let map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    for (let i = 1; i < args.length; i += 2) {
        map.set(args[i], args[i + 1]);
    }

    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);
    return encoder.ok();
}

function cmdHmget(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('hmget');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    const result = [];

    for (let i = 1; i < args.length; i++) {
        if (map) {
            const val = map.get(args[i]);
            result.push(val !== undefined ? val : null);
        } else {
            result.push(null);
        }
    }

    return encoder.encodeArray(result);
}

function cmdHexists(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('hexists');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    if (!map) return encoder.integerReply(0);
    return encoder.integerReply(map.has(args[1]) ? 1 : 0);
}

function cmdHlen(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hlen');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(map ? map.size : 0);
}

function cmdHkeys(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hkeys');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    if (!map || map.size === 0) return encoder.emptyArray();
    return encoder.encodeArray(Array.from(map.keys()));
}

function cmdHvals(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hvals');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const map = ctx.store.get(ctx.db, args[0]);
    if (!map || map.size === 0) return encoder.emptyArray();
    return encoder.encodeArray(Array.from(map.values()));
}

function cmdHincrby(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('hincrby');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const increment = parseInt(args[2], 10);
    if (isNaN(increment)) return encoder.encodeError('ERR value is not an integer or out of range');

    let map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    let current = map.get(args[1]);
    if (current === undefined) {
        current = 0;
    } else {
        current = parseInt(current, 10);
        if (isNaN(current)) return encoder.encodeError('ERR hash value is not an integer');
    }

    const result = current + increment;
    map.set(args[1], String(result));
    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);

    return encoder.integerReply(result);
}

function cmdHincrbyfloat(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('hincrbyfloat');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    const increment = parseFloat(args[2]);
    if (isNaN(increment)) return encoder.encodeError('ERR value is not a valid float');

    let map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    let current = map.get(args[1]);
    if (current === undefined) {
        current = 0;
    } else {
        current = parseFloat(current);
        if (isNaN(current)) return encoder.encodeError('ERR hash value is not a float');
    }

    const result = current + increment;
    const strResult = String(result);
    map.set(args[1], strResult);
    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);

    return encoder.encodeBulkString(strResult);
}

function cmdHsetnx(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('hsetnx');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    let map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    if (map.has(args[1])) return encoder.integerReply(0);

    map.set(args[1], args[2]);
    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);
    return encoder.integerReply(1);
}

module.exports = {
    hset: cmdHset,
    hget: cmdHget,
    hdel: cmdHdel,
    hgetall: cmdHgetall,
    hmset: cmdHmset,
    hmget: cmdHmget,
    hexists: cmdHexists,
    hlen: cmdHlen,
    hkeys: cmdHkeys,
    hvals: cmdHvals,
    hincrby: cmdHincrby,
    hincrbyfloat: cmdHincrbyfloat,
    hsetnx: cmdHsetnx
};
