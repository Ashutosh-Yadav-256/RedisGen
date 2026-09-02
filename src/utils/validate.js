'use strict';

var INT_MAX = 9007199254740991;
var INT_MIN = -9007199254740991;

function strictParseInt(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    if (!/^-?\d+$/.test(str)) return null;
    var val = Number(str);
    if (val > INT_MAX || val < INT_MIN) return null;
    return val;
}

function strictParseFloat(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    if (str === 'inf' || str === '+inf') return Infinity;
    if (str === '-inf') return -Infinity;
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(str)) return null;
    var val = Number(str);
    if (isNaN(val)) return null;
    return val;
}

module.exports = { strictParseInt, strictParseFloat, INT_MAX, INT_MIN };
