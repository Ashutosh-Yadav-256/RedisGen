'use strict';

const encoder = require('../protocol/encoder');
const { TYPE_LIST } = require('../datastore/store');

function getList(store, db, key) {
    if (!store.checkType(db, key, TYPE_LIST)) return null;
    let arr = store.get(db, key);
    if (arr === undefined) {
        arr = [];
        store.set(db, key, arr, TYPE_LIST);
    }
    return arr;
}

function cmdLpush(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('lpush');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    let arr = ctx.store.get(ctx.db, args[0]);
    if (arr === undefined) arr = [];

    for (let i = 1; i < args.length; i++) {
        arr.unshift(args[i]);
    }

    ctx.store.set(ctx.db, args[0], arr, TYPE_LIST);
    return encoder.integerReply(arr.length);
}

function cmdRpush(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('rpush');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    let arr = ctx.store.get(ctx.db, args[0]);
    if (arr === undefined) arr = [];

    for (let i = 1; i < args.length; i++) {
        arr.push(args[i]);
    }

    ctx.store.set(ctx.db, args[0], arr, TYPE_LIST);
    return encoder.integerReply(arr.length);
}

function cmdLpop(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('lpop');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    if (!arr || arr.length === 0) return encoder.nullBulk();

    if (args.length === 2) {
        const count = parseInt(args[1], 10);
        if (isNaN(count) || count < 0) return encoder.encodeError('ERR value is not an integer or out of range');
        const items = arr.splice(0, count);
        if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
        return encoder.encodeArray(items);
    }

    const val = arr.shift();
    if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.encodeBulkString(val);
}

function cmdRpop(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('rpop');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    if (!arr || arr.length === 0) return encoder.nullBulk();

    if (args.length === 2) {
        const count = parseInt(args[1], 10);
        if (isNaN(count) || count < 0) return encoder.encodeError('ERR value is not an integer or out of range');
        const items = [];
        for (let i = 0; i < count && arr.length > 0; i++) {
            items.push(arr.pop());
        }
        if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
        return encoder.encodeArray(items);
    }

    const val = arr.pop();
    if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.encodeBulkString(val);
}

function cmdLlen(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('llen');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(arr ? arr.length : 0);
}

function cmdLrange(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('lrange');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    if (!arr || arr.length === 0) return encoder.emptyArray();

    let start = parseInt(args[1], 10);
    let stop = parseInt(args[2], 10);
    if (isNaN(start) || isNaN(stop)) return encoder.encodeError('ERR value is not an integer or out of range');

    const len = arr.length;
    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    if (start > stop || start >= len) return encoder.emptyArray();

    stop = Math.min(stop, len - 1);
    const result = arr.slice(start, stop + 1);
    return encoder.encodeArray(result);
}

function cmdLindex(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('lindex');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.nullBulk();

    let index = parseInt(args[1], 10);
    if (isNaN(index)) return encoder.encodeError('ERR value is not an integer or out of range');

    if (index < 0) index = arr.length + index;
    if (index < 0 || index >= arr.length) return encoder.nullBulk();

    return encoder.encodeBulkString(arr[index]);
}

function cmdLset(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('lset');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.encodeError('ERR no such key');

    let index = parseInt(args[1], 10);
    if (isNaN(index)) return encoder.encodeError('ERR value is not an integer or out of range');

    if (index < 0) index = arr.length + index;
    if (index < 0 || index >= arr.length) return encoder.encodeError('ERR index out of range');

    arr[index] = args[2];
    return encoder.ok();
}

function cmdLrem(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('lrem');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.integerReply(0);

    let count = parseInt(args[1], 10);
    if (isNaN(count)) return encoder.encodeError('ERR value is not an integer or out of range');

    const value = args[2];
    let removed = 0;

    if (count > 0) {
        for (let i = 0; i < arr.length && removed < count; ) {
            if (arr[i] === value) {
                arr.splice(i, 1);
                removed++;
            } else {
                i++;
            }
        }
    } else if (count < 0) {
        const limit = Math.abs(count);
        for (let i = arr.length - 1; i >= 0 && removed < limit; ) {
            if (arr[i] === value) {
                arr.splice(i, 1);
                removed++;
            }
            i--;
        }
    } else {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] === value) {
                arr.splice(i, 1);
                removed++;
            }
        }
    }

    if (arr.length === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdLpos(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('lpos');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_LIST)) return encoder.wrongType();

    const arr = ctx.store.get(ctx.db, args[0]);
    if (!arr) return encoder.nullBulk();

    const element = args[1];
    let rank = 1;
    let count = 1;
    let maxlen = 0;

    for (let i = 2; i < args.length - 1; i += 2) {
        const opt = args[i].toUpperCase();
        if (opt === 'RANK') rank = parseInt(args[i + 1], 10);
        else if (opt === 'COUNT') count = parseInt(args[i + 1], 10);
        else if (opt === 'MAXLEN') maxlen = parseInt(args[i + 1], 10);
    }

    const returnAll = count === 0;
    const results = [];
    let matches = 0;
    const limit = maxlen > 0 ? Math.min(maxlen, arr.length) : arr.length;

    if (rank > 0) {
        let skip = rank - 1;
        for (let i = 0; i < limit; i++) {
            if (arr[i] === element) {
                if (skip > 0) { skip--; continue; }
                results.push(i);
                matches++;
                if (!returnAll && matches >= count) break;
            }
        }
    } else {
        let skip = Math.abs(rank) - 1;
        for (let i = arr.length - 1; i >= Math.max(0, arr.length - limit); i--) {
            if (arr[i] === element) {
                if (skip > 0) { skip--; continue; }
                results.push(i);
                matches++;
                if (!returnAll && matches >= count) break;
            }
        }
    }

    if (count !== 1 || returnAll) {
        return encoder.encodeArray(results.map(r => r));
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
