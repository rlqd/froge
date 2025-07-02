import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envs } from '../src';

function tempPath(name: string): string {
    return path.join(os.tmpdir(), `env-wrapper-test-${name}-${Date.now()}`);
}

describe('Envs', () => {
    it('string(): returns env var when set', () => {
        process.env.TEST_STRING = 'hello';
        assert.equal(envs.TEST_STRING.string(), 'hello');
        delete process.env.TEST_STRING;
    });

    it('s(): works as an alias of string()', () => {
        process.env.TEST_STRING = 'hello';
        assert.equal(envs.TEST_STRING.s(), 'hello');
        delete process.env.TEST_STRING;
    });

    it('string(): returns default when unset', () => {
        delete process.env.TEST_STRING;
        assert.equal(envs.TEST_STRING.string('def'), 'def');
    });

    it('string(): throws when unset and no default', () => {
        delete process.env.TEST_STRING;
        assert.throws(
            () => envs.TEST_STRING.string(),
            { message: 'Env var "TEST_STRING" is not set' }
        );
    });

    it('string(): throws when empty', () => {
        process.env.TEST_STRING = '';
        assert.throws(
            () => envs.TEST_STRING.string(),
            { message: 'Env var "TEST_STRING" is empty' }
        );
        delete process.env.TEST_STRING;
    });

    it('string(): allows empty when configured', () => {
        process.env.TEST_STRING = '';
        assert.equal(envs.TEST_STRING.string(undefined, {nonEmpty: false}), '');
        delete process.env.TEST_STRING;
    });

    it('match(): returns first match on regex', () => {
        process.env.TEST_MATCH = 'foo123bar';
        assert.equal(envs.TEST_MATCH.match(/\d+/), '123');
        delete process.env.TEST_MATCH;
    });

    it('match(): throws when no match', () => {
        process.env.TEST_MATCH = 'foobar';
        assert.throws(
            () => envs.TEST_MATCH.match(/\d+/),
            { message: `Env var "TEST_MATCH" doesn't match expected format /\\d+/` }
        );
        delete process.env.TEST_MATCH;
    });

    it('path(): returns raw path when no checks', () => {
        process.env.TEST_PATH = '/some/path';
        assert.equal(envs.TEST_PATH.path(), '/some/path');
        delete process.env.TEST_PATH;
    });

    it('path(): exist=true throws on non-existent path', () => {
        const p = tempPath('noexist');
        process.env.TEST_PATH = p;
        assert.throws(
            () => envs.TEST_PATH.path(undefined, { exist: true }),
            { message: `Env var "TEST_PATH" path doesn't exist` }
        );
        delete process.env.TEST_PATH;
    });

    it('path(): exist=true accepts real file and dir', () => {
        // File
        const f = tempPath('file.txt');
        fs.writeFileSync(f, 'x');
        process.env.TEST_PATH = f;
        assert.equal(envs.TEST_PATH.path(undefined, { exist: true }), f);
        fs.unlinkSync(f);

        // Directory
        const d = tempPath('dir');
        fs.mkdirSync(d);
        process.env.TEST_PATH = d;
        assert.equal(envs.TEST_PATH.path(undefined, { exist: true }), d);
        fs.rmdirSync(d);

        delete process.env.TEST_PATH;
    });

    it('url(): parses valid URL', () => {
        process.env.TEST_URL = 'https://example.com/foo';
        const u = envs.TEST_URL.url();
        assert.ok(u instanceof URL);
        assert.equal(u.hostname, 'example.com');
        delete process.env.TEST_URL;
    });

    it('url(): throws on invalid URL', () => {
        process.env.TEST_URL = 'notaurl';
        assert.throws(() => envs.TEST_URL.url());
        delete process.env.TEST_URL;
    });

    it('ip(): accepts valid IP', () => {
        process.env.TEST_IP = '127.0.0.1';
        assert.equal(envs.TEST_IP.ip(), '127.0.0.1');
    });

    it('ip(): rejects invalid IP', () => {
        process.env.TEST_IP = 'foo';
        assert.throws(
            () => envs.TEST_IP.ip(),
            { message: 'Env var "TEST_IP" is not a valid IP address' }
        );
        delete process.env.TEST_IP;
    });

    it('ipv4(): only accepts v4', () => {
        process.env.TEST_IP = '127.0.0.1';
        assert.equal(envs.TEST_IP.ipv4(), '127.0.0.1');
        process.env.TEST_IP = '::1';
        assert.throws(
            () => envs.TEST_IP.ipv4(),
            { message: 'Env var "TEST_IP" is not a valid IPv4 address' }
        );
        delete process.env.TEST_IP;
    });

    it('ipv6(): only accepts v6', () => {
        process.env.TEST_IP = '::1';
        assert.equal(envs.TEST_IP.ipv6(), '::1');
        process.env.TEST_IP = '127.0.0.1';
        assert.throws(
            () => envs.TEST_IP.ipv6(),
            { message: 'Env var "TEST_IP" is not a valid IPv6 address' }
        );
        delete process.env.TEST_IP;
    });

    it('number(): parses number', () => {
        process.env.TEST_NUM = '42';
        assert.equal(envs.TEST_NUM.number(), 42);
    });

    it('number(): uses default', () => {
        delete process.env.TEST_NUM;
        assert.equal(envs.TEST_NUM.number(7), 7);
    });

    it('number(): throws on invalid number', () => {
        process.env.TEST_NUM = 'foo';
        assert.throws(
            () => envs.TEST_NUM.number(),
            { message: 'Env var "TEST_NUM" is not a valid number' }
        );
        delete process.env.TEST_NUM;
    });

    it('number(): enforces min and max', () => {
        process.env.TEST_NUM = '10';
        assert.throws(
            () => envs.TEST_NUM.number(undefined, { min: 20 }),
            { message: 'Env var "TEST_NUM" value is too small (<20)' }
        );
        assert.throws(
            () => envs.TEST_NUM.number(undefined, { max: 5 }),
            { message: 'Env var "TEST_NUM" value is too large (>5)' }
        );
        delete process.env.TEST_NUM;
    });

    it('int(): parses integer', () => {
        process.env.TEST_INT = '5';
        assert.equal(envs.TEST_INT.int(), 5);
    });

    it('int(): rejects non-integer strict', () => {
        process.env.TEST_INT = '5.5';
        assert.throws(
            () => envs.TEST_INT.int(),
            { message: 'Env var "TEST_INT" is not a valid integer' }
        );
    });

    it('int(): accepts non-integer non-strict', () => {
        process.env.TEST_INT = '5.5';
        assert.equal(envs.TEST_INT.int(undefined, { strict: false }), 5);
        delete process.env.TEST_INT;
    });

    it('port(): accepts valid port', () => {
        process.env.TEST_PORT = '3000';
        assert.equal(envs.TEST_PORT.port(), 3000);
    });

    it('port(): rejects out-of-range port', () => {
        process.env.TEST_PORT = '70000';
        assert.throws(
            () => envs.TEST_PORT.port(),
            { message: 'Env var "TEST_PORT" is not a valid port number' }
        );
        process.env.TEST_PORT = '-1';
        assert.throws(
            () => envs.TEST_PORT.port(),
            { message: 'Env var "TEST_PORT" is not a valid port number' }
        );
        delete process.env.TEST_PORT;
    });

    it('bool(): parses strict booleans', () => {
        process.env.TEST_BOOL = 'true';
        assert.equal(envs.TEST_BOOL.bool(), true);
        process.env.TEST_BOOL = 'FALSE';
        assert.equal(envs.TEST_BOOL.bool(), false);
    });

    it('bool(): rejects non-strict values in strict mode', () => {
        process.env.TEST_BOOL = 'yes';
        assert.throws(
            () => envs.TEST_BOOL.bool(undefined, { strict: true }),
            { message: 'Env var "TEST_BOOL" is not a valid boolean' }
        );
    });

    it('bool(): accepts extended values in non-strict mode', () => {
        process.env.TEST_BOOL = 'yes';
        assert.equal(envs.TEST_BOOL.bool(undefined, { strict: false }), true);
        process.env.TEST_BOOL = 'N';
        assert.equal(envs.TEST_BOOL.bool(undefined, { strict: false }), false);
    });

    it('bool(): uses default when unset', () => {
        delete process.env.TEST_BOOL;
        assert.equal(envs.TEST_BOOL.bool(true), true);
        assert.equal(envs.TEST_BOOL.bool(false), false);
    });

    it('bool(): uses a custom map', () => {
        process.env.TEST_BOOL = 'on';
        const map = { on: true, off: false };
        assert.equal(envs.TEST_BOOL.bool(undefined, { map }), true);
        delete process.env.TEST_BOOL;
    });
});
