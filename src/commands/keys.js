'use strict';

var encoder = require('../protocol/encoder');
var globMatch = require('../utils/glob').globMatch;
var validate = require('../utils/validate');

function cmdDel(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('del');

    var count = 0;
    for (var i = 0; i < args.length; i++) {
        if (ctx.store.deleteKey(ctx.db, args[i])) {
            count++;
        }
    }

    return encoder.integerReply(count);
}

function cmdUnlink(args, ctx) {
    return cmdDel(args, ctx);
}

function cmdExists(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('exists');

    var count = 0;
    for (var i = 0; i < args.length; i++) {
        if (ctx.store.exists(ctx.db, args[i])) {
            count++;
        }
    }

    return encoder.integerReply(count);
}

function cmdKeys(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('keys');

    var pattern = args[0];
    var allKeys = ctx.store.keysInDb(ctx.db);
    var matched = [];

    for (var i = 0; i < allKeys.length; i++) {
        if (pattern === '*' || globMatch(pattern, allKeys[i])) {
            matched.push(allKeys[i]);
        }
    }

    return encoder.encodeArray(matched);
}

function cmdType(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('type');

    var t = ctx.store.typeOf(ctx.db, args[0]);
    return encoder.encodeSimpleString(t);
}

function cmdExpire(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('expire');

    var key = args[0];
    var seconds = validate.strictParseInt(args[1]);
    if (seconds === null) return encoder.encodeError('ERR value is not an integer or out of range');

    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(0);

    if (seconds <= 0) {
        ctx.store.deleteKey(ctx.db, key);
        return encoder.integerReply(1);
    }

    ctx.store.expiry.setExpiry(ctx.db, key, seconds * 1000);
    return encoder.integerReply(1);
}

function cmdPexpire(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('pexpire');

    var key = args[0];
    var ms = validate.strictParseInt(args[1]);
    if (ms === null) return encoder.encodeError('ERR value is not an integer or out of range');

    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(0);

    if (ms <= 0) {
        ctx.store.deleteKey(ctx.db, key);
        return encoder.integerReply(1);
    }

    ctx.store.expiry.setExpiry(ctx.db, key, ms);
    return encoder.integerReply(1);
}

function cmdExpireat(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('expireat');

    var key = args[0];
    var ts = validate.strictParseInt(args[1]);
    if (ts === null) return encoder.encodeError('ERR value is not an integer or out of range');

    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(0);

    var deadline = ts * 1000;
    if (deadline <= Date.now()) {
        ctx.store.deleteKey(ctx.db, key);
        return encoder.integerReply(1);
    }

    ctx.store.expiry.setExpireAt(ctx.db, key, deadline);
    return encoder.integerReply(1);
}

function cmdPexpireat(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('pexpireat');

    var key = args[0];
    var tsMs = validate.strictParseInt(args[1]);
    if (tsMs === null) return encoder.encodeError('ERR value is not an integer or out of range');

    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(0);

    if (tsMs <= Date.now()) {
        ctx.store.deleteKey(ctx.db, key);
        return encoder.integerReply(1);
    }

    ctx.store.expiry.setExpireAt(ctx.db, key, tsMs);
    return encoder.integerReply(1);
}

function cmdTtl(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('ttl');

    var key = args[0];
    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(-2);

    var ttl = ctx.store.expiry.ttlSec(ctx.db, key);
    return encoder.integerReply(ttl);
}

function cmdPttl(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('pttl');

    var key = args[0];
    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(-2);

    var pttl = ctx.store.expiry.ttlMs(ctx.db, key);
    return encoder.integerReply(pttl);
}

function cmdPersist(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('persist');

    var key = args[0];
    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(0);
    if (!ctx.store.expiry.hasExpiry(ctx.db, key)) return encoder.integerReply(0);

    ctx.store.expiry.removeExpiry(ctx.db, key);
    return encoder.integerReply(1);
}

function cmdRename(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('rename');

    if (!ctx.store.rename(ctx.db, args[0], args[1])) {
        return encoder.encodeError('ERR no such key');
    }

    return encoder.ok();
}

