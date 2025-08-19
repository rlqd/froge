import { before, after, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import froge from '../src';
import createExampleServer from './samples/example-server';

describe('Froge (using plugins)', () => {
    let errorLogOrig = console.error;
    let lastErrorLog: string|undefined;

    before(() => {
        console.error = (...logs: any[]) => {
            lastErrorLog = logs.join(' ');
        };
    });

    after(() => {
        console.error = errorLogOrig;
    });

    beforeEach(() => {
        lastErrorLog = undefined;
    });

    it('start(): services started and stopped in correct order', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const plugin = froge().up({
            pluginService1: () => {
                startSequence.push(11);
                return 'pluginService1';
            },
        }).up({
            pluginService2: () => {
                startSequence.push(12);
                return 'pluginService2';
            },
        }).down({
            pluginService1: () => { stopSequence.push(11); },
            pluginService2: () => { stopSequence.push(12); },
        });

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
        })
        .use(plugin)
        .up({
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
        assert.throws(() => { console.log(server.services.pluginService1); });

        await server.start();
        assert.deepEqual(startSequence, [2, 1, 11, 12, 3, 4]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2, 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');
        assert.equal(server.services.test4, 'test4');
        assert.equal(server.services.pluginService1, 'pluginService1');
        assert.equal(server.services.pluginService2, 'pluginService2');

        await server.stop();
        assert.deepEqual(stopSequence, [4, 3, 12, 11, 2, 1]);

        // Can't access after stopped
        assert.throws(() => { console.log(server.services.test1); });
        assert.throws(() => { console.log(server.services.pluginService1); });

        // And once again!

        await server.start();
        assert.deepEqual(startSequence, [2, 1, 11, 12, 3, 4, 2, 1, 11, 12, 3, 4]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2, 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');
        assert.equal(server.services.test4, 'test4');

        await server.stop();
        assert.deepEqual(stopSequence, [4, 3, 12, 11, 2, 1, 4, 3, 12, 11, 2, 1]);

        assert.equal(lastErrorLog, undefined);
    });

    
    it('start(): server is composed of plugins', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const plugin = froge().up({
            pluginService1: () => {
                startSequence.push(11);
                return 'pluginService1';
            },
        }).up({
            pluginService2: () => {
                startSequence.push(12);
                return 'pluginService2';
            },
        }).down({
            pluginService1: () => { stopSequence.push(11); },
            pluginService2: () => { stopSequence.push(12); },
        });

        const plugin2 = froge().up({
            pluginService3: () => {
                startSequence.push(13);
                return 'pluginService3';
            },
        }).up({
            pluginService4: () => {
                startSequence.push(14);
                return 'pluginService4';
            },
        }).down({
            pluginService3: () => { stopSequence.push(13); },
            pluginService4: () => { stopSequence.push(14); },
        });

        const server = froge().configure({
            verbose: false,
        })
        .use(plugin)
        .use(plugin2);

        // Can't access before started
        assert.throws(() => { console.log(server.services.pluginService1); });
        assert.throws(() => { console.log(server.services.pluginService3); });

        await server.start();
        assert.deepEqual(startSequence, [11, 12, 13, 14]);
        assert.equal(server.services.pluginService1, 'pluginService1');
        assert.equal(server.services.pluginService2, 'pluginService2');
        assert.equal(server.services.pluginService3, 'pluginService3');
        assert.equal(server.services.pluginService4, 'pluginService4');

        await server.stop();
        assert.deepEqual(stopSequence, [14, 13, 12, 11]);

        // Can't access after stopped
        assert.throws(() => { console.log(server.services.pluginService1); });
        assert.throws(() => { console.log(server.services.pluginService3); });
    });

    it('only(): only requested services started', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const plugin = froge().up({
            pluginService1: () => {
                startSequence.push(11);
                return 'pluginService1';
            },
        }).up({
            pluginService2: () => {
                startSequence.push(12);
                return 'pluginService2';
            },
        }).down({
            pluginService1: () => { stopSequence.push(11); },
            pluginService2: () => { stopSequence.push(12); },
        });

        const plugin2 = froge().up({
            pluginService3: () => {
                startSequence.push(13);
                return 'pluginService3';
            },
        }).up({
            pluginService4: () => {
                startSequence.push(14);
                return 'pluginService4';
            },
        }).down({
            pluginService3: () => { stopSequence.push(13); },
            pluginService4: () => { stopSequence.push(14); },
        });

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
        })
        .use(plugin)
        .up({
            test3: ctx => {
                startSequence.push(3);
                return 'test3, dep ' + ctx.services.test1;
            },
            test4: () => {
                startSequence.push(4);
                return 'test4';
            },
        })
        .use(plugin2)
        .up({
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

        assert.deepEqual(startSequence, [2, 1, 11, 12, 3]);
        assert.equal(server.services.test1, 'test1');
        assert.equal(server.services.test2, 'test2');
        assert.equal(server.services.test3, 'test3, dep test1');

        await server.stop();
        assert.deepEqual(stopSequence, [3, 12, 11, 2, 1]);

        assert.equal(lastErrorLog, undefined);
    });

    it('start(): services started and stopped sequentially', async () => {
        const startSequence: number[] = [];
        const stopSequence: number[] = [];

        const plugin = froge().up({
            pluginService1: () => {
                startSequence.push(11);
                return 'pluginService1';
            },
        }).up({
            pluginService2: () => {
                startSequence.push(12);
                return 'pluginService2';
            },
        }).down({
            pluginService1: () => { stopSequence.push(11); },
            pluginService2: () => { stopSequence.push(12); },
        });

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
        }).use(plugin)
        .up({
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
        assert.deepEqual(startSequence, [1, 2, 11, 12, 3, 4]);

        await server.stop();
        assert.deepEqual(stopSequence, [4, 3, 12, 11, 2, 1]);

        assert.equal(lastErrorLog, undefined);
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

    it('use(): imports services from constructed instance', async () => {
        const server = froge()
            .configure({
                verbose: false,
            })
            .up({
                something: ctx => 'something',
            })
            .use(ctx => createExampleServer(ctx.services.something))
            .up({
                test2: ctx => ({
                    getExample: () => ctx.services.exampleService,
                }),
            });

        await server.start();

        assert.equal(server.services.something, 'something');
        assert.equal(server.services.exampleService, 'example something');
        assert.equal(server.services.test2.getExample(), 'example something');
    });

    it('use(): trying to override existing service', async () => {
        try {
            const server = froge().configure({
                verbose: false,
            }).up({
                test: () => 'test',
            }).use(
                froge().up({
                    test: () => 'test2',
                }) as any
            );
            await server.start();
            assert.fail('must throw');
        } catch (e: any) {
            assert.equal(e.message, 'Plugin service test is conflicting with existing service test');
        }
    });

    it('use(): same group names allowed in plugins', async () => {
        try {
            froge().up({
                test: () => 'test',
            }, 'alpha').use(
                froge().up({
                    test2: () => 'test2',
                }, 'alpha')
            );
        } catch (e: any) {
            assert.fail('must not throw');
        }
    });
});
