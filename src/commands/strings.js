'use strict';

const encoder = require('../protocol/encoder');
const { TYPE_STRING } = require('../datastore/store');

function cmdSet(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('set');

    const key = args[0];
    const value = args[1];

    let exMs = null;
    let nx = false;
    let xx = false;
    let keepTtl = false;
    let getOld = false;

    let i = 2;
    while (i < args.length) {
        const flag = args[i].toUpperCase();
        switch (flag) {
            case 'EX':
                if (i + 1 >= args.length) return encoder.syntaxError();
                exMs = parseInt(args[++i], 10) * 1000;
                if (isNaN(exMs) || exMs <= 0) return encoder.encodeError('ERR invalid expire time in \'set\' command');
                break;
            case 'PX':
                if (i + 1 >= args.length) return encoder.syntaxError();
                exMs = parseInt(args[++i], 10);
                if (isNaN(exMs) || exMs <= 0) return encoder.encodeError('ERR invalid expire time in \'set\' command');
                break;
            case 'EXAT':
                if (i + 1 >= args.length) return encoder.syntaxError();
                exMs = (parseInt(args[++i], 10) * 1000) - Date.now();
                if (isNaN(exMs)) return encoder.encodeError('ERR invalid expire time in \'set\' command');
                break;
            case 'PXAT':
                if (i + 1 >= args.length) return encoder.syntaxError();
                exMs = parseInt(args[++i], 10) - Date.now();
                if (isNaN(exMs)) return encoder.encodeError('ERR invalid expire time in \'set\' command');
                break;
            case 'NX': nx = true; break;
            case 'XX': xx = true; break;
            case 'KEEPTTL': keepTtl = true; break;
            case 'GET': getOld = true; break;
            default:
                return encoder.syntaxError();
        }
        i++;
    }

    if (nx && xx) return encoder.syntaxError();

    const db = ctx.db;
    const store = ctx.store;

    if (!store.checkType(db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    const oldValue = store.get(db, key);

    if (nx && oldValue !== undefined) {
        return getOld ? encoder.encodeBulkString(oldValue) : encoder.nullBulk();
    }

    if (xx && oldValue === undefined) {
        return getOld ? encoder.nullBulk() : encoder.nullBulk();
    }

    const prevExpiry = keepTtl ? store.expiry.getExpiry(db, key) : -1;

    store.set(db, key, value, TYPE_STRING);

    if (keepTtl && prevExpiry > 0) {
        store.expiry.setExpireAt(db, key, prevExpiry);
    } else if (exMs !== null && exMs > 0) {
        store.expiry.setExpiry(db, key, exMs);
    } else if (!keepTtl) {
        store.expiry.removeExpiry(db, key);
    }

    if (getOld) {
        return oldValue !== undefined ? encoder.encodeBulkString(oldValue) : encoder.nullBulk();
    }

    return encoder.ok();
}

function cmdGet(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('get');

    const key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    const val = ctx.store.get(ctx.db, key);
    if (val === undefined) return encoder.nullBulk();
    return encoder.encodeBulkString(val);
}

function cmdMget(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('mget');

    const results = [];
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (ctx.store.typeOf(ctx.db, key) !== TYPE_STRING) {
            results.push(null);
        } else {
            const val = ctx.store.get(ctx.db, key);
            results.push(val !== undefined ? val : null);
        }
    }

    return encoder.encodeArray(results);
}

function cmdMset(args, ctx) {
    if (args.length < 2 || args.length % 2 !== 0) return encoder.wrongArgCount('mset');

    for (let i = 0; i < args.length; i += 2) {
        ctx.store.set(ctx.db, args[i], args[i + 1], TYPE_STRING);
        ctx.store.expiry.removeExpiry(ctx.db, args[i]);
    }

    return encoder.ok();
}

function cmdSetnx(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('setnx');

    const key = args[0];

    if (ctx.store.exists(ctx.db, key)) {
        return encoder.integerReply(0);
    }

    ctx.store.set(ctx.db, key, args[1], TYPE_STRING);
    return encoder.integerReply(1);
}

function cmdGetdel(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('getdel');

    const key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    const val = ctx.store.get(ctx.db, key);
    if (val === undefined) return encoder.nullBulk();

    ctx.store.deleteKey(ctx.db, key);
    return encoder.encodeBulkString(val);
}

function cmdIncr(args, ctx) {
    return incrByGeneric(args, ctx, 1, 'incr');
}

function cmdDecr(args, ctx) {
    return incrByGeneric(args, ctx, -1, 'decr');
}

function cmdIncrby(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('incrby');
    const increment = parseInt(args[1], 10);
    if (isNaN(increment)) return encoder.encodeError('ERR value is not an integer or out of range');
    return incrByGeneric([args[0]], ctx, increment, 'incrby');
}

function cmdDecrby(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('decrby');
    const decrement = parseInt(args[1], 10);
    if (isNaN(decrement)) return encoder.encodeError('ERR value is not an integer or out of range');
    return incrByGeneric([args[0]], ctx, -decrement, 'decrby');
}

function cmdIncrbyfloat(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('incrbyfloat');

    const key = args[0];
    const increment = parseFloat(args[1]);
    if (isNaN(increment)) return encoder.encodeError('ERR value is not a valid float');

    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    let current = ctx.store.get(ctx.db, key);
    if (current === undefined) {
        current = 0;
    } else {
        current = parseFloat(current);
        if (isNaN(current)) return encoder.encodeError('ERR value is not a valid float');
    }

    const result = current + increment;
    const strResult = Number.isInteger(result) ? result.toString() : result.toString();
    ctx.store.set(ctx.db, key, strResult, TYPE_STRING);

    return encoder.encodeBulkString(strResult);
}

function incrByGeneric(args, ctx, delta, cmdName) {
    if (args.length !== 1) return encoder.wrongArgCount(cmdName);

    const key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    let current = ctx.store.get(ctx.db, key);
    if (current === undefined) {
        current = 0;
    } else {
        current = parseInt(current, 10);
        if (isNaN(current)) {
            return encoder.encodeError('ERR value is not an integer or out of range');
        }
    }

    const result = current + delta;
    ctx.store.set(ctx.db, key, String(result), TYPE_STRING);

    return encoder.integerReply(result);
}

function cmdAppend(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('append');

    const key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    let current = ctx.store.get(ctx.db, key);
    if (current === undefined) {
        current = '';
    }

    const newVal = current + args[1];
    ctx.store.set(ctx.db, key, newVal, TYPE_STRING);

    return encoder.integerReply(Buffer.byteLength(newVal));
}

function cmdStrlen(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('strlen');

    const key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    const val = ctx.store.get(ctx.db, key);
    if (val === undefined) return encoder.integerReply(0);

    return encoder.integerReply(Buffer.byteLength(val));
}

function cmdGetrange(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('getrange');

    const key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    const val = ctx.store.get(ctx.db, key);
    if (val === undefined) return encoder.encodeBulkString('');

    let start = parseInt(args[1], 10);
    let end = parseInt(args[2], 10);
    if (isNaN(start) || isNaN(end)) return encoder.encodeError('ERR value is not an integer or out of range');

    const len = val.length;
    if (start < 0) start = Math.max(0, len + start);
    if (end < 0) end = len + end;
    if (start > end || start >= len) return encoder.encodeBulkString('');

    end = Math.min(end, len - 1);
    return encoder.encodeBulkString(val.substring(start, end + 1));
}

module.exports = {
    set: cmdSet,
    get: cmdGet,
    mget: cmdMget,
    mset: cmdMset,
    setnx: cmdSetnx,
    getdel: cmdGetdel,
    incr: cmdIncr,
    decr: cmdDecr,
    incrby: cmdIncrby,
    decrby: cmdDecrby,
    incrbyfloat: cmdIncrbyfloat,
    append: cmdAppend,
    strlen: cmdStrlen,
    getrange: cmdGetrange
};
