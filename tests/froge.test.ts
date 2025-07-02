import { before, after, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import froge from '../src';

describe('Froge', () => {
    let processExitOrig = process.exit;
    let exitCalled = false;

    before(() => {
        process.exit = (() => {
            exitCalled = true;
        }) as () => never;
    });

    after(() => {
        process.exit = processExitOrig;
    });

    beforeEach(() => {
        exitCalled = false;
    });

    it('services started and stopped in correct order', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = froge().configure({
            verbose: false,
        }).up({
            test1: () => new Promise<string>(resolve => setTimeout(() => {
                startSequence.push(1);
                resolve('test1');
            }, 50)),
            test2: () => {
                startSequence.push(2);
                return 'test2';
            },
        }).up({
            test3: ctx => {
                startSequence.push(3);
                return 'test3, dep ' + ctx.services.test1;
            },
            test4: () => {
                startSequence.push(4);
                return 'test4';
            },
        }).down({
            test1: service => { stopSequence.push(1); },
            test2: service => { stopSequence.push(2); },
            test3: service => { stopSequence.push(3); },
            test4: service => { stopSequence.push(4); },
        });

        // Can't access before started
        assert.throws(() => { console.log(server.services.test1); });

        await server.start();
        assert.deepEqual(startSequence, [2, 1, 3, 4]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2, 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');
        assert.equal(server.services.test4, 'test4');

        await server.stop();
        assert.deepEqual(stopSequence, [4, 3, 2, 1]);

        // Can't access after stopped
        assert.throws(() => { console.log(server.services.test1); });

        // And once again!

        await server.start();
        assert.deepEqual(startSequence, [2, 1, 3, 4, 2, 1, 3, 4]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2, 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');
        assert.equal(server.services.test4, 'test4');

        await server.stop();
        assert.deepEqual(stopSequence, [4, 3, 2, 1, 4, 3, 2, 1]);
    });

    it('services started and stopped sequentially', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = froge().configure({
            verbose: false,
            parallelStartGroups: false,
            parallelStopGroups: false,
        }).up({
            test1: () => new Promise<string>(resolve => setTimeout(() => {
                startSequence.push(1);
                resolve('test1');
            }, 50)),
            test2: () => {
                startSequence.push(2);
                return 'test2';
            },
        }).up({
            test3: ctx => {
                startSequence.push(3);
                return 'test3, dep ' + ctx.services.test1;
            },
            test4: () => {
                startSequence.push(4);
                return 'test4';
            },
        }).down({
            test1: service => { stopSequence.push(1); },
            test2: service => { stopSequence.push(2); },
            test3: service => { stopSequence.push(3); },
            test4: service => { stopSequence.push(4); },
        });

        await server.start();
        assert.deepEqual(startSequence, [1, 2, 3, 4]);

        await server.stop();
        assert.deepEqual(stopSequence, [4, 3, 2, 1]);
    });

    it('launch(): handles server lifecycle', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = await froge().configure({
            verbose: false,
            gracefulShutdownTimeoutMs: 999999,
        }).up({
            test1: () => { startSequence.push(1); return 'test1'; },
            test2: () => { startSequence.push(2); return 'test2'; }
        }).down({
            test1: () => { stopSequence.push(1); },
            test2: () => { stopSequence.push(2); },
        }).launch();
        assert.deepEqual(startSequence, [1, 2]);

        await server.shutdown();
        assert.deepEqual(stopSequence, [2, 1]);
        assert.equal(exitCalled, false);
    });

    it('launch(): handles failed start', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        await froge().configure({
            verbose: false,
            gracefulShutdownTimeoutMs: 999999,
        }).up({
            test1: () => { startSequence.push(1); return 'test1'; },
            test2: () => { startSequence.push(2); throw new Error('test2 failed'); }
        }).down({
            test1: () => { stopSequence.push(1); },
            test2: () => { stopSequence.push(2); },
        }).launch();
        assert.deepEqual(startSequence, [1, 2]);
        assert.deepEqual(stopSequence, [1]);
        assert.equal(exitCalled, false);
    });

    it('launch(): handles failed stop', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = await froge().configure({
            verbose: false,
            gracefulShutdownTimeoutMs: 999999,
        }).up({
            test1: () => { startSequence.push(1); return 'test1'; },
            test2: () => { startSequence.push(2); return 'test2'; }
        }).down({
            test1: () => { stopSequence.push(1); },
            test2: () => { stopSequence.push(2); throw new Error('test2 stop failed'); },
        }).launch();
        assert.deepEqual(startSequence, [1, 2]);

        try {
            await server.shutdown();
        } catch (e) {
            assert.equal(e, 'must not throw');
        }
        assert.deepEqual(stopSequence, [2, 1]);
        assert.equal(exitCalled, true);
        await new Promise(resolve => setTimeout(resolve, 50));
    });
});
