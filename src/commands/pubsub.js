'use strict';

const encoder = require('../protocol/encoder');
const { globMatch } = require('../utils/glob');

class PubSubBroker {
    constructor() {
        this._channels = new Map();
        this._patterns = new Map();
    }

    subscribe(connection, channel) {
        if (!this._channels.has(channel)) {
            this._channels.set(channel, new Set());
        }
        this._channels.get(channel).add(connection);

        if (!connection.subscriptions) connection.subscriptions = new Set();
        connection.subscriptions.add(channel);

        const count = connection.subscriptions.size +
            (connection.patternSubs ? connection.patternSubs.size : 0);

        return encoder.encodeArray(['subscribe', channel, count]);
    }

    unsubscribe(connection, channel) {
        if (channel) {
            const subs = this._channels.get(channel);
            if (subs) {
                subs.delete(connection);
                if (subs.size === 0) this._channels.delete(channel);
            }
            if (connection.subscriptions) {
                connection.subscriptions.delete(channel);
            }
        }

        const count = (connection.subscriptions ? connection.subscriptions.size : 0) +
            (connection.patternSubs ? connection.patternSubs.size : 0);

        return encoder.encodeArray(['unsubscribe', channel || null, count]);
    }

    unsubscribeAll(connection) {
        const responses = [];

        if (connection.subscriptions && connection.subscriptions.size > 0) {
            const channels = Array.from(connection.subscriptions);
            for (const ch of channels) {
                responses.push(this.unsubscribe(connection, ch));
            }
        } else {
            responses.push(encoder.encodeArray(['unsubscribe', null, 0]));
        }

        return responses;
    }

    psubscribe(connection, pattern) {
        if (!this._patterns.has(pattern)) {
            this._patterns.set(pattern, new Set());
        }
        this._patterns.get(pattern).add(connection);

        if (!connection.patternSubs) connection.patternSubs = new Set();
        connection.patternSubs.add(pattern);

        const count = (connection.subscriptions ? connection.subscriptions.size : 0) +
            connection.patternSubs.size;

        return encoder.encodeArray(['psubscribe', pattern, count]);
    }

    punsubscribe(connection, pattern) {
        if (pattern) {
            const subs = this._patterns.get(pattern);
            if (subs) {
                subs.delete(connection);
                if (subs.size === 0) this._patterns.delete(pattern);
            }
            if (connection.patternSubs) {
                connection.patternSubs.delete(pattern);
            }
        }

        const count = (connection.subscriptions ? connection.subscriptions.size : 0) +
            (connection.patternSubs ? connection.patternSubs.size : 0);

        return encoder.encodeArray(['punsubscribe', pattern || null, count]);
    }

    punsubscribeAll(connection) {
        const responses = [];

        if (connection.patternSubs && connection.patternSubs.size > 0) {
            const patterns = Array.from(connection.patternSubs);
            for (const p of patterns) {
                responses.push(this.punsubscribe(connection, p));
            }
        } else {
            responses.push(encoder.encodeArray(['punsubscribe', null, 0]));
        }

        return responses;
    }

    publish(channel, message) {
        let delivered = 0;

        const directSubs = this._channels.get(channel);
        if (directSubs) {
            const msg = encoder.encodeArray(['message', channel, message]);
            for (const conn of directSubs) {
                conn.write(msg);
                delivered++;
            }
        }

        for (const [pattern, subs] of this._patterns) {
            if (globMatch(pattern, channel)) {
                const msg = encoder.encodeArray(['pmessage', pattern, channel, message]);
                for (const conn of subs) {
                    conn.write(msg);
                    delivered++;
                }
            }
        }

        return delivered;
    }

    removeConnection(connection) {
        if (connection.subscriptions) {
            for (const ch of connection.subscriptions) {
                const subs = this._channels.get(ch);
                if (subs) {
                    subs.delete(connection);
                    if (subs.size === 0) this._channels.delete(ch);
                }
            }
            connection.subscriptions.clear();
        }

        if (connection.patternSubs) {
            for (const p of connection.patternSubs) {
                const subs = this._patterns.get(p);
                if (subs) {
                    subs.delete(connection);
                    if (subs.size === 0) this._patterns.delete(p);
                }
            }
            connection.patternSubs.clear();
        }
    }
}

function cmdSubscribe(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('subscribe');

    const responses = [];
    for (let i = 0; i < args.length; i++) {
        responses.push(ctx.pubsub.subscribe(ctx.connection, args[i]));
    }

    return responses.join('');
}

function cmdUnsubscribe(args, ctx) {
    if (args.length === 0) {
        return ctx.pubsub.unsubscribeAll(ctx.connection).join('');
    }

    const responses = [];
    for (let i = 0; i < args.length; i++) {
        responses.push(ctx.pubsub.unsubscribe(ctx.connection, args[i]));
    }

    return responses.join('');
}

function cmdPsubscribe(args, ctx) {
    if (args.length < 1) return encoder.wrongArgCount('psubscribe');

    const responses = [];
    for (let i = 0; i < args.length; i++) {
        responses.push(ctx.pubsub.psubscribe(ctx.connection, args[i]));
    }

    return responses.join('');
}

function cmdPunsubscribe(args, ctx) {
    if (args.length === 0) {
        return ctx.pubsub.punsubscribeAll(ctx.connection).join('');
    }

    const responses = [];
    for (let i = 0; i < args.length; i++) {
        responses.push(ctx.pubsub.punsubscribe(ctx.connection, args[i]));
    }

    return responses.join('');
}

function cmdPublish(args, ctx) {
    if (args.length !== 2) return encoder.wrongArgCount('publish');

    const delivered = ctx.pubsub.publish(args[0], args[1]);
    return encoder.integerReply(delivered);
}

module.exports = {
    PubSubBroker,
    subscribe: cmdSubscribe,
    unsubscribe: cmdUnsubscribe,
    psubscribe: cmdPsubscribe,
    punsubscribe: cmdPunsubscribe,
    publish: cmdPublish
};
