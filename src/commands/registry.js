'use strict';

const stringCmds = require('./strings');
const keyCmds = require('./keys');
const listCmds = require('./lists');
const hashCmds = require('./hashes');
const setCmds = require('./sets');
const zsetCmds = require('./sorted_sets');
const serverCmds = require('./server_cmds');
const pubsubCmds = require('./pubsub');
const txCmds = require('./transaction');
const authCmds = require('./auth');
const encoder = require('../protocol/encoder');

const TABLE = {};

function reg(name, handler, flags) {
    TABLE[name.toLowerCase()] = { handler, flags: flags || '' };
}

reg('set', stringCmds.set, 'w');
reg('get', stringCmds.get, 'r');
reg('mget', stringCmds.mget, 'r');
reg('mset', stringCmds.mset, 'w');
reg('setnx', stringCmds.setnx, 'w');
reg('getdel', stringCmds.getdel, 'w');
reg('incr', stringCmds.incr, 'w');
reg('decr', stringCmds.decr, 'w');
reg('incrby', stringCmds.incrby, 'w');
reg('decrby', stringCmds.decrby, 'w');
reg('incrbyfloat', stringCmds.incrbyfloat, 'w');
reg('append', stringCmds.append, 'w');
reg('strlen', stringCmds.strlen, 'r');
reg('getrange', stringCmds.getrange, 'r');

reg('del', keyCmds.del, 'w');
reg('unlink', keyCmds.unlink, 'w');
reg('exists', keyCmds.exists, 'r');
reg('keys', keyCmds.keys, 'r');
reg('type', keyCmds.type, 'r');
reg('expire', keyCmds.expire, 'w');
reg('pexpire', keyCmds.pexpire, 'w');
reg('expireat', keyCmds.expireat, 'w');
reg('pexpireat', keyCmds.pexpireat, 'w');
reg('ttl', keyCmds.ttl, 'r');
reg('pttl', keyCmds.pttl, 'r');
reg('persist', keyCmds.persist, 'w');
reg('rename', keyCmds.rename, 'w');
reg('renamenx', keyCmds.renamenx, 'w');
reg('randomkey', keyCmds.randomkey, 'r');
reg('scan', keyCmds.scan, 'r');
reg('object', keyCmds.object, 'r');

reg('lpush', listCmds.lpush, 'w');
reg('rpush', listCmds.rpush, 'w');
reg('lpop', listCmds.lpop, 'w');
reg('rpop', listCmds.rpop, 'w');
reg('llen', listCmds.llen, 'r');
reg('lrange', listCmds.lrange, 'r');
reg('lindex', listCmds.lindex, 'r');
reg('lset', listCmds.lset, 'w');
reg('lrem', listCmds.lrem, 'w');
reg('lpos', listCmds.lpos, 'r');

reg('hset', hashCmds.hset, 'w');
reg('hget', hashCmds.hget, 'r');
reg('hdel', hashCmds.hdel, 'w');
reg('hgetall', hashCmds.hgetall, 'r');
reg('hmset', hashCmds.hmset, 'w');
reg('hmget', hashCmds.hmget, 'r');
reg('hexists', hashCmds.hexists, 'r');
reg('hlen', hashCmds.hlen, 'r');
reg('hkeys', hashCmds.hkeys, 'r');
reg('hvals', hashCmds.hvals, 'r');
reg('hincrby', hashCmds.hincrby, 'w');
reg('hincrbyfloat', hashCmds.hincrbyfloat, 'w');
reg('hsetnx', hashCmds.hsetnx, 'w');

reg('sadd', setCmds.sadd, 'w');
reg('srem', setCmds.srem, 'w');
reg('smembers', setCmds.smembers, 'r');
reg('sismember', setCmds.sismember, 'r');
reg('smismember', setCmds.smismember, 'r');
reg('scard', setCmds.scard, 'r');
reg('sunion', setCmds.sunion, 'r');
reg('sinter', setCmds.sinter, 'r');
reg('sdiff', setCmds.sdiff, 'r');
reg('srandmember', setCmds.srandmember, 'r');
reg('spop', setCmds.spop, 'w');

reg('zadd', zsetCmds.zadd, 'w');
reg('zrem', zsetCmds.zrem, 'w');
reg('zscore', zsetCmds.zscore, 'r');
reg('zrank', zsetCmds.zrank, 'r');
reg('zrevrank', zsetCmds.zrevrank, 'r');
reg('zrange', zsetCmds.zrange, 'r');
reg('zrevrange', zsetCmds.zrevrange, 'r');
reg('zrangebyscore', zsetCmds.zrangebyscore, 'r');
reg('zcard', zsetCmds.zcard, 'r');
reg('zcount', zsetCmds.zcount, 'r');
reg('zincrby', zsetCmds.zincrby, 'w');

reg('ping', serverCmds.ping, 'r');
reg('echo', serverCmds.echo, 'r');
reg('dbsize', serverCmds.dbsize, 'r');
reg('flushdb', serverCmds.flushdb, 'w');
reg('flushall', serverCmds.flushall, 'w');
reg('select', serverCmds.select, 'r');
reg('swapdb', serverCmds.swapdb, 'w');
reg('time', serverCmds.time, 'r');
reg('info', serverCmds.info, 'r');
reg('command', serverCmds.command, 'r');
reg('config', serverCmds.config, 'r');
reg('client', serverCmds.client, 'r');
reg('quit', serverCmds.quit, 'r');
reg('reset', serverCmds.reset, 'r');
reg('hello', serverCmds.hello, 'r');

reg('subscribe', pubsubCmds.subscribe, 'p');
reg('unsubscribe', pubsubCmds.unsubscribe, 'p');
reg('psubscribe', pubsubCmds.psubscribe, 'p');
reg('punsubscribe', pubsubCmds.punsubscribe, 'p');
reg('publish', pubsubCmds.publish, 'p');

reg('multi', txCmds.multi, 't');
reg('exec', txCmds.exec, 't');
reg('discard', txCmds.discard, 't');
reg('watch', txCmds.watch, 't');
reg('unwatch', txCmds.unwatch, 't');

reg('auth', authCmds.auth, 'r');

const TX_PASSTHROUGH = new Set(['exec', 'discard', 'multi', 'watch']);

function dispatch(cmdParts, ctx) {
    if (!cmdParts || cmdParts.length === 0) return null;

    const cmdName = cmdParts[0].toLowerCase();
    const cmdArgs = cmdParts.slice(1);

    const entry = TABLE[cmdName];
    if (!entry) {
        return encoder.unknownCommand(cmdName, cmdArgs);
    }

    if (ctx.connection.txQueue && !TX_PASSTHROUGH.has(cmdName)) {
        ctx.connection.txQueue.push({
            handler: entry.handler,
            cmdArgs: cmdArgs,
            cmdCtx: Object.assign({}, ctx, { db: ctx.connection.db || 0 }),
            rawParts: cmdParts
        });
        return encoder.queued();
    }

    return entry.handler(cmdArgs, ctx);
}

function commandCount() {
    return Object.keys(TABLE).length;
}

function isWriteCommand(cmdName) {
    const entry = TABLE[cmdName.toLowerCase()];
    return entry && entry.flags.indexOf('w') >= 0;
}

module.exports = { dispatch, commandCount, isWriteCommand, TABLE };
