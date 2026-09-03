'use strict';

var http = require('http');
var crypto = require('crypto');
var registry = require('./commands/registry');
var encoder = require('./protocol/encoder');

var WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function WebSocketBridge(redisServer) {
    this._redis = redisServer;
    this._httpServer = null;
    this._clients = new Set();
    this._nextId = 1;
}

WebSocketBridge.prototype.start = function (port, bind) {
    var self = this;

    this._httpServer = http.createServer(function (req, res) {
        self._handleHttp(req, res);
    });

    this._httpServer.on('upgrade', function (req, socket, head) {
        self._handleUpgrade(req, socket, head);
    });

    this._httpServer.listen(port, bind, function () {
        self._redis.log.info('WebSocket bridge listening on port ' + port);
    });
};

WebSocketBridge.prototype.stop = function () {
    for (var c of this._clients) {
        try { c.socket.destroy(); } catch (e) {}
    }
    this._clients.clear();

    if (this._httpServer) {
        this._httpServer.close();
        this._httpServer = null;
    }
};

WebSocketBridge.prototype._handleHttp = function (req, res) {
    var origin = req.headers['origin'] || '*';

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }

    var corsHeaders = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (req.url === '/health') {
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsHeaders));
        res.end(JSON.stringify({ status: 'ok', uptime: Math.floor(process.uptime()) }));
        return;
    }

    if (req.url === '/stats') {
        var mem = process.memoryUsage();
        var dbStats = [];
        for (var i = 0; i < this._redis.store.dbCount; i++) {
            var size = this._redis.store.dbSize(i);
            if (size > 0) dbStats.push({ db: i, keys: size });
        }

        var stats = {
            uptime_seconds: Math.floor(process.uptime()),
            connected_clients: this._redis.clientCount + this._clients.size,
            used_memory: mem.heapUsed,
            used_memory_human: formatBytes(mem.heapUsed),
            used_memory_rss: mem.rss,
            total_keys: dbStats.reduce(function (s, d) { return s + d.keys; }, 0),
            databases: dbStats,
            node_version: process.version
        };

        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, corsHeaders));
        res.end(JSON.stringify(stats));
        return;
    }

    res.writeHead(404, corsHeaders);
    res.end('Not Found');
};

WebSocketBridge.prototype._handleUpgrade = function (req, socket, head) {
    var key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    var accept = crypto.createHash('sha1')
        .update(key + WS_MAGIC)
        .digest('base64');

    var responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + accept
    ];

    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

    var client = {
        id: this._nextId++,
        socket: socket,
        authenticated: false,
        db: 0,
        txQueue: null,
        name: null,
        buffer: Buffer.alloc(0)
    };

    this._clients.add(client);
    this._redis.log.info('WS client connected (id=' + client.id + ')');

    var self = this;

    socket.on('data', function (data) {
        self._onWsData(client, data);
    });

    socket.on('close', function () {
        self._clients.delete(client);
        self._redis.store.unwatchAll(client.id + 100000);
        self._redis.log.info('WS client disconnected (id=' + client.id + ')');
    });

    socket.on('error', function () {
        self._clients.delete(client);
    });
};

WebSocketBridge.prototype._onWsData = function (client, raw) {
    client.buffer = Buffer.concat([client.buffer, raw]);

    while (client.buffer.length >= 2) {
        var frame = this._decodeFrame(client.buffer);
        if (!frame) break;

        client.buffer = client.buffer.slice(frame.totalLength);

        if (frame.opcode === 0x08) {
            client.socket.destroy();
            return;
        }

        if (frame.opcode === 0x09) {
            this._sendFrame(client.socket, frame.payload, 0x0A);
            continue;
        }

        if (frame.opcode === 0x01) {
            var text = frame.payload.toString('utf8');
            this._handleMessage(client, text);
        }
    }
};

WebSocketBridge.prototype._decodeFrame = function (buf) {
    if (buf.length < 2) return null;

    var firstByte = buf[0];
    var secondByte = buf[1];
    var opcode = firstByte & 0x0F;
    var masked = (secondByte & 0x80) !== 0;
    var payloadLength = secondByte & 0x7F;
    var offset = 2;

    if (payloadLength === 126) {
        if (buf.length < 4) return null;
        payloadLength = buf.readUInt16BE(2);
        offset = 4;
    } else if (payloadLength === 127) {
        if (buf.length < 10) return null;
        payloadLength = Number(buf.readBigUInt64BE(2));
        offset = 10;
    }

    var maskOffset = offset;
    if (masked) offset += 4;

    if (buf.length < offset + payloadLength) return null;

    var payload = buf.slice(offset, offset + payloadLength);

    if (masked) {
        var mask = buf.slice(maskOffset, maskOffset + 4);
        for (var i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i % 4];
        }
    }

    return {
        opcode: opcode,
        payload: payload,
        totalLength: offset + payloadLength
    };
};

