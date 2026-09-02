'use strict';

const CRLF = '\r\n';
const CR = 0x0d;
const LF = 0x0a;

class RespParser {
    constructor() {
        this._buffer = Buffer.alloc(0);
    }

    append(chunk) {
        this._buffer = Buffer.concat([this._buffer, chunk]);
    }

    parse() {
        const results = [];
        let parsed;

        while (this._buffer.length > 0) {
            parsed = this._tryParse();
            if (parsed === null) {
                break;
            }
            results.push(parsed.value);
            this._buffer = this._buffer.slice(parsed.consumed);
        }

        return results;
    }

    _tryParse() {
        if (this._buffer.length === 0) return null;

        const type = this._buffer[0];

        switch (type) {
            case 0x2b: return this._parseSimpleString();
            case 0x2d: return this._parseError();
            case 0x3a: return this._parseInteger();
            case 0x24: return this._parseBulkString();
            case 0x2a: return this._parseArray();
            default:   return this._parseInline();
        }
    }

    _findCRLF(offset) {
        for (let i = offset; i < this._buffer.length - 1; i++) {
            if (this._buffer[i] === CR && this._buffer[i + 1] === LF) {
                return i;
            }
        }
        return -1;
    }

    _parseSimpleString() {
        const end = this._findCRLF(1);
        if (end < 0) return null;
        const str = this._buffer.toString('utf8', 1, end);
        return { value: str, consumed: end + 2 };
    }

    _parseError() {
        const end = this._findCRLF(1);
        if (end < 0) return null;
        const msg = this._buffer.toString('utf8', 1, end);
        return { value: new Error(msg), consumed: end + 2 };
    }

    _parseInteger() {
        const end = this._findCRLF(1);
        if (end < 0) return null;
        const num = parseInt(this._buffer.toString('utf8', 1, end), 10);
        return { value: num, consumed: end + 2 };
    }

    _parseBulkString() {
        const lenEnd = this._findCRLF(1);
        if (lenEnd < 0) return null;

        const len = parseInt(this._buffer.toString('utf8', 1, lenEnd), 10);

        if (len === -1) {
            return { value: null, consumed: lenEnd + 2 };
        }

        const dataStart = lenEnd + 2;
        const dataEnd = dataStart + len;

        if (this._buffer.length < dataEnd + 2) return null;

        const str = this._buffer.toString('utf8', dataStart, dataEnd);
        return { value: str, consumed: dataEnd + 2 };
    }

    _parseArray() {
        const lenEnd = this._findCRLF(1);
        if (lenEnd < 0) return null;

        const count = parseInt(this._buffer.toString('utf8', 1, lenEnd), 10);

        if (count === -1) {
            return { value: null, consumed: lenEnd + 2 };
        }

        if (count === 0) {
            return { value: [], consumed: lenEnd + 2 };
        }

        const saved = this._buffer;
        this._buffer = this._buffer.slice(lenEnd + 2);
        let totalConsumed = lenEnd + 2;

        const elements = [];
        for (let i = 0; i < count; i++) {
            const element = this._tryParse();
            if (element === null) {
                this._buffer = saved;
                return null;
            }
            elements.push(element.value);
            this._buffer = this._buffer.slice(element.consumed);
            totalConsumed += element.consumed;
        }

        this._buffer = saved;
        return { value: elements, consumed: totalConsumed };
    }

    _parseInline() {
        const end = this._findCRLF(0);
        if (end < 0) {
            if (this._buffer.indexOf(0x0a) >= 0) {
                const nlPos = this._buffer.indexOf(0x0a);
                const line = this._buffer.toString('utf8', 0, nlPos).trim();
                if (line.length === 0) {
                    return { value: [], consumed: nlPos + 1 };
                }
                return { value: this._splitInline(line), consumed: nlPos + 1 };
            }
            return null;
        }

        const line = this._buffer.toString('utf8', 0, end).trim();
        if (line.length === 0) {
            return { value: [], consumed: end + 2 };
        }
        return { value: this._splitInline(line), consumed: end + 2 };
    }

    _splitInline(line) {
        const parts = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];

            if (inQuote) {
                if (ch === quoteChar) {
                    inQuote = false;
                } else if (ch === '\\' && i + 1 < line.length) {
                    i++;
                    current += line[i];
                } else {
                    current += ch;
                }
            } else if (ch === '"' || ch === "'") {
                inQuote = true;
                quoteChar = ch;
            } else if (ch === ' ' || ch === '\t') {
                if (current.length > 0) {
                    parts.push(current);
                    current = '';
                }
            } else {
                current += ch;
            }
        }

        if (current.length > 0) {
            parts.push(current);
        }

        return parts;
    }

    reset() {
        this._buffer = Buffer.alloc(0);
    }

    get pending() {
        return this._buffer.length;
    }
}

module.exports = { RespParser };
