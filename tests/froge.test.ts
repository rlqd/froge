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

    it('ctx.plug(): overrides plug with service', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = froge().configure({
            verbose: false,
        }).up({
            test1: () => new Promise<string>(resolve => setTimeout(() => {
                startSequence.push(1);
                resolve('test1');
            }, 50)),
            test2: ctx => ctx.plug<string>(),
        }).up({
            test2: ctx => {
                startSequence.push(2);
                return () => 'test2';
            },
            test3: ctx => {
                startSequence.push(3);
                return 'test3, dep ' + ctx.services.test1;
            },
            test4: ctx => {
                startSequence.push(4);
                return {
                    value: 'test4',
                    foo: () => ctx.services.test2(),
                };
            },
        }).down({
            test1: service => { stopSequence.push(1); },
            test2: service => { stopSequence.push(2); },
            test3: service => { stopSequence.push(3); },
            test4: service => { stopSequence.push(4); },
        });

        assert.equal(false, server.services.test2.isReady);
        await server.start();
        assert.equal(true, server.services.test2.isReady);

        assert.deepEqual(startSequence, [1, 2, 3, 4]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2(), 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');
        assert.equal(server.services.test4.value, 'test4');
        assert.equal(server.services.test4.foo(), 'test2');

        await server.stop();
        assert.deepEqual(stopSequence, [4, 3, 2, 1]);
    });

    it('ctx.plug(): plug overriden after referenced', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = froge().configure({
            verbose: false,
        }).up({
            test1: () => new Promise<string>(resolve => setTimeout(() => {
                startSequence.push(1);
                resolve('test1');
            }, 50)),
            test2: ctx => ctx.plug<string>(),
        }).up({
            test3: ctx => {
                startSequence.push(3);
                return 'test3, dep ' + ctx.services.test1;
            },
            test4: ctx => {
                startSequence.push(4);
                function createTest4(test2: () => string) {
                    return {
                        value: 'test4',
                        foo: () => test2(),
                    };
                }
                return createTest4(ctx.services.test2);
            },
        }).up({
            test2: () => {
                startSequence.push(2);
                return () => 'test2';
            },
        }).down({
            test1: service => { stopSequence.push(1); },
            test2: service => { stopSequence.push(2); },
            test3: service => { stopSequence.push(3); },
            test4: service => { stopSequence.push(4); },
        });

        assert.equal(false, server.services.test2.isReady);
        await server.start();
        assert.equal(true, server.services.test2.isReady);

        assert.deepEqual(startSequence, [1, 3, 4, 2]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2(), 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');
        assert.equal(server.services.test4.value, 'test4');
        assert.equal(server.services.test4.foo(), 'test2');

        await server.stop();
        assert.deepEqual(stopSequence, [2, 4, 3, 1]);
    });

    it('ctx.plug(): can not access plug', async () => {
        const server = froge().configure({
            verbose: false,
        }).up({
            test: ctx => ctx.plug<string>(),
        });

        await server.start();
        assert.ok(!server.services.test.isReady);
        assert.throws(() => { console.log(server.services.test()); });
    });

    it('up(): trying to override existing service', async () => {
        try {
            froge().up({
                test: () => 'test',
            }).up({
                test: () => 'test2',
            } as any);
            assert.fail('must throw');
        } catch (e: any) {
            assert.ok(e.message.startsWith('Trying to override existing service test'));
        }
    });

    it('up(): trying to override existing group', async () => {
        try {
            froge().up({
                test: () => 'test',
            }, 'alpha').up({
                test2: () => 'test2',
            }, 'alpha');
            assert.fail('must throw');
        } catch (e: any) {
            assert.equal(e.message, 'Group with key alpha already exists, trying to add new group with the same name (test2)');
        }
    });

    it('use(): imports services from other instance', async () => {
        const other = froge().up({
            test: ctx => 'test',
        });

        const server = froge()
            .configure({
                verbose: false,
            })
            .up({
                something: ctx => 'something',
            })
            .use(other)
            .up({
                test2: ctx => ({
                    getTest: () => ctx.services.test,
                }),
            });

        await server.start();

        assert.equal(server.services.something, 'something');
        assert.equal(server.services.test, 'test');
        assert.equal(server.services.test2.getTest(), 'test');
    });

    it('use(): trying to override existing service', async () => {
        try {
            froge().up({
                test: () => 'test',
            }).use(
                froge().up({
                    test: () => 'test2',
                }) as any
            );
            assert.fail('must throw');
        } catch (e: any) {
            assert.equal(e.message, 'Trying to override existing service test by a service from another instance');
        }
    });

    it('use(): trying to override existing group', async () => {
        try {
            froge().up({
                test: () => 'test',
            }, 'alpha').use(
                froge().up({
                    test2: () => 'test2',
                }, 'alpha')
            );
            assert.fail('must throw');
        } catch (e: any) {
            assert.equal(e.message, 'Trying to override existing group alpha by a group from another instance (test2)');
        }
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

    it('launch(): exits when requested', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const server = await froge().configure({
            verbose: false,
            gracefulShutdownTimeoutMs: 999999,
            forceExitAfterShutdown: true,
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
        assert.equal(exitCalled, true);

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
