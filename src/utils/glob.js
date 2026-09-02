'use strict';

function globMatch(pattern, str) {
    let pi = 0;
    let si = 0;
    let starPi = -1;
    let starSi = -1;

    while (si < str.length) {
        if (pi < pattern.length && pattern[pi] === '\\' && pi + 1 < pattern.length) {
            pi++;
            if (str[si] === pattern[pi]) {
                pi++;
                si++;
            } else {
                if (starPi >= 0) {
                    pi = starPi + 1;
                    starSi++;
                    si = starSi;
                } else {
                    return false;
                }
            }
        } else if (pi < pattern.length && pattern[pi] === '*') {
            starPi = pi;
            starSi = si;
            pi++;
        } else if (pi < pattern.length && pattern[pi] === '?') {
            pi++;
            si++;
        } else if (pi < pattern.length && pattern[pi] === '[') {
            pi++;
            let negate = false;
            if (pi < pattern.length && pattern[pi] === '^') {
                negate = true;
                pi++;
            }
            let matched = false;
            let bracketEnd = false;
            while (pi < pattern.length && !bracketEnd) {
                if (pattern[pi] === ']') {
                    bracketEnd = true;
                    break;
                }
                let lo = pattern[pi];
                let hi = lo;
                pi++;
                if (pi < pattern.length && pattern[pi] === '-' && pi + 1 < pattern.length && pattern[pi + 1] !== ']') {
                    pi++;
                    hi = pattern[pi];
                    pi++;
                }
                if (str[si] >= lo && str[si] <= hi) {
                    matched = true;
                }
            }
            if (!bracketEnd) {
                return false;
            }
            pi++;
            if (negate ? matched : !matched) {
                if (starPi >= 0) {
                    pi = starPi + 1;
                    starSi++;
                    si = starSi;
                } else {
                    return false;
                }
            } else {
                si++;
            }
        } else if (pi < pattern.length && pattern[pi] === str[si]) {
            pi++;
            si++;
        } else {
            if (starPi >= 0) {
                pi = starPi + 1;
                starSi++;
                si = starSi;
            } else {
                return false;
            }
        }
    }

    while (pi < pattern.length && pattern[pi] === '*') {
        pi++;
    }

    return pi === pattern.length;
}

module.exports = { globMatch };
