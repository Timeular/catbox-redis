'use strict';

// Load modules

const Redis = require('ioredis');
const Hoek = require('hoek');


// Declare internals

const internals = {};


internals.defaults = {
    host: '127.0.0.1',
    port: 6379
};


exports = module.exports = internals.Connection = function (options) {

    Hoek.assert(this.constructor === internals.Connection, 'Redis cache client must be instantiated using new');

    this.settings = Object.assign({}, internals.defaults, options);
    this.client = options.client || null;
    return this;
};


internals.Connection.prototype.start = function (callback) {

    callback = Hoek.once(callback);

    const self = this;
    if (this.client) {
        return Hoek.nextTick(callback)();
    }

    let client;

    const options = {
        password: this.settings.password,
        db: this.settings.database || this.settings.db
    };

    if (this.settings.url) {
        client = Redis.createClient(this.settings.url, options);
    }
    else if (this.settings.socket) {
        client = Redis.createClient(this.settings.socket, options);
    }
    else {
        client = Redis.createClient(this.settings.port, this.settings.host, options);
    }

    // Listen to errors

    client.on('error', (err) => {

        if (!self.client) {                             // Failed to connect
            client.end(false);
            return callback(err);
        }
    });

    // Wait for connection

    client.once('ready', () => {

        self.client = client;
        return callback();
    });
};


internals.Connection.prototype.stop = function () {

    if (this.client) {
        this.client.removeAllListeners();
        this.client.quit();
        this.client = null;
    }
};


internals.Connection.prototype.isReady = function () {

    return !!this.client;
};


internals.Connection.prototype.validateSegmentName = function (name) {

    if (!name) {
        return new Error('Empty string');
    }

    if (name.indexOf('\0') !== -1) {
        return new Error('Includes null character');
    }

    return null;
};


internals.Connection.prototype.get = function (key, callback) {
    if (!this.client) {
        return callback(new Error('Connection not started'));
    }

    this.client.get(this.generateKey(key), (err, result) => {

        if (err) {
            return callback(err);
        }

        if (!result) {
            return callback(null, null);
        }
        let parsed = result;
        try {
            parsed = JSON.parse(result);
        } catch (err) { }

        const cached = {
            item: parsed,
            ttl: 1000,
            stored: Date.now(),
        };
        return callback(null, cached);
    });
};


internals.Connection.prototype.set = function (key, value, ttl, callback) {
    const self = this;

    if (!this.client) {
        return callback(new Error('Connection not started'));
    }

    const cacheKey = this.generateKey(key);

    let stringifiedValue = value;
    if (typeof value !== 'string') {
        try {
            stringifiedValue = JSON.stringify(value);
        } catch (err) {
            return callback(err);
        }
    }

    this.client.set(cacheKey, stringifiedValue, (err) => {

        if (err) {
            return callback(err);
        }

        const ttlSec = Math.max(1, Math.floor(ttl / 1000));
        self.client.expire(cacheKey, ttlSec, (err) => {        // Use 'pexpire' with ttl in Redis 2.6.0

            return callback(err);
        });
    });
};


internals.Connection.prototype.drop = function (key, callback) {
    if (!this.client) {
        return callback(new Error('Connection not started'));
    }

    this.client.del(this.generateKey(key), (err) => {

        return callback(err);
    });
};


internals.Connection.prototype.generateKey = function (key) {

    const parts = [];

    if (this.settings.partition) {
        parts.push(encodeURIComponent(this.settings.partition));
    }

    parts.push(encodeURIComponent(key.segment));
    parts.push(encodeURIComponent(key.id));

    return parts.join(':');
};

