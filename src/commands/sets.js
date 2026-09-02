'use strict';

var encoder = require('../protocol/encoder');
var TYPE_SET = require('../datastore/store').TYPE_SET;
var validate = require('../utils/validate');

function cmdSadd(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('sadd');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    if (set === undefined) set = new Set();

    var added = 0;
    for (var i = 1; i < args.length; i++) {
        if (!set.has(args[i])) {
            set.add(args[i]);
            added++;
        }
    }

    ctx.store.set(ctx.db, args[0], set, TYPE_SET);
    return encoder.integerReply(added);
}

function cmdSrem(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('srem');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    if (!set) return encoder.integerReply(0);

    var removed = 0;
    for (var i = 1; i < args.length; i++) {
        if (set.delete(args[i])) removed++;
    }

    if (removed > 0) ctx.store.markDirty(ctx.db, args[0]);
    if (set.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdSmembers(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('smembers');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    if (!set || set.size === 0) return encoder.emptyArray();
    return encoder.encodeArray(Array.from(set));
}

function cmdSismember(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('sismember');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    if (!set) return encoder.integerReply(0);
    return encoder.integerReply(set.has(args[1]) ? 1 : 0);
}

function cmdSmismember(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('smismember');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    var result = [];
    for (var i = 1; i < args.length; i++) {
        result.push(set && set.has(args[i]) ? 1 : 0);
    }
    return encoder.encodeArray(result);
}

function cmdScard(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('scard');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(set ? set.size : 0);
}

function cmdSunion(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('sunion');

    var combined = new Set();

    for (var i = 0; i < args.length; i++) {
        if (!ctx.store.checkType(ctx.db, args[i], TYPE_SET)) return encoder.wrongType();
        var set = ctx.store.get(ctx.db, args[i]);
        if (set) {
            for (var member of set) combined.add(member);
        }
    }

    return encoder.encodeArray(Array.from(combined));
}

function cmdSinter(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('sinter');

    for (var i = 0; i < args.length; i++) {
        if (!ctx.store.checkType(ctx.db, args[i], TYPE_SET)) return encoder.wrongType();
    }

    var firstSet = ctx.store.get(ctx.db, args[0]);
    if (!firstSet || firstSet.size === 0) return encoder.emptyArray();

    var result = new Set(firstSet);

    for (var j = 1; j < args.length; j++) {
        var otherSet = ctx.store.get(ctx.db, args[j]);
        if (!otherSet) return encoder.emptyArray();
        for (var m of result) {
            if (!otherSet.has(m)) result.delete(m);
        }
        if (result.size === 0) return encoder.emptyArray();
    }

    return encoder.encodeArray(Array.from(result));
}

function cmdSdiff(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('sdiff');

    for (var i = 0; i < args.length; i++) {
        if (!ctx.store.checkType(ctx.db, args[i], TYPE_SET)) return encoder.wrongType();
    }

    var firstSet = ctx.store.get(ctx.db, args[0]);
    if (!firstSet || firstSet.size === 0) return encoder.emptyArray();

    var result = new Set(firstSet);

    for (var j = 1; j < args.length; j++) {
        var otherSet = ctx.store.get(ctx.db, args[j]);
        if (otherSet) {
            for (var m of otherSet) result.delete(m);
        }
    }

    return encoder.encodeArray(Array.from(result));
}

function cmdSrandmember(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('srandmember');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    if (!set || set.size === 0) {
        return args.length === 2 ? encoder.emptyArray() : encoder.nullBulk();
    }

    var members = Array.from(set);

    if (args.length === 1) {
        return encoder.encodeBulkString(members[Math.floor(Math.random() * members.length)]);
    }

    var count = validate.strictParseInt(args[1]);
    if (count === null) return encoder.encodeError('ERR value is not an integer or out of range');

    var result = [];

    if (count >= 0) {
        var shuffled = members.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = tmp;
        }
        for (var si = 0; si < Math.min(count, shuffled.length); si++) {
            result.push(shuffled[si]);
        }
    } else {
        var absCount = Math.abs(count);
        for (var ni = 0; ni < absCount; ni++) {
            result.push(members[Math.floor(Math.random() * members.length)]);
        }
    }

    return encoder.encodeArray(result);
}

function cmdSpop(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('spop');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    var set = ctx.store.get(ctx.db, args[0]);
    if (!set || set.size === 0) {
        return args.length === 2 ? encoder.emptyArray() : encoder.nullBulk();
    }

    var members = Array.from(set);

    if (args.length === 1) {
        var idx = Math.floor(Math.random() * members.length);
        var popped = members[idx];
        set.delete(popped);
        ctx.store.markDirty(ctx.db, args[0]);
        if (set.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
        return encoder.encodeBulkString(popped);
    }

    var count = validate.strictParseInt(args[1]);
    if (count === null || count < 0) return encoder.encodeError('ERR value is not an integer or out of range');

    var result = [];
    for (var pi = 0; pi < count && set.size > 0; pi++) {
        var arr = Array.from(set);
        var pidx = Math.floor(Math.random() * arr.length);
        result.push(arr[pidx]);
        set.delete(arr[pidx]);
    }

    ctx.store.markDirty(ctx.db, args[0]);
    if (set.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.encodeArray(result);
}

module.exports = {
    sadd: cmdSadd,
    srem: cmdSrem,
    smembers: cmdSmembers,
    sismember: cmdSismember,
    smismember: cmdSmismember,
    scard: cmdScard,
    sunion: cmdSunion,
    sinter: cmdSinter,
    sdiff: cmdSdiff,
    srandmember: cmdSrandmember,
    spop: cmdSpop
};
