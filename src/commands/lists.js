'use strict';

var encoder = require('../protocol/encoder');
var TYPE_LIST = require('../datastore/store').TYPE_LIST;
var validate = require('../utils/validate');

function cmdLpush(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('lpush');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (arr === undefined) arr = [];

    for (var i = 1; i < args.length; i++) {
        arr.unshift(args[i]);
    }

    ctx.store.set(ctx.db, args[0], arr, TYPE_LIST);
    return encoder.integerReply(arr.length);
}

function cmdRpush(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('rpush');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (arr === undefined) arr = [];

    for (var i = 1; i < args.length; i++) {
        arr.push(args[i]);
    }

    ctx.store.set(ctx.db, args[0], arr, TYPE_LIST);
    return encoder.integerReply(arr.length);
}

function cmdLpop(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('lpop');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (!arr || arr.length === 0) return encoder.nullBulk();

    if (args.length === 2) {
        var count = validate.strictParseInt(args[1]);
        if (count === null || count < 0) return encoder.encodeError('ERR value is not an integer or out of range');
        var items = arr.splice(0, count);
        ctx.store.markDirty(ctx.db, args[0]);
        if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
        return encoder.encodeArray(items);
    }

    var val = arr.shift();
    ctx.store.markDirty(ctx.db, args[0]);
    if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.encodeBulkString(val);
}

function cmdRpop(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('rpop');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (!arr || arr.length === 0) return encoder.nullBulk();

    if (args.length === 2) {
        var count = validate.strictParseInt(args[1]);
        if (count === null || count < 0) return encoder.encodeError('ERR value is not an integer or out of range');
        var items = [];
        for (var i = 0; i < count && arr.length > 0; i++) {
            items.push(arr.pop());
        }
        ctx.store.markDirty(ctx.db, args[0]);
        if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
        return encoder.encodeArray(items);
    }

    var val = arr.pop();
    ctx.store.markDirty(ctx.db, args[0]);
    if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.encodeBulkString(val);
}

function cmdLlen(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('llen');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(arr ? arr.length : 0);
}

function cmdLrange(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('lrange');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (!arr || arr.length === 0) return encoder.emptyArray();

    var start = validate.strictParseInt(args[1]);
    var stop = validate.strictParseInt(args[2]);
    if (start === null || stop === null) return encoder.encodeError('ERR value is not an integer or out of range');

    var len = arr.length;
    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    if (start > stop || start >= len) return encoder.emptyArray();

    stop = Math.min(stop, len - 1);
    var result = arr.slice(start, stop + 1);
    return encoder.encodeArray(result);
}

function cmdLindex(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('lindex');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.nullBulk();

    var index = validate.strictParseInt(args[1]);
    if (index === null) return encoder.encodeError('ERR value is not an integer or out of range');

    if (index < 0) index = arr.length + index;
    if (index < 0 || index >= arr.length) return encoder.nullBulk();

    return encoder.encodeBulkString(arr[index]);
}

function cmdLset(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('lset');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.encodeError('ERR no such key');

    var index = validate.strictParseInt(args[1]);
    if (index === null) return encoder.encodeError('ERR value is not an integer or out of range');

    if (index < 0) index = arr.length + index;
    if (index < 0 || index >= arr.length) return encoder.encodeError('ERR index out of range');

    arr[index] = args[2];
    ctx.store.markDirty(ctx.db, args[0]);
    return encoder.ok();
}

function cmdLrem(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('lrem');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.integerReply(0);

    var count = validate.strictParseInt(args[1]);
    if (count === null) return encoder.encodeError('ERR value is not an integer or out of range');

    var value = args[2];
    var removed = 0;

    if (count > 0) {
        for (var i = 0; i < arr.length && removed < count; ) {
            if (arr[i] === value) {
                arr.splice(i, 1);
                removed++;
            } else {
                i++;
            }
        }
    } else if (count < 0) {
        var limit = Math.abs(count);
        for (var j = arr.length - 1; j >= 0 && removed < limit; ) {
            if (arr[j] === value) {
                arr.splice(j, 1);
                removed++;
            }
            j--;
        }
    } else {
        for (var k = arr.length - 1; k >= 0; k--) {
            if (arr[k] === value) {
                arr.splice(k, 1);
                removed++;
            }
        }
    }

    if (removed > 0) ctx.store.markDirty(ctx.db, args[0]);
    if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdLpos(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('lpos');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    var arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.nullBulk();

    var element = args[1];
    var rank = 1;
    var count = 1;
    var maxlen = 0;

    for (var i = 2; i < args.length - 1; i += 2) {
        var opt = args[i].toUpperCase();
        if (opt === 'RANK') rank = parseInt(args[i + 1], 10);
        else if (opt === 'COUNT') count = parseInt(args[i + 1], 10);
        else if (opt === 'MAXLEN') maxlen = parseInt(args[i + 1], 10);
    }

    var returnAll = count === 0;
    var results = [];
    var matches = 0;
    var scanLimit = maxlen > 0 ? Math.min(maxlen, arr.length) : arr.length;

    if (rank > 0) {
        var skip = rank - 1;
        for (var si = 0; si < scanLimit; si++) {
            if (arr[si] === element) {
                if (skip > 0) { skip--; continue; }
                results.push(si);
                matches++;
                if (!returnAll && matches >= count) break;
            }
        }
    } else {
        var skipRev = Math.abs(rank) - 1;
        for (var ri = arr.length - 1; ri >= Math.max(0, arr.length - scanLimit); ri--) {
            if (arr[ri] === element) {
                if (skipRev > 0) { skipRev--; continue; }
                results.push(ri);
                matches++;
                if (!returnAll && matches >= count) break;
            }
        }
    }

    if (count !== 1 || returnAll) {
        return encoder.encodeArray(results.map(function (r) { return r; }));
    }

    return results.length > 0 ? encoder.integerReply(results[0]) : encoder.nullBulk();
}

module.exports = {
    lpush: cmdLpush,
    rpush: cmdRpush,
    lpop: cmdLpop,
    rpop: cmdRpop,
    llen: cmdLlen,
    lrange: cmdLrange,
    lindex: cmdLindex,
    lset: cmdLset,
    lrem: cmdLrem,
    lpos: cmdLpos
};
