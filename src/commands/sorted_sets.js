'use strict';

const encoder = require('../protocol/encoder');
const { TYPE_ZSET } = require('../datastore/store');

function getZset(store, db, key) {
    if (!store.checkType(db, key, TYPE_ZSET)) return null;
    let zs = store.get(db, key);
    if (zs === undefined) {
        zs = { members: new Map(), sorted: [] };
        store.set(db, key, zs, TYPE_ZSET);
    }
    return zs;
}

function rebuildSorted(zs) {
    zs.sorted = Array.from(zs.members.entries())
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
        });
}

function insertSorted(zs, member, score) {
    let lo = 0;
    let hi = zs.sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const cmp = zs.sorted[mid].score - score;
        if (cmp < 0 || (cmp === 0 && zs.sorted[mid].member < member)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    zs.sorted.splice(lo, 0, { member, score });
}

function removeSorted(zs, member) {
    const idx = zs.sorted.findIndex(e => e.member === member);
    if (idx >= 0) zs.sorted.splice(idx, 1);
}

function cmdZadd(args, ctx) {
    if (args.length < 3) return encoder.wrongArgCount('zadd');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const key = args[0];
    let nx = false, xx = false, gt = false, lt = false, ch = false;
    let i = 1;

    while (i < args.length) {
        const flag = args[i].toUpperCase();
        if (flag === 'NX') { nx = true; i++; }
        else if (flag === 'XX') { xx = true; i++; }
        else if (flag === 'GT') { gt = true; i++; }
        else if (flag === 'LT') { lt = true; i++; }
        else if (flag === 'CH') { ch = true; i++; }
        else break;
    }

    if ((args.length - i) < 2 || (args.length - i) % 2 !== 0) {
        return encoder.syntaxError();
    }

    let zs = ctx.store.get(ctx.db, key);
    if (zs === undefined) zs = { members: new Map(), sorted: [] };

    let added = 0;
    let changed = 0;

    for (; i < args.length; i += 2) {
        const score = parseFloat(args[i]);
        const member = args[i + 1];

        if (isNaN(score)) return encoder.encodeError('ERR value is not a valid float');

        if (zs.members.has(member)) {
            if (nx) continue;
            const oldScore = zs.members.get(member);

            let update = true;
            if (gt && score <= oldScore) update = false;
            if (lt && score >= oldScore) update = false;

            if (update && score !== oldScore) {
                removeSorted(zs, member);
                zs.members.set(member, score);
                insertSorted(zs, member, score);
                changed++;
            }
        } else {
            if (xx) continue;
            zs.members.set(member, score);
            insertSorted(zs, member, score);
            added++;
        }
    }

    ctx.store.set(ctx.db, key, zs, TYPE_ZSET);
    return encoder.integerReply(ch ? added + changed : added);
}

function cmdZrem(args, ctx) {
    if (args.length < 2) return encoder.wrongArgCount('zrem');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.integerReply(0);

    let removed = 0;
    for (let i = 1; i < args.length; i++) {
        if (zs.members.has(args[i])) {
            removeSorted(zs, args[i]);
            zs.members.delete(args[i]);
            removed++;
        }
    }

    if (zs.members.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdZscore(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('zscore');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.nullBulk();

    const score = zs.members.get(args[1]);
    if (score === undefined) return encoder.nullBulk();
    return encoder.encodeBulkString(String(score));
}

function cmdZrank(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('zrank');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.nullBulk();

    const idx = zs.sorted.findIndex(e => e.member === args[1]);
    if (idx < 0) return encoder.nullBulk();
    return encoder.integerReply(idx);
}

function cmdZrevrank(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('zrevrank');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.nullBulk();

    const idx = zs.sorted.findIndex(e => e.member === args[1]);
    if (idx < 0) return encoder.nullBulk();
    return encoder.integerReply(zs.sorted.length - 1 - idx);
}

function cmdZrange(args, ctx) {
    if (args.length < 3) return encoder.wrongArgCount('zrange');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs || zs.sorted.length === 0) return encoder.emptyArray();

    let start = parseInt(args[1], 10);
    let stop = parseInt(args[2], 10);
    if (isNaN(start) || isNaN(stop)) return encoder.encodeError('ERR value is not an integer or out of range');

    let withScores = false;
    let rev = false;

    for (let i = 3; i < args.length; i++) {
        const flag = args[i].toUpperCase();
        if (flag === 'WITHSCORES') withScores = true;
        else if (flag === 'REV') rev = true;
    }

    const arr = rev ? zs.sorted.slice().reverse() : zs.sorted;
    const len = arr.length;

    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    if (start > stop || start >= len) return encoder.emptyArray();

    stop = Math.min(stop, len - 1);
    const result = [];

    for (let i = start; i <= stop; i++) {
        result.push(arr[i].member);
        if (withScores) result.push(String(arr[i].score));
    }

    return encoder.encodeArray(result);
}

function cmdZrangebyscore(args, ctx) {
    if (args.length < 3) return encoder.wrongArgCount('zrangebyscore');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs || zs.sorted.length === 0) return encoder.emptyArray();

    let minVal, maxVal, minExclusive = false, maxExclusive = false;
    let withScores = false;
    let offset = 0, count = -1;

    const minStr = args[1];
    const maxStr = args[2];

    if (minStr === '-inf') { minVal = -Infinity; }
    else if (minStr === '+inf') { minVal = Infinity; }
    else if (minStr[0] === '(') { minVal = parseFloat(minStr.substring(1)); minExclusive = true; }
    else { minVal = parseFloat(minStr); }

    if (maxStr === '+inf') { maxVal = Infinity; }
    else if (maxStr === '-inf') { maxVal = -Infinity; }
    else if (maxStr[0] === '(') { maxVal = parseFloat(maxStr.substring(1)); maxExclusive = true; }
    else { maxVal = parseFloat(maxStr); }

    for (let i = 3; i < args.length; i++) {
        const flag = args[i].toUpperCase();
        if (flag === 'WITHSCORES') withScores = true;
        else if (flag === 'LIMIT' && i + 2 < args.length) {
            offset = parseInt(args[++i], 10);
            count = parseInt(args[++i], 10);
        }
    }

    const result = [];
    let skipped = 0;
    let collected = 0;

    for (let i = 0; i < zs.sorted.length; i++) {
        const s = zs.sorted[i].score;
        const inRange = (minExclusive ? s > minVal : s >= minVal) &&
                        (maxExclusive ? s < maxVal : s <= maxVal);

        if (inRange) {
            if (skipped < offset) { skipped++; continue; }
            if (count >= 0 && collected >= count) break;
            result.push(zs.sorted[i].member);
            if (withScores) result.push(String(s));
            collected++;
        }
    }

    return encoder.encodeArray(result);
}

function cmdZcard(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('zcard');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(zs ? zs.members.size : 0);
}

function cmdZcount(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('zcount');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.integerReply(0);

    let minVal, maxVal, minExclusive = false, maxExclusive = false;

    const minStr = args[1];
    const maxStr = args[2];

    if (minStr === '-inf') { minVal = -Infinity; }
    else if (minStr[0] === '(') { minVal = parseFloat(minStr.substring(1)); minExclusive = true; }
    else { minVal = parseFloat(minStr); }

    if (maxStr === '+inf') { maxVal = Infinity; }
    else if (maxStr[0] === '(') { maxVal = parseFloat(maxStr.substring(1)); maxExclusive = true; }
    else { maxVal = parseFloat(maxStr); }

    let total = 0;
    for (let i = 0; i < zs.sorted.length; i++) {
        const s = zs.sorted[i].score;
        const inRange = (minExclusive ? s > minVal : s >= minVal) &&
                        (maxExclusive ? s < maxVal : s <= maxVal);
        if (inRange) total++;
    }

    return encoder.integerReply(total);
}

function cmdZincrby(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('zincrby');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const increment = parseFloat(args[1]);
    if (isNaN(increment)) return encoder.encodeError('ERR value is not a valid float');

    const key = args[0];
    const member = args[2];

    let zs = ctx.store.get(ctx.db, key);
    if (zs === undefined) zs = { members: new Map(), sorted: [] };

    let newScore;
    if (zs.members.has(member)) {
        const oldScore = zs.members.get(member);
        newScore = oldScore + increment;
        removeSorted(zs, member);
    } else {
        newScore = increment;
    }

    zs.members.set(member, newScore);
    insertSorted(zs, member, newScore);
    ctx.store.set(ctx.db, key, zs, TYPE_ZSET);

    return encoder.encodeBulkString(String(newScore));
}

function cmdZrevrange(args, ctx) {
    if (args.length < 3) return encoder.wrongArgCount('zrevrange');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    const zs = ctx.store.get(ctx.db, args[0]);
    if (!zs || zs.sorted.length === 0) return encoder.emptyArray();

    let start = parseInt(args[1], 10);
    let stop = parseInt(args[2], 10);
    if (isNaN(start) || isNaN(stop)) return encoder.encodeError('ERR value is not an integer or out of range');

    const withScores = args.length > 3 && args[3].toUpperCase() === 'WITHSCORES';

    const reversed = zs.sorted.slice().reverse();
    const len = reversed.length;

    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    if (start > stop || start >= len) return encoder.emptyArray();
    stop = Math.min(stop, len - 1);

    const result = [];
    for (let i = start; i <= stop; i++) {
        result.push(reversed[i].member);
        if (withScores) result.push(String(reversed[i].score));
    }

    return encoder.encodeArray(result);
}

module.exports = {
    zadd: cmdZadd,
    zrem: cmdZrem,
    zscore: cmdZscore,
    zrank: cmdZrank,
    zrevrank: cmdZrevrank,
    zrange: cmdZrange,
    zrevrange: cmdZrevrange,
    zrangebyscore: cmdZrangebyscore,
    zcard: cmdZcard,
    zcount: cmdZcount,
    zincrby: cmdZincrby
};
