'use strict';

var encoder = require('../protocol/encoder');
var TYPE_ZSET = require('../datastore/store').TYPE_ZSET;
var validate = require('../utils/validate');

function rebuildSorted(zs) {
    zs.sorted = Array.from(zs.members.entries())
        .map(function (e) { return { member: e[0], score: e[1] }; })
        .sort(function (a, b) {
            if (a.score !== b.score) return a.score - b.score;
            return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
        });
}

function insertSorted(zs, member, score) {
    var lo = 0;
    var hi = zs.sorted.length;
    while (lo < hi) {
        var mid = (lo + hi) >>> 1;
        var cmp = zs.sorted[mid].score - score;
        if (cmp < 0 || (cmp === 0 && zs.sorted[mid].member < member)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    zs.sorted.splice(lo, 0, { member: member, score: score });
}

function removeSorted(zs, member) {
    var idx = -1;
    for (var i = 0; i < zs.sorted.length; i++) {
        if (zs.sorted[i].member === member) { idx = i; break; }
    }
    if (idx >= 0) zs.sorted.splice(idx, 1);
}

function parseScoreBound(str) {
    if (str === '-inf') return { val: -Infinity, exclusive: false };
    if (str === '+inf') return { val: Infinity, exclusive: false };
    if (str[0] === '(') {
        var v = validate.strictParseFloat(str.substring(1));
        return v !== null ? { val: v, exclusive: true } : null;
    }
    var fv = validate.strictParseFloat(str);
    return fv !== null ? { val: fv, exclusive: false } : null;
}

function cmdZadd(args, ctx) {
    if (args.length < 3) return encoder.wrongArgCount('zadd');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var key = args[0];
    var nx = false, xx = false, gt = false, lt = false, ch = false;
    var i = 1;

    while (i < args.length) {
        var flag = args[i].toUpperCase();
        if (flag === 'NX') { nx = true; i++; }
        else if (flag === 'XX') { xx = true; i++; }
        else if (flag === 'GT') { gt = true; i++; }
        else if (flag === 'LT') { lt = true; i++; }
        else if (flag === 'CH') { ch = true; i++; }
        else break;
    }

    if (nx && (gt || lt)) return encoder.syntaxError();
    if (nx && xx) return encoder.syntaxError();

    if ((args.length - i) < 2 || (args.length - i) % 2 !== 0) {
        return encoder.syntaxError();
    }

    var zs = ctx.store.get(ctx.db, key);
    if (zs === undefined) zs = { members: new Map(), sorted: [] };

    var added = 0;
    var changed = 0;

    for (; i < args.length; i += 2) {
        var score = validate.strictParseFloat(args[i]);
        var member = args[i + 1];

        if (score === null) return encoder.encodeError('ERR value is not a valid float');

        if (zs.members.has(member)) {
            if (nx) continue;
            var oldScore = zs.members.get(member);

            var update = true;
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

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.integerReply(0);

    var removed = 0;
    for (var i = 1; i < args.length; i++) {
        if (zs.members.has(args[i])) {
            removeSorted(zs, args[i]);
            zs.members.delete(args[i]);
            removed++;
        }
    }

    if (removed > 0) ctx.store.markDirty(ctx.db, args[0]);
    if (zs.members.size === 0) ctx.store.deleteKey(ctx.db, args[0]);
    return encoder.integerReply(removed);
}

function cmdZscore(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('zscore');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.nullBulk();

    var score = zs.members.get(args[1]);
    if (score === undefined) return encoder.nullBulk();
    return encoder.encodeBulkString(String(score));
}

function cmdZrank(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('zrank');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.nullBulk();

    var idx = -1;
    for (var i = 0; i < zs.sorted.length; i++) {
        if (zs.sorted[i].member === args[1]) { idx = i; break; }
    }
    if (idx < 0) return encoder.nullBulk();
    return encoder.integerReply(idx);
}

function cmdZrevrank(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('zrevrank');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.nullBulk();

    var idx = -1;
    for (var i = 0; i < zs.sorted.length; i++) {
        if (zs.sorted[i].member === args[1]) { idx = i; break; }
    }
    if (idx < 0) return encoder.nullBulk();
    return encoder.integerReply(zs.sorted.length - 1 - idx);
}

function cmdZrange(args, ctx) {
    if (args.length < 3) return encoder.wrongArgCount('zrange');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs || zs.sorted.length === 0) return encoder.emptyArray();

    var start = validate.strictParseInt(args[1]);
    var stop = validate.strictParseInt(args[2]);
    if (start === null || stop === null) return encoder.encodeError('ERR value is not an integer or out of range');

    var withScores = false;
    var rev = false;

    for (var fi = 3; fi < args.length; fi++) {
        var flag = args[fi].toUpperCase();
        if (flag === 'WITHSCORES') withScores = true;
        else if (flag === 'REV') rev = true;
    }

    var arr = rev ? zs.sorted.slice().reverse() : zs.sorted;
    var len = arr.length;

    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    if (start > stop || start >= len) return encoder.emptyArray();

    stop = Math.min(stop, len - 1);
    var result = [];

    for (var i = start; i <= stop; i++) {
        result.push(arr[i].member);
        if (withScores) result.push(String(arr[i].score));
    }

    return encoder.encodeArray(result);
}

function cmdZrangebyscore(args, ctx) {
    if (args.length < 3) return encoder.wrongArgCount('zrangebyscore');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs || zs.sorted.length === 0) return encoder.emptyArray();

    var withScores = false;
    var offset = 0, count = -1;

    var minBound = parseScoreBound(args[1]);
    var maxBound = parseScoreBound(args[2]);
    if (!minBound || !maxBound) return encoder.encodeError('ERR min or max is not a float');

    for (var i = 3; i < args.length; i++) {
        var flag = args[i].toUpperCase();
        if (flag === 'WITHSCORES') withScores = true;
        else if (flag === 'LIMIT' && i + 2 < args.length) {
            offset = parseInt(args[++i], 10);
            count = parseInt(args[++i], 10);
        }
    }

    var result = [];
    var skipped = 0;
    var collected = 0;

    for (var si = 0; si < zs.sorted.length; si++) {
        var s = zs.sorted[si].score;
        var inRange = (minBound.exclusive ? s > minBound.val : s >= minBound.val) &&
                      (maxBound.exclusive ? s < maxBound.val : s <= maxBound.val);

        if (inRange) {
            if (skipped < offset) { skipped++; continue; }
            if (count >= 0 && collected >= count) break;
            result.push(zs.sorted[si].member);
            if (withScores) result.push(String(s));
            collected++;
        }
    }

    return encoder.encodeArray(result);
}

function cmdZcard(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('zcard');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var zs = ctx.store.get(ctx.db, args[0]);
    return encoder.integerReply(zs ? zs.members.size : 0);
}

function cmdZcount(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('zcount');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs) return encoder.integerReply(0);

    var minBound = parseScoreBound(args[1]);
    var maxBound = parseScoreBound(args[2]);
    if (!minBound || !maxBound) return encoder.encodeError('ERR min or max is not a float');

    var total = 0;
    for (var i = 0; i < zs.sorted.length; i++) {
        var s = zs.sorted[i].score;
        var inRange = (minBound.exclusive ? s > minBound.val : s >= minBound.val) &&
                      (maxBound.exclusive ? s < maxBound.val : s <= maxBound.val);
        if (inRange) total++;
    }

    return encoder.integerReply(total);
}

function cmdZincrby(args, ctx) {
    if (args.length !== 3) return encoder.wrongArgCount('zincrby');
    if (!ctx.store.checkType(ctx.db, args[0], TYPE_ZSET)) return encoder.wrongType();

    var increment = validate.strictParseFloat(args[1]);
    if (increment === null) return encoder.encodeError('ERR value is not a valid float');

    var key = args[0];
    var member = args[2];

    var zs = ctx.store.get(ctx.db, key);
    if (zs === undefined) zs = { members: new Map(), sorted: [] };

    var newScore;
    if (zs.members.has(member)) {
        var oldScore = zs.members.get(member);
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

    var zs = ctx.store.get(ctx.db, args[0]);
    if (!zs || zs.sorted.length === 0) return encoder.emptyArray();

    var start = validate.strictParseInt(args[1]);
    var stop = validate.strictParseInt(args[2]);
    if (start === null || stop === null) return encoder.encodeError('ERR value is not an integer or out of range');

    var withScores = args.length > 3 && args[3].toUpperCase() === 'WITHSCORES';

    var reversed = zs.sorted.slice().reverse();
    var len = reversed.length;

    if (start < 0) start = Math.max(0, len + start);
    if (stop < 0) stop = len + stop;
    if (start > stop || start >= len) return encoder.emptyArray();
    stop = Math.min(stop, len - 1);

    var result = [];
    for (var i = start; i <= stop; i++) {
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
