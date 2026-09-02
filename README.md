# RedisGen

A fully functional, zero-dependency, Redis-compatible in-memory data store built from scratch in Node.js.

## Overview

RedisGen implements the RESP2 protocol and supports over 90+ standard Redis commands across all major data structures (Strings, Lists, Hashes, Sets, Sorted Sets). It can be used as a drop-in replacement for basic Redis caching and pub/sub needs.

## Features

- **No External Dependencies**: Pure Node.js standard library implementation.
- **RESP2 Protocol Support**: Works perfectly with standard `redis-cli`, `ioredis`, `node-redis`, and other standard clients.
- **Data Structures**: 
  - Strings
  - Lists
  - Hashes
  - Sets
  - Sorted Sets (with binary search indexing)
- **Advanced Features**:
  - Pub/Sub (Channels and Pattern matching)
  - Transactions (`MULTI`, `EXEC`, `DISCARD`, `WATCH`, `UNWATCH`)
  - Expiry Engine (TTL with active probabilistic sweep and lazy evaluation)
  - LRU Eviction (`volatile-lru`, `allkeys-lru`)
  - Multiple Logical Databases (`SELECT`, `SWAPDB`)
- **Persistence**:
  - RDB (Snapshotting)
  - AOF (Append-Only File with tunable fsync policies)

## Quick Start

### Running the Server

Start the server using Node.js:

```bash
npm start
```

By default, the server listens on `127.0.0.1:6379`.

### Command Line Options

```bash
node src/server.js --port 6380 --appendonly yes --loglevel debug
```

### Connecting with a Client

Use the standard `redis-cli`:

```bash
redis-cli -p 6379
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> SET hello world
OK
127.0.0.1:6379> GET hello
"world"
```

## Testing

Run the comprehensive test suite (111 tests covering protocol, persistence, engine, and integration):

```bash
npm test
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