WebSocketBridge.prototype._sendFrame = function (socket, data, opcode) {
    if (socket.destroyed) return;

    var payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    var frame;

    if (payload.length < 126) {
        frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x80 | (opcode || 0x01);
        frame[1] = payload.length;
        payload.copy(frame, 2);
    } else if (payload.length < 65536) {
        frame = Buffer.alloc(4 + payload.length);
        frame[0] = 0x80 | (opcode || 0x01);
        frame[1] = 126;
        frame.writeUInt16BE(payload.length, 2);
        payload.copy(frame, 4);
    } else {
        frame = Buffer.alloc(10 + payload.length);
        frame[0] = 0x80 | (opcode || 0x01);
        frame[1] = 127;
        frame.writeBigUInt64BE(BigInt(payload.length), 2);
        payload.copy(frame, 10);
    }

    socket.write(frame);
};

WebSocketBridge.prototype._handleMessage = function (client, text) {
    var msg;
    try {
        msg = JSON.parse(text);
    } catch (e) {
        this._sendJson(client, { error: 'invalid JSON' });
        return;
    }

    if (!msg.command || !Array.isArray(msg.command) || msg.command.length === 0) {
        this._sendJson(client, { error: 'missing command array' });
        return;
    }

    var cmdParts = msg.command.map(function (p) { return String(p); });
    var cmdName = cmdParts[0].toLowerCase();

    var requirepass = this._redis.config.get('requirepass');
    if (requirepass && requirepass.length > 0 && !client.authenticated) {
        if (cmdName !== 'auth' && cmdName !== 'ping' && cmdName !== 'quit') {
            this._sendJson(client, { error: 'NOAUTH Authentication required.' });
            return;
        }
    }

    var ctx = {
        db: client.db,
        store: this._redis.store,
        config: this._redis.config,
        connection: client,
        pubsub: this._redis.pubsub,
        clientCount: this._redis.clientCount + this._clients.size,
        aofBuffer: null
    };

    var response = registry.dispatch(cmdParts, ctx);

    if (cmdName === 'select' && response && response.indexOf('+OK') >= 0) {
        client.db = parseInt(cmdParts[1], 10) || 0;
    }

    var parsed = this._parseResp(response || '');

    if (this._redis.aof) {
        if (ctx.aofBuffer && ctx.aofBuffer.length > 0) {
            for (var j = 0; j < ctx.aofBuffer.length; j++) {
                this._redis.aof.appendCommand(ctx.aofBuffer[j]);
            }
        } else if (registry.isWriteCommand(cmdName)) {
            this._redis.aof.appendCommand(cmdParts);
        }
    }

    this._sendJson(client, { id: msg.id || null, result: parsed });
};

WebSocketBridge.prototype._parseResp = function (raw) {
    if (!raw || raw.length === 0) return null;

    var firstChar = raw[0];

    if (firstChar === '+') {
        return raw.substring(1, raw.indexOf('\r\n'));
    }

    if (firstChar === '-') {
        return { error: raw.substring(1, raw.indexOf('\r\n')) };
    }

    if (firstChar === ':') {
        return parseInt(raw.substring(1, raw.indexOf('\r\n')), 10);
    }

    if (firstChar === '$') {
        var lenEnd = raw.indexOf('\r\n');
        var len = parseInt(raw.substring(1, lenEnd), 10);
        if (len === -1) return null;
        return raw.substring(lenEnd + 2, lenEnd + 2 + len);
    }

    if (firstChar === '*') {
        var countEnd = raw.indexOf('\r\n');
        var count = parseInt(raw.substring(1, countEnd), 10);
        if (count === -1) return null;
        if (count === 0) return [];

        var items = [];
        var pos = countEnd + 2;

        for (var i = 0; i < count; i++) {
            var c = raw[pos];
            if (c === '$') {
                var bEnd = raw.indexOf('\r\n', pos);
                var bLen = parseInt(raw.substring(pos + 1, bEnd), 10);
                if (bLen === -1) {
                    items.push(null);
                    pos = bEnd + 2;
                } else {
                    items.push(raw.substring(bEnd + 2, bEnd + 2 + bLen));
                    pos = bEnd + 2 + bLen + 2;
                }
            } else if (c === ':') {
                var iEnd = raw.indexOf('\r\n', pos);
                items.push(parseInt(raw.substring(pos + 1, iEnd), 10));
                pos = iEnd + 2;
            } else if (c === '+') {
                var sEnd = raw.indexOf('\r\n', pos);
                items.push(raw.substring(pos + 1, sEnd));
                pos = sEnd + 2;
            } else if (c === '-') {
                var eEnd = raw.indexOf('\r\n', pos);
                items.push({ error: raw.substring(pos + 1, eEnd) });
                pos = eEnd + 2;
            } else {
                break;
            }
        }

        return items;
    }

    return raw;
};

WebSocketBridge.prototype._sendJson = function (client, obj) {
    this._sendFrame(client.socket, JSON.stringify(obj), 0x01);
};

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(2) + 'K';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + 'M';
    return (bytes / 1073741824).toFixed(2) + 'G';
}

module.exports = { WebSocketBridge: WebSocketBridge };
