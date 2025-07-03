import { before, after, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import froge from '../src';

describe('Froge', () => {
    let processExitOrig = process.exit;
    let errorLogOrig = console.error;
    let exitCalled = false;
    let lastErrorLog: string|undefined;

    before(() => {
        process.exit = (() => {
            exitCalled = true;
        }) as () => never;
        console.error = (...logs: any[]) => {
            lastErrorLog = logs.join(' ');
        };
    });

    after(() => {
        process.exit = processExitOrig;
        console.error = errorLogOrig;
    });

    beforeEach(() => {
        exitCalled = false;
        lastErrorLog = undefined;
    });

    it('start(): services started and stopped in correct order', async () => {
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

        assert.equal(lastErrorLog, undefined);
    });

    it('only(): only requested services started', async () => {
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
        }).up({
            test5: () => 'test5',
        }).down({
            test1: service => { stopSequence.push(1); },
            test2: service => { stopSequence.push(2); },
            test3: service => { stopSequence.push(3); },
            test4: service => { stopSequence.push(4); },
            test5: service => { stopSequence.push(5); },
        });

        const test3 = await server.only('test3');
        assert.equal(test3, 'test3, dep test1');

        assert.deepEqual(startSequence, [2, 1, 3]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2, 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');

        await server.stop();
        assert.deepEqual(stopSequence, [3, 2, 1]);

        assert.equal(lastErrorLog, undefined);
    });

    it('start(): services started and stopped sequentially', async () => {
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

        assert.equal(lastErrorLog, undefined);
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

        assert.equal(lastErrorLog, undefined);
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

        assert.match(lastErrorLog ?? '', /Failed to start:  Error: test2 failed/);
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

        assert.match(lastErrorLog ?? '', /Shutdown incomplete, killing... Reason: Error: test2 stop failed/);
    });

    it('shutdown(): handles timeout', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = await froge().configure({
            verbose: false,
            gracefulShutdownTimeoutMs: 20,
        }).up({
            test1: () => { startSequence.push(1); return 'test1'; },
            test2: () => { startSequence.push(2); return 'test2'; }
        }).down({
            test1: async () => { stopSequence.push(1); await new Promise(resolve => setTimeout(resolve, 50)); },
            test2: () => { stopSequence.push(2); },
        }).launch();
        assert.deepEqual(startSequence, [1, 2]);

        try {
            await server.shutdown();
        } catch (e) {
            assert.equal(e, 'must not throw');
        }
        assert.equal(exitCalled, true);

        assert.equal(lastErrorLog, 'Reached shutdown timeout 20ms, killing...');
    });
});
