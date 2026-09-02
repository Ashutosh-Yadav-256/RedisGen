'use strict';

const encoder = require('../protocol/encoder');
const { globMatch } = require('../utils/glob');

function cmdDel(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('del');

    let count = 0;
    for (let i = 0; i < args.length; i++) {
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

    let count = 0;
    for (let i = 0; i < args.length; i++) {
        if (ctx.store.exists(ctx.db, args[i])) {
            count++;
        }
    }

    return encoder.integerReply(count);
}

function cmdKeys(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('keys');

    const pattern = args[0];
    const allKeys = ctx.store.keysInDb(ctx.db);
    const matched = [];

    for (let i = 0; i < allKeys.length; i++) {
        if (pattern === '*' || globMatch(pattern, allKeys[i])) {
            matched.push(allKeys[i]);
        }
    }

    return encoder.encodeArray(matched);
}

function cmdType(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('type');

    const t = ctx.store.typeOf(ctx.db, args[0]);
    return encoder.encodeSimpleString(t);
}

function cmdExpire(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('expire');

    const key = args[0];
    const seconds = parseInt(args[1], 10);
    if (isNaN(seconds)) return encoder.encodeError('ERR value is not an integer or out of range');

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

    const key = args[0];
    const ms = parseInt(args[1], 10);
    if (isNaN(ms)) return encoder.encodeError('ERR value is not an integer or out of range');

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

    const key = args[0];
    const ts = parseInt(args[1], 10);
    if (isNaN(ts)) return encoder.encodeError('ERR value is not an integer or out of range');

    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(0);

    ctx.store.expiry.setExpireAt(ctx.db, key, ts * 1000);
    return encoder.integerReply(1);
}

function cmdPexpireat(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('pexpireat');

    const key = args[0];
    const tsMs = parseInt(args[1], 10);
    if (isNaN(tsMs)) return encoder.encodeError('ERR value is not an integer or out of range');

    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(0);

    ctx.store.expiry.setExpireAt(ctx.db, key, tsMs);
    return encoder.integerReply(1);
}

function cmdTtl(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('ttl');

    const key = args[0];
    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(-2);

    const ttl = ctx.store.expiry.ttlSec(ctx.db, key);
    return encoder.integerReply(ttl);
}

function cmdPttl(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('pttl');

    const key = args[0];
    if (!ctx.store.exists(ctx.db, key)) return encoder.integerReply(-2);

    const pttl = ctx.store.expiry.ttlMs(ctx.db, key);
    return encoder.integerReply(pttl);
}

function cmdPersist(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('persist');

    const key = args[0];
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
    const key = ctx.store.randomKey(ctx.db);
    if (key === null) return encoder.nullBulk();
    return encoder.encodeBulkString(key);
}

function cmdScan(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('scan');

    let cursor = parseInt(args[0], 10);
    let pattern = '*';
    let count = 10;

    for (let i = 1; i < args.length - 1; i += 2) {
        const opt = args[i].toUpperCase();
        if (opt === 'MATCH') {
            pattern = args[i + 1];
        } else if (opt === 'COUNT') {
            count = parseInt(args[i + 1], 10);
            if (isNaN(count) || count <= 0) count = 10;
        }
    }

    const allKeys = ctx.store.keysInDb(ctx.db);
    const matched = [];
    const start = cursor;
    let nextCursor = 0;

    const end = Math.min(start + count, allKeys.length);

    for (let i = start; i < end; i++) {
        if (pattern === '*' || globMatch(pattern, allKeys[i])) {
            matched.push(allKeys[i]);
        }
    }

    if (end < allKeys.length) {
        nextCursor = end;
    }

    return encoder.encodeArray([String(nextCursor), matched]);
}

function cmdObject(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('object');

    const subcmd = args[0].toUpperCase();
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

    const key = args[1];
    if (!ctx.store.exists(ctx.db, key)) {
        return encoder.encodeError('ERR no such key');
    }

    switch (subcmd) {
        case 'ENCODING': {
            const type = ctx.store.typeOf(ctx.db, key);
            let enc = 'raw';
            if (type === 'string') {
                const val = ctx.store.get(ctx.db, key);
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