function cmdRenamenx(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('renamenx');

    if (!ctx.store.exists(ctx.db, args[0])) {
        return encoder.encodeError('ERR no such key');
    }

    if (ctx.store.exists(ctx.db, args[1])) {
        return encoder.integerReply(0);
    }

    ctx.store.rename(ctx.db, args[0], args[1]);
    return encoder.integerReply(1);
}

function cmdRandomkey(args, ctx) {
    var key = ctx.store.randomKey(ctx.db);
    if (key === null) return encoder.nullBulk();
    return encoder.encodeBulkString(key);
}

function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

function cmdScan(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('scan');

    var cursor = parseInt(args[0], 10);
    if (isNaN(cursor)) cursor = 0;
    var pattern = '*';
    var count = 10;

    for (var i = 1; i < args.length - 1; i += 2) {
        var opt = args[i].toUpperCase();
        if (opt === 'MATCH') {
            pattern = args[i + 1];
        } else if (opt === 'COUNT') {
            var c = validate.strictParseInt(args[i + 1]);
            if (c !== null && c > 0) count = c;
        }
    }

    var allKeys = ctx.store.keysInDb(ctx.db);
    var bucketBits = 10;
    var bucketCount = 1 << bucketBits;

    var buckets = new Array(bucketCount);
    for (var bi = 0; bi < bucketCount; bi++) buckets[bi] = [];

    for (var ki = 0; ki < allKeys.length; ki++) {
        var h = simpleHash(allKeys[ki]) & (bucketCount - 1);
        buckets[h].push(allKeys[ki]);
    }

    var matched = [];
    var startBucket = cursor;
    var nextCursor = 0;
    var visited = 0;

    for (var b = startBucket; b < bucketCount; b++) {
        var bucket = buckets[b];
        for (var mi = 0; mi < bucket.length; mi++) {
            if (pattern === '*' || globMatch(pattern, bucket[mi])) {
                matched.push(bucket[mi]);
            }
        }
        visited++;
        if (visited >= count && matched.length > 0) {
            if (b + 1 < bucketCount) {
                nextCursor = b + 1;
            }
            break;
        }
    }

    return encoder.encodeArray([String(nextCursor), matched]);
}

function cmdObject(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('object');

    var subcmd = args[0].toUpperCase();
    if (subcmd === 'HELP') {
        return encoder.encodeArray([
            'OBJECT <subcommand> [<arg> [value] ...]',
            'ENCODING <key> - Return the encoding of the object stored at <key>.',
            'FREQ <key> - Return the access frequency of the key.',
            'HELP - Return subcommand help.',
            'IDLETIME <key> - Return idle time of the key.',
            'REFCOUNT <key> - Return the reference count of the object.'
        ]);
    }

    if (args.length < 2) return encoder.wrongArgCount('object');

    var key = args[1];
    if (!ctx.store.exists(ctx.db, key)) {
        return encoder.encodeError('ERR no such key');
    }

    switch (subcmd) {
        case 'ENCODING': {
            var type = ctx.store.typeOf(ctx.db, key);
            var enc = 'raw';
            if (type === 'string') {
                var val = ctx.store.get(ctx.db, key);
                enc = /^-?\d+$/.test(val) && Math.abs(parseInt(val, 10)) < 2147483648 ? 'int' : 'embstr';
            } else if (type === 'list') enc = 'listpack';
            else if (type === 'hash') enc = 'listpack';
            else if (type === 'set') enc = 'listpack';
            else if (type === 'zset') enc = 'listpack';
            return encoder.encodeBulkString(enc);
        }
        case 'REFCOUNT':
            return encoder.integerReply(1);
        case 'IDLETIME':
            return encoder.integerReply(0);
        case 'FREQ':
            return encoder.integerReply(0);
        default:
            return encoder.encodeError("ERR unknown subcommand '" + subcmd + "'");
    }
}

module.exports = {
    del: cmdDel,
    unlink: cmdUnlink,
    exists: cmdExists,
    keys: cmdKeys,
    type: cmdType,
    expire: cmdExpire,
    pexpire: cmdPexpire,
    expireat: cmdExpireat,
    pexpireat: cmdPexpireat,
    ttl: cmdTtl,
    pttl: cmdPttl,
    persist: cmdPersist,
    rename: cmdRename,
    renamenx: cmdRenamenx,
    randomkey: cmdRandomkey,
    scan: cmdScan,
    object: cmdObject
};
