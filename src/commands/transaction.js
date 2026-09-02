'use strict';

const encoder = require('../protocol/encoder');

function cmdMulti(args, ctx) {
    if (ctx.connection.txQueue) {
        return encoder.encodeError('ERR MULTI calls can not be nested');
    }
    ctx.connection.txQueue = [];
    return encoder.ok();
}

function cmdExec(args, ctx) {
    if (!ctx.connection.txQueue) {
        return encoder.encodeError('ERR EXEC without MULTI');
    }

    if (ctx.store.isWatchDirty(ctx.connection.id)) {
        ctx.connection.txQueue = null;
        ctx.store.unwatchAll(ctx.connection.id);
        return encoder.nullArray();
    }

    const queue = ctx.connection.txQueue;
    ctx.connection.txQueue = null;
    ctx.store.unwatchAll(ctx.connection.id);

    if (queue.length === 0) {
        return encoder.emptyArray();
    }

    const results = [];
    for (let i = 0; i < queue.length; i++) {
        const { handler, cmdArgs, cmdCtx } = queue[i];
        const response = handler(cmdArgs, cmdCtx);
        results.push(response);
    }

    return '*' + results.length + '\r\n' + results.join('');
}

function cmdDiscard(args, ctx) {
    if (!ctx.connection.txQueue) {
        return encoder.encodeError('ERR DISCARD without MULTI');
    }
    ctx.connection.txQueue = null;
    ctx.store.unwatchAll(ctx.connection.id);
    return encoder.ok();
}

function cmdWatch(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('watch');

    if (ctx.connection.txQueue) {
        return encoder.encodeError('ERR WATCH inside MULTI is not allowed');
    }

    for (let i = 0; i < args.length; i++) {
        ctx.store.watchKey(ctx.connection.id, ctx.db, args[i]);
    }

    return encoder.ok();
}

function cmdUnwatch(args, ctx) {
    ctx.store.unwatchAll(ctx.connection.id);
    return encoder.ok();
}

module.exports = {
    multi: cmdMulti,
    exec: cmdExec,
    discard: cmdDiscard,
    watch: cmdWatch,
    unwatch: cmdUnwatch
};
