'use strict';

const encoder = require('../protocol/encoder');
const { TYPE_SET } = require('../datastore/store');

function cmdSadd(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('sadd');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    let set = ctx.store.get(ctx.db, args[0]);
    if (set === undefined) set = new Set();

    let added = 0;
    for (let i = 1; i < args.length; i++) {
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

    const set = ctx.store.get(ctx.db, args[0]);
    if (!set) return encoder.integerReply(0);

    let removed = 0;
    for (let i = 1; i < args.length; i++) {
        if (set.delete(args[i])) removed++;
    }

    if (set.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdSmembers(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('smembers');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    const set = ctx.store.get(ctx.db, args[0]);
    if (!set || set.size === 0) return encoder.emptyArray();
    return encoder.encodeArray(Array.from(set));
}

function cmdSismember(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('sismember');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    const set = ctx.store.get(ctx.db, args[0]);
    if (!set) return encoder.integerReply(0);
    return encoder.integerReply(set.has(args[1]) ? 1 : 0);
}

function cmdSmismember(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('smismember');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    const set = ctx.store.get(ctx.db, args[0]);
    const result = [];
    for (let i = 1; i < args.length; i++) {
        result.push(set && set.has(args[i]) ? 1 : 0);
    }
    return encoder.encodeArray(result);
}

function cmdScard(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('scard');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    const set = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(set ? set.size : 0);
}

function cmdSunion(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('sunion');

    const combined = new Set();

    for (let i = 0; i < args.length; i++) {
        if (!ctx.store.checkType(ctx.db, args[i], TYPE_SET)) return encoder.wrongType();
        const set = ctx.store.get(ctx.db, args[i]);
        if (set) {
            for (const member of set) combined.add(member);
        }
    }

    return encoder.encodeArray(Array.from(combined));
}

function cmdSinter(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('sinter');

    for (let i = 0; i < args.length; i++) {
        if (!ctx.store.checkType(ctx.db, args[i], TYPE_SET)) return encoder.wrongType();
    }

    const firstSet = ctx.store.get(ctx.db, args[0]);
    if (!firstSet || firstSet.size === 0) return encoder.emptyArray();

    const result = new Set(firstSet);

    for (let i = 1; i < args.length; i++) {
        const otherSet = ctx.store.get(ctx.db, args[i]);
        if (!otherSet) return encoder.emptyArray();
        for (const member of result) {
            if (!otherSet.has(member)) result.delete(member);
        }
        if (result.size === 0) return encoder.emptyArray();
    }

    return encoder.encodeArray(Array.from(result));
}

function cmdSdiff(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('sdiff');

    for (let i = 0; i < args.length; i++) {
        if (!ctx.store.checkType(ctx.db, args[i], TYPE_SET)) return encoder.wrongType();
    }

    const firstSet = ctx.store.get(ctx.db, args[0]);
    if (!firstSet || firstSet.size === 0) return encoder.emptyArray();

    const result = new Set(firstSet);

    for (let i = 1; i < args.length; i++) {
        const otherSet = ctx.store.get(ctx.db, args[i]);
        if (otherSet) {
            for (const member of otherSet) result.delete(member);
        }
    }

    return encoder.encodeArray(Array.from(result));
}

function cmdSrandmember(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('srandmember');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    const set = ctx.store.get(ctx.db, args[0]);
    if (!set || set.size === 0) {
        return args.length === 2 ? encoder.emptyArray() : encoder.nullBulk();
    }

    const members = Array.from(set);

    if (args.length === 1) {
        return encoder.encodeBulkString(members[Math.floor(Math.random() * members.length)]);
    }

    let count = parseInt(args[1], 10);
    if (isNaN(count)) return encoder.encodeError('ERR value is not an integer or out of range');

    const result = [];

    if (count >= 0) {
        const shuffled = members.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = tmp;
        }
        for (let i = 0; i < Math.min(count, shuffled.length); i++) {
            result.push(shuffled[i]);
        }
    } else {
        const absCount = Math.abs(count);
        for (let i = 0; i < absCount; i++) {
            result.push(members[Math.floor(Math.random() * members.length)]);
        }
    }

    return encoder.encodeArray(result);
}

function cmdSpop(args, ctx) {
    if (args.length < 1 || args.length > 2) return encoder.wrongArgCount('spop');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_SET)) return encoder.wrongType();

    const set = ctx.store.get(ctx.db, args[0]);
    if (!set || set.size === 0) {
        return args.length === 2 ? encoder.emptyArray() : encoder.nullBulk();
    }

    const members = Array.from(set);

    if (args.length === 1) {
        const idx = Math.floor(Math.random() * members.length);
        const popped = members[idx];
        set.delete(popped);
        if (set.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
        return encoder.encodeBulkString(popped);
    }

    let count = parseInt(args[1], 10);
    if (isNaN(count) || count < 0) return encoder.encodeError('ERR value is not an integer or out of range');

    const result = [];
    for (let i = 0; i < count && set.size > 0; i++) {
        const arr = Array.from(set);
        const idx = Math.floor(Math.random() * arr.length);
        result.push(arr[idx]);
        set.delete(arr[idx]);
    }

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
