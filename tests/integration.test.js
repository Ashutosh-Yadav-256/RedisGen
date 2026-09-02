'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { RedisGenServer } = require('../src/server');

let server;
let serverPort = 16379;

function startServer(port) {
    return new Promise((resolve) => {
        server = new RedisGenServer({ port: port, bind: '127.0.0.1', loglevel: 'warning' });
        server.start();
        setTimeout(resolve, 200);
    });
}

function stopServer() {
    if (server) {
        server.stop();
        server = null;
    }
}

function sendCommand(port, ...cmds) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ port: port, host: '127.0.0.1' }, () => {
            let resp = '';

            client.on('data', (chunk) => {
                resp += chunk.toString();
            });

            let encoded = '';
            for (const cmd of cmds) {
                const parts = cmd.split(' ');
                encoded += '*' + parts.length + '\r\n';
                for (const part of parts) {
                    encoded += '$' + Buffer.byteLength(part) + '\r\n' + part + '\r\n';
                }
            }

            client.write(encoded);

            setTimeout(() => {
                client.end();
                resolve(resp);
            }, 100);
        });

        client.on('error', reject);
    });
}

describe('Integration Tests', () => {
    afterEach(() => {
        stopServer();
    });

    it('server starts and responds to PING', async () => {
        const port = serverPort++;
        await startServer(port);

        const resp = await sendCommand(port, 'PING');
        assert.ok(resp.includes('PONG'));
    });

    it('SET and GET through TCP', async () => {
        const port = serverPort++;
        await startServer(port);

        const resp = await sendCommand(port, 'SET testkey testval', 'GET testkey');
        assert.ok(resp.includes('OK'));
        assert.ok(resp.includes('testval'));
    });

    it('handles multiple clients concurrently', async () => {
        const port = serverPort++;
        await startServer(port);

        const p1 = sendCommand(port, 'SET c1key c1val');
        const p2 = sendCommand(port, 'SET c2key c2val');
        const p3 = sendCommand(port, 'PING');

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        assert.ok(r1.includes('OK'));
        assert.ok(r2.includes('OK'));
        assert.ok(r3.includes('PONG'));
    });

    it('returns error for unknown command', async () => {
        const port = serverPort++;
        await startServer(port);

        const resp = await sendCommand(port, 'FOOBAR arg1');
        assert.ok(resp.includes('ERR'));
        assert.ok(resp.includes('unknown command'));
    });

    it('ECHO returns the message', async () => {
        const port = serverPort++;
        await startServer(port);

        const resp = await sendCommand(port, 'ECHO hello');
        assert.ok(resp.includes('hello'));
    });

    it('DBSIZE tracks key count', async () => {
        const port = serverPort++;
        await startServer(port);

        await sendCommand(port, 'SET a 1', 'SET b 2', 'SET c 3');

        const resp = await sendCommand(port, 'DBSIZE');
        assert.ok(resp.includes(':3'));
    });

    it('INFO returns server info', async () => {
        const port = serverPort++;
        await startServer(port);

        const resp = await sendCommand(port, 'INFO');
        assert.ok(resp.includes('redis_version'));
        assert.ok(resp.includes('redisgen'));
    });

    it('DEL removes keys', async () => {
        const port = serverPort++;
        await startServer(port);

        await sendCommand(port, 'SET delme val');
        const r1 = await sendCommand(port, 'DEL delme');
        assert.ok(r1.includes(':1'));

        const r2 = await sendCommand(port, 'GET delme');
        assert.ok(r2.includes('$-1'));
    });
});
