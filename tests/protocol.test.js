'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { RespParser } = require('../src/protocol/parser');
const encoder = require('../src/protocol/encoder');

describe('RESP Parser', () => {
    it('parses simple string', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('+OK\r\n'));
        const results = parser.parse();
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0], 'OK');
    });

    it('parses error', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('-ERR unknown\r\n'));
        const results = parser.parse();
        assert.strictEqual(results.length, 1);
        assert.ok(results[0] instanceof Error);
        assert.strictEqual(results[0].message, 'ERR unknown');
    });

    it('parses integer', () => {
        const parser = new RespParser();
        parser.append(Buffer.from(':42\r\n'));
        const results = parser.parse();
        assert.strictEqual(results[0], 42);
    });

    it('parses negative integer', () => {
        const parser = new RespParser();
        parser.append(Buffer.from(':-7\r\n'));
        const results = parser.parse();
        assert.strictEqual(results[0], -7);
    });

    it('parses bulk string', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('$5\r\nhello\r\n'));
        const results = parser.parse();
        assert.strictEqual(results[0], 'hello');
    });

    it('parses null bulk string', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('$-1\r\n'));
        const results = parser.parse();
        assert.strictEqual(results[0], null);
    });

    it('parses empty bulk string', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('$0\r\n\r\n'));
        const results = parser.parse();
        assert.strictEqual(results[0], '');
    });

    it('parses array', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n'));
        const results = parser.parse();
        assert.deepStrictEqual(results[0], ['foo', 'bar']);
    });

    it('parses null array', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('*-1\r\n'));
        const results = parser.parse();
        assert.strictEqual(results[0], null);
    });

    it('parses empty array', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('*0\r\n'));
        const results = parser.parse();
        assert.deepStrictEqual(results[0], []);
    });

    it('handles partial data across chunks', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('$5\r\nhel'));
        const r1 = parser.parse();
        assert.strictEqual(r1.length, 0);

        parser.append(Buffer.from('lo\r\n'));
        const r2 = parser.parse();
        assert.strictEqual(r2[0], 'hello');
    });

    it('parses multiple commands in one chunk', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('+OK\r\n:100\r\n'));
        const results = parser.parse();
        assert.strictEqual(results.length, 2);
        assert.strictEqual(results[0], 'OK');
        assert.strictEqual(results[1], 100);
    });

    it('parses inline command', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('PING\r\n'));
        const results = parser.parse();
        assert.deepStrictEqual(results[0], ['PING']);
    });

    it('parses inline command with arguments', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('SET mykey myval\r\n'));
        const results = parser.parse();
        assert.deepStrictEqual(results[0], ['SET', 'mykey', 'myval']);
    });

    it('parses nested array', () => {
        const parser = new RespParser();
        parser.append(Buffer.from('*2\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n$1\r\nc\r\n'));
        const results = parser.parse();
        assert.deepStrictEqual(results[0], [['a', 'b'], 'c']);
    });
});

describe('RESP Encoder', () => {
    it('encodes simple string', () => {
        assert.strictEqual(encoder.encodeSimpleString('OK'), '+OK\r\n');
    });

    it('encodes error', () => {
        assert.strictEqual(encoder.encodeError('ERR bad'), '-ERR bad\r\n');
    });

    it('encodes integer', () => {
        assert.strictEqual(encoder.encodeInteger(42), ':42\r\n');
    });

    it('encodes bulk string', () => {
        assert.strictEqual(encoder.encodeBulkString('hello'), '$5\r\nhello\r\n');
    });

    it('encodes null bulk string', () => {
        assert.strictEqual(encoder.encodeBulkString(null), '$-1\r\n');
    });

    it('encodes array', () => {
        const result = encoder.encodeArray(['foo', 'bar']);
        assert.strictEqual(result, '*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n');
    });

    it('encodes array with null element', () => {
        const result = encoder.encodeArray(['a', null, 'b']);
        assert.ok(result.includes('$-1\r\n'));
    });

    it('encodes array with integers', () => {
        const result = encoder.encodeArray([1, 2, 3]);
        assert.ok(result.startsWith('*3\r\n'));
        assert.ok(result.includes(':1\r\n'));
    });

    it('ok returns +OK', () => {
        assert.strictEqual(encoder.ok(), '+OK\r\n');
    });

    it('pong returns +PONG', () => {
        assert.strictEqual(encoder.pong(), '+PONG\r\n');
    });

    it('wrongArgCount includes command name', () => {
        const result = encoder.wrongArgCount('get');
        assert.ok(result.includes('get'));
        assert.ok(result.startsWith('-'));
    });
});
