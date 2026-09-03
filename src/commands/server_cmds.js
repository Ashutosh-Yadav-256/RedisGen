'use strict';

const encoder = require('../protocol/encoder');

function cmdPing(args, ctx) {
    if (args.length > 1) return encoder.wrongArgCount('ping');
    if (args.length === 1) return encoder.encodeBulkString(args[0]);
    return encoder.pong();
}

function cmdEcho(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('echo');
    return encoder.encodeBulkString(args[0]);
}

function cmdDbsize(args, ctx) {
    return encoder.integerReply(ctx.store.dbSize(ctx.db));
}

function cmdFlushdb(args, ctx) {
    ctx.store.flushDb(ctx.db);
    return encoder.ok();
}

function cmdFlushall(args, ctx) {
    ctx.store.flushAll();
    return encoder.ok();
}

function cmdSelect(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('select');

    const idx = parseInt(args[0], 10);
    if (isNaN(idx) || idx < 0 || idx >= ctx.store.dbCount) {
        return encoder.encodeError('ERR DB index is out of range');
    }

    ctx.connection.db = idx;
    return encoder.ok();
}

function cmdSwapdb(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('swapdb');

    const a = parseInt(args[0], 10);
    const b = parseInt(args[1], 10);

    if (isNaN(a) || isNaN(b) || !ctx.store.swapDb(a, b)) {
        return encoder.encodeError('ERR invalid DB index');
    }

    return encoder.ok();
}

function cmdTime(args, ctx) {
    const now = Date.now();
    const seconds = Math.floor(now / 1000);
    const micros = (now % 1000) * 1000;
    return encoder.encodeArray([String(seconds), String(micros)]);
}

function cmdInfo(args, ctx) {
    const sections = [];

    sections.push('# Server');
    sections.push('redis_version:7.0.0-redisgen');
    sections.push('redis_mode:standalone');
    sections.push('process_id:' + process.pid);
    sections.push('uptime_in_seconds:' + Math.floor(process.uptime()));
    sections.push('tcp_port:' + (ctx.config ? ctx.config.get('port') : 6379));
    sections.push('');

    sections.push('# Clients');
    sections.push('connected_clients:' + (ctx.clientCount || 0));
    sections.push('');

    sections.push('# Memory');
    const mem = process.memoryUsage();
    sections.push('used_memory:' + mem.heapUsed);
    sections.push('used_memory_human:' + formatBytes(mem.heapUsed));
    sections.push('used_memory_rss:' + mem.rss);
    sections.push('used_memory_peak:' + mem.heapTotal);
    sections.push('');

    sections.push('# Stats');
    sections.push('');

    sections.push('# Keyspace');
    for (let i = 0; i < ctx.store.dbCount; i++) {
        const size = ctx.store.dbSize(i);
        if (size > 0) {
            sections.push('db' + i + ':keys=' + size + ',expires=0,avg_ttl=0');
        }
    }

    return encoder.encodeBulkString(sections.join('\r\n'));
}

function cmdCommand(args, ctx) {
    if (args.length === 0) {
        return encoder.encodeArray([]);
    }

    const sub = args[0].toUpperCase();

    if (sub === 'DOCS') {
        return encoder.emptyArray();
    }

    if (sub === 'COUNT') {
        const registry = require('./registry');
        return encoder.integerReply(registry.commandCount());
    }

    if (sub === 'INFO') {
        return encoder.emptyArray();
    }

    return encoder.ok();
}

function cmdConfig(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('config');

    const sub = args[0].toUpperCase();

    if (sub === 'GET') {
        if (args.length !== 2) return encoder.wrongArgCount('config|get');
        if (!ctx.config) return encoder.emptyArray();

        const pattern = args[1].toLowerCase();
        const all = ctx.config.all();
        const result = [];

        for (const key in all) {
            if (pattern === '*' || pattern === key) {
                result.push(key);
                const val = all[key];
                if (Array.isArray(val)) {
                    result.push(JSON.stringify(val));
                } else {
                    result.push(String(val));
                }
            }
        }

        return encoder.encodeArray(result);
    }

    if (sub === 'SET') {
        if (args.length !== 3) return encoder.wrongArgCount('config|set');
        if (!ctx.config) return encoder.encodeError('ERR config not available');

        const key = args[1].toLowerCase();
        let value = args[2];

        if (key === 'hz' || key === 'databases' || key === 'maxmemory' || key === 'timeout' || key === 'tcp_backlog') {
            value = parseInt(value, 10);
            if (isNaN(value)) return encoder.encodeError('ERR Invalid argument for CONFIG SET');
        } else if (key === 'appendonly') {
            value = value.toLowerCase() === 'yes';
        }

        if (!ctx.config.set(key, value)) {
            return encoder.encodeError("ERR Unsupported CONFIG parameter: " + args[1]);
        }

        return encoder.ok();
    }

    if (sub === 'RESETSTAT') {
        return encoder.ok();
    }

    return encoder.encodeError("ERR Unknown subcommand or wrong number of arguments for 'config|" + sub.toLowerCase() + "'");
}



function cmdClient(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('client');

    const sub = args[0].toUpperCase();

    if (sub === 'SETNAME') {
        if (args.length !== 2) return encoder.wrongArgCount('client|setname');
        ctx.connection.name = args[1];
        return encoder.ok();
    }

    if (sub === 'GETNAME') {
        if (ctx.connection.name) {
            return encoder.encodeBulkString(ctx.connection.name);
        }
        return encoder.nullBulk();
    }

    if (sub === 'ID') {
        return encoder.integerReply(ctx.connection.id || 0);
    }

    if (sub === 'LIST') {
        return encoder.encodeBulkString('');
    }

    if (sub === 'INFO') {
        return encoder.encodeBulkString('id=' + (ctx.connection.id || 0) + ' fd=0 name=' + (ctx.connection.name || ''));
    }

    return encoder.ok();
}

function cmdQuit(args, ctx) {
    ctx.connection.closing = true;
    return encoder.ok();
}

function cmdReset(args, ctx) {
    ctx.connection.db = 0;
    ctx.connection.name = null;
    ctx.connection.flags = 0;
    ctx.connection.txQueue = null;
    ctx.connection.subscriptions = null;
    ctx.store.unwatchAll(ctx.connection.id);
    return encoder.encodeSimpleString('RESET');
}

function cmdHello(args, ctx) {
    const proto = args.length > 0 ? parseInt(args[0], 10) : 2;

    if (proto !== 2 && proto !== 3) {
        return encoder.encodeError('NOPROTO unsupported protocol version');
    }

    const result = [
        'server', 'redisgen',
        'version', '7.0.0',
        'proto', String(proto),
        'id', String(ctx.connection.id || 0),
        'mode', 'standalone',
        'role', 'master',
        'modules', []
    ];

    return encoder.encodeArray(result);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(2) + 'K';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + 'M';
    return (bytes / 1073741824).toFixed(2) + 'G';
}

module.exports = {
    ping: cmdPing,
    echo: cmdEcho,
    dbsize: cmdDbsize,
    flushdb: cmdFlushdb,
    flushall: cmdFlushall,
    select: cmdSelect,
    swapdb: cmdSwapdb,
    time: cmdTime,
    info: cmdInfo,
    command: cmdCommand,
    config: cmdConfig,
    client: cmdClient,
    quit: cmdQuit,
    reset: cmdReset,
    hello: cmdHello
};
