'use strict';

var crypto = require('crypto');
var encoder = require('../protocol/encoder');

function timingSafeEqual(a, b) {
    var bufA = Buffer.from(String(a));
    var bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function cmdAuth(args, ctx) {
    if (args.length !== 1) return encoder.wrongArgCount('auth');

    var pass = ctx.config.get('requirepass');

    if (!pass || pass.length === 0) {
        return encoder.encodeError('ERR Client sent AUTH, but no password is set');
    }

    if (timingSafeEqual(args[0], pass)) {
        ctx.connection.authenticated = true;
        return encoder.ok();
    }

    return encoder.encodeError('WRONGPASS invalid username-password pair or user is disabled');
}

module.exports = {
    auth: cmdAuth
};
