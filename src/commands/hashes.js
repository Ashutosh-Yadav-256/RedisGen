'use strict';

var encoder = require('../protocol/encoder');
var TYPE_HASH = require('../datastore/store').TYPE_HASH;
var validate = require('../utils/validate');

function cmdHset(args, ctx) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) return encoder.wrongArgCount('hset');

    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    var added = 0;
    for (var i = 1; i < args.length; i += 2) {
        if (!map.has(args[i])) added++;
        map.set(args[i], args[i + 1]);
    }

    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);
    return encoder.integerReply(added);
}

function cmdHget(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('hget');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    if (!map) return encoder.nullBulk();

    var val = map.get(args[1]);
    if (val === undefined) return encoder.nullBulk();
    return encoder.encodeBulkString(val);
}

function cmdHdel(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('hdel');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    if (!map) return encoder.integerReply(0);

    var removed = 0;
    for (var i = 1; i < args.length; i++) {
        if (map.delete(args[i])) removed++;
    }

    if (removed > 0) ctx.store.markDirty(ctx.db, args[0]);
    if (map.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdHgetall(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hgetall');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    if (!map || map.size === 0) return encoder.emptyArray();

    var result = [];
    for (var entry of map) {
        result.push(entry[0]);
        result.push(entry[1]);
    }

    return encoder.encodeArray(result);
}

function cmdHmset(args, ctx) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0) return encoder.wrongArgCount('hmset');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    for (var i = 1; i < args.length; i += 2) {
        map.set(args[i], args[i + 1]);
    }

    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);
    return encoder.ok();
}

function cmdHmget(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('hmget');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    var result = [];

    for (var i = 1; i < args.length; i++) {
        if (map) {
            var val = map.get(args[i]);
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

    var map = ctx.store.get(ctx.db, args[0]);
    if (!map) return encoder.integerReply(0);
    return encoder.integerReply(map.has(args[1]) ? 1 : 0);
}

function cmdHlen(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hlen');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(map ? map.size : 0);
}

function cmdHkeys(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hkeys');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    if (!map || map.size === 0) return encoder.emptyArray();
    return encoder.encodeArray(Array.from(map.keys()));
}

function cmdHvals(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('hvals');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
    if (!map || map.size === 0) return encoder.emptyArray();
    return encoder.encodeArray(Array.from(map.values()));
}

function cmdHincrby(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('hincrby');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var increment = validate.strictParseInt(args[2]);
    if (increment === null) return encoder.encodeError('ERR value is not an integer or out of range');

    var map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    var current = map.get(args[1]);
    if (current === undefined) {
        current = 0;
    } else {
        current = validate.strictParseInt(current);
        if (current === null) return encoder.encodeError('ERR hash value is not an integer');
    }

    var result = current + increment;
    if (result > validate.INT_MAX || result < validate.INT_MIN) {
        return encoder.encodeError('ERR increment or decrement would overflow');
    }

    map.set(args[1], String(result));
    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);

    return encoder.integerReply(result);
}

function cmdHincrbyfloat(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('hincrbyfloat');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var increment = validate.strictParseFloat(args[2]);
    if (increment === null || !isFinite(increment)) return encoder.encodeError('ERR value is not a valid float');

    var map = ctx.store.get(ctx.db, args[0]);
    if (map === undefined) map = new Map();

    var current = map.get(args[1]);
    if (current === undefined) {
        current = 0;
    } else {
        current = validate.strictParseFloat(current);
        if (current === null || !isFinite(current)) return encoder.encodeError('ERR hash value is not a float');
    }

    var result = current + increment;
    if (!isFinite(result)) return encoder.encodeError('ERR increment would produce NaN or Infinity');
    var strResult = String(result);
    map.set(args[1], strResult);
    ctx.store.set(ctx.db, args[0], map, TYPE_HASH);

    return encoder.encodeBulkString(strResult);
}

function cmdHsetnx(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('hsetnx');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_HASH)) return encoder.wrongType();

    var map = ctx.store.get(ctx.db, args[0]);
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
