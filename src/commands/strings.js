'use strict';

var encoder = require('../protocol/encoder');
var TYPE_STRING = require('../datastore/store').TYPE_STRING;
var validate = require('../utils/validate');

function cmdSet(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('set');

    var key = args[0];
    var value = args[1];

    var exMs = null;
    var nx = false;
    var xx = false;
    var keepTtl = false;
    var getOld = false;

    var i = 2;
    while (i < args.length) {
        var flag = args[i].toUpperCase();
        switch (flag) {
            case 'EX': {
                if (i + 1 >= args.length) return encoder.syntaxError();
                var exSec = validate.strictParseInt(args[++i]);
                if (exSec === null || exSec <= 0) return encoder.encodeError("ERR invalid expire time in 'set' command");
                exMs = exSec * 1000;
                break;
            }
            case 'PX': {
                if (i + 1 >= args.length) return encoder.syntaxError();
                var pxVal = validate.strictParseInt(args[++i]);
                if (pxVal === null || pxVal <= 0) return encoder.encodeError("ERR invalid expire time in 'set' command");
                exMs = pxVal;
                break;
            }
            case 'EXAT': {
                if (i + 1 >= args.length) return encoder.syntaxError();
                var exatVal = validate.strictParseInt(args[++i]);
                if (exatVal === null) return encoder.encodeError("ERR invalid expire time in 'set' command");
                exMs = (exatVal * 1000) - Date.now();
                break;
            }
            case 'PXAT': {
                if (i + 1 >= args.length) return encoder.syntaxError();
                var pxatVal = validate.strictParseInt(args[++i]);
                if (pxatVal === null) return encoder.encodeError("ERR invalid expire time in 'set' command");
                exMs = pxatVal - Date.now();
                break;
            }
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

    var db = ctx.db;
    var store = ctx.store;

    if (!store.checkType(db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var oldValue = store.get(db, key);

    if (nx && oldValue !== undefined) {
        return getOld ? encoder.encodeBulkString(oldValue) : encoder.nullBulk();
    }

    if (xx && oldValue === undefined) {
        return getOld ? encoder.nullBulk() : encoder.nullBulk();
    }

    var prevExpiry = keepTtl ? store.expiry.getExpiry(db, key) : -1;

    store.set(db, key, value, TYPE_STRING);

    if (exMs !== null && exMs <= 0) {
        store.deleteKey(db, key);
    } else if (keepTtl && prevExpiry > 0) {
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

    var key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var val = ctx.store.get(ctx.db, key);
    if (val === undefined) return encoder.nullBulk();
    return encoder.encodeBulkString(val);
}

function cmdMget(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('mget');

    var results = [];
    for (var i = 0; i < args.length; i++) {
        var key = args[i];
        if (ctx.store.typeOf(ctx.db, key) !== TYPE_STRING) {
            results.push(null);
        } else {
            var val = ctx.store.get(ctx.db, key);
            results.push(val !== undefined ? val : null);
        }
    }

    return encoder.encodeArray(results);
}

function cmdMset(args, ctx) {
    if (args.length < 2 || args.length % 2 !== 0) return encoder.wrongArgCount('mset');

    for (var i = 0; i < args.length; i += 2) {
        ctx.store.set(ctx.db, args[i], args[i + 1], TYPE_STRING);
        ctx.store.expiry.removeExpiry(ctx.db, args[i]);
    }

    return encoder.ok();
}

function cmdSetnx(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('setnx');

    var key = args[0];

    if (ctx.store.exists(ctx.db, key)) {
        return encoder.integerReply(0);
    }

    ctx.store.set(ctx.db, key, args[1], TYPE_STRING);
    return encoder.integerReply(1);
}

function cmdGetdel(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('getdel');

    var key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var val = ctx.store.get(ctx.db, key);
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
    var increment = validate.strictParseInt(args[1]);
    if (increment === null) return encoder.encodeError('ERR value is not an integer or out of range');
    return incrByGeneric([args[0]], ctx, increment, 'incrby');
}

function cmdDecrby(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('decrby');
    var decrement = validate.strictParseInt(args[1]);
    if (decrement === null) return encoder.encodeError('ERR value is not an integer or out of range');
    return incrByGeneric([args[0]], ctx, -decrement, 'decrby');
}

function cmdIncrbyfloat(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('incrbyfloat');

    var key = args[0];
    var increment = validate.strictParseFloat(args[1]);
    if (increment === null || !isFinite(increment)) return encoder.encodeError('ERR value is not a valid float');

    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var current = ctx.store.get(ctx.db, key);
    if (current === undefined) {
        current = 0;
    } else {
        current = validate.strictParseFloat(current);
        if (current === null || !isFinite(current)) return encoder.encodeError('ERR value is not a valid float');
    }

    var result = current + increment;
    if (!isFinite(result)) return encoder.encodeError('ERR increment would produce NaN or Infinity');
    var strResult = String(result);
    ctx.store.set(ctx.db, key, strResult, TYPE_STRING);

    return encoder.encodeBulkString(strResult);
}

function incrByGeneric(args, ctx, delta, cmdName) {
    if (args.length !== 1) return encoder.wrongArgCount(cmdName);

    var key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var current = ctx.store.get(ctx.db, key);
    if (current === undefined) {
        current = 0;
    } else {
        current = validate.strictParseInt(current);
        if (current === null) {
            return encoder.encodeError('ERR value is not an integer or out of range');
        }
    }

    var result = current + delta;
    if (result > validate.INT_MAX || result < validate.INT_MIN) {
        return encoder.encodeError('ERR increment or decrement would overflow');
    }

    ctx.store.set(ctx.db, key, String(result), TYPE_STRING);

    return encoder.integerReply(result);
}

function cmdAppend(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('append');

    var key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var current = ctx.store.get(ctx.db, key);
    if (current === undefined) {
        current = '';
    }

    var newVal = current + args[1];
    ctx.store.set(ctx.db, key, newVal, TYPE_STRING);

    return encoder.integerReply(Buffer.byteLength(newVal));
}

function cmdStrlen(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('strlen');

    var key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var val = ctx.store.get(ctx.db, key);
    if (val === undefined) return encoder.integerReply(0);

    return encoder.integerReply(Buffer.byteLength(val));
}

function cmdGetrange(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('getrange');

    var key = args[0];
    if (!ctx.store.checkType(ctx.db, key, TYPE_STRING)) {
        return encoder.wrongType();
    }

    var val = ctx.store.get(ctx.db, key);
    if (val === undefined) return encoder.encodeBulkString('');

    var start = validate.strictParseInt(args[1]);
    var end = validate.strictParseInt(args[2]);
    if (start === null || end === null) return encoder.encodeError('ERR value is not an integer or out of range');

    var len = val.length;
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
