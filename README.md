# Froge

![froge](froge.webp)

Jump-start your NodeJS services with dependency & lifecycle management and handy helper methods.

Froge is Typescript-focused and allows type safe access to services in the context.

```
npm i froge
```

## Learn more

* [Basic usage](#basic-usage)
* [Explained example](#explained-example)
* [Advanced example](#advanced-example)
* [Start one specific service](#start-one-specific-service)
* [Inferred context](#inferred-context)
* [Reverse dependencies (service plugs)](#reverse-dependencies-service-plugs)
* [Full configuration reference](#full-configuration-reference)

## Basic usage

Froge lets you define service groups which depend on each other.

Calling `froge()` creates a Froge Server, which can be populated with services:

* `up()` defines how to start the service
* `down()` defines how to stop them
* `use()` copies services from another server

```typescript
import froge from 'froge';

const server = froge().up({
    service1: ctx => 'I am service 1',
    service2: async ctx => await new Promise(resolve => resolve('I am service 2')),
}).up({
    service3: ctx => `I am service 3 and I depend on "${ctx.services.service1}"`,
}).use(
    froge().up({
        externalService: ctx => 'I am a service from other instance',
    })
).up({
    service4: ctx => `I depend on other instance service "${ctx.services.externalService}"`,
});

server.down({
    service1: service1 => console.log(`I'm stopping "${service1}"`),
    service4: async service4 => await new Promise(resolve => {
        console.log(`I'm stopping "${service4}"`);
        resolve();
    }),
})

server.launch()
    .then(() => console.log('Server is ready'));

```

## Explained example

```typescript
import froge from 'froge';

froge()
    .configure({
        // If started with launch() method, Froge will handle Ctrl+C
        // It's recommended to set timeout to kill the app if it didn't stop on it's own
        gracefulShutdownTimeoutMs: 15000,
    })
    .up({
        // Services within same group start and stop in parallel by default
        service1: () => {
            return {
                doSomething: () => console.log('I did something!'),
                stop: () => console.log('I stopped'),
            };
        },
        service2: ctx => {
            // ctx contains useful helpers like env var helpers or server-specific log
            ctx.log("I'm starting on " + ctx.envs.OS.string("unknown" /* default */));
            return {
                doSomethingElse: () => console.log('I did something else!'),
            };
        },
    })
    // Add more services, which depend on the first group
    // They will only start after the first group is ready
    .up({
        foo: ctx => {
            return setInterval(() => {
                // Previous services became available in the context
                // Types are inherited automatically
                ctx.services.service1.doSomething();
                ctx.services.service2.doSomethingElse();
            }, ctx.envs.SOMETHING_INTERVAL_MS.number(1000))
        },
    })
    // Define here how the services should be stopped (if needed)
    .down({
        service1: service => service.stop(),
        foo: interval => clearInterval(interval),
    })
    // Start services and handle shutdown when requested
    .launch()
        .then(froge => {
            console.log("I'm ready!");
            // Services can be accessed after Froge has started, everything is properly typed
            froge.services.service1; // { doSomething: () => void, stop: () => void }
        });
```

Which will output the following when started:

```
Starting...
[service1] Initializing...
[service2] Initializing...
[service2] I'm starting on Windows_NT
[service1] Ready
[service2] Ready
[foo] Initializing...
[foo] Ready
I'm ready!

I did something!
I did something else!
I did something!
I did something else!
...

Ctrl+C

Stopping (SIGINT, timeout: 15000ms)...
[foo] Destroying...
[foo] Destroyed
[service2] Destroying...
[service1] Destroying...
[service2] Destroyed
[service1] Destroyed
Stop complete
```

## Advanced example

Slightly more realistic example demonstrating all available features

```typescript
import froge from 'froge';

// 3rd party libraries used in an example:
import 'dotenv/config'; // load .env file
import mysql from 'mysql2/promise';
import { Telegraf } from 'telegraf';
import express from 'express';
import type { Server } from 'http';

froge()
    .configure({
        gracefulShutdownTimeoutMs: 15000,
        // If you don't want to see console output
        verbose: false,
    })
    // First group of the services
    .up({
        db: async ctx => {
            return await mysql.createPool({
                // Use handy helpers for validating common env var values
                host: ctx.envs.MYSQL_HOST.string('localhost'),
                port: ctx.envs.MYSQL_PORT.port(3306),
                // ...
            });
        },
        hourlyJoke: async ctx => {
            const fetchJoke = async () => (await fetch(`https://v2.jokeapi.dev/joke/${ctx.envs.JOKE_TOPIC.string('Programming')}?format=txt&type=single`)).text();
            let joke = await fetchJoke();
            let interval = setInterval(async () => {
                joke = await fetchJoke();
            }, 3600000);
            return {
                get joke() {
                    return joke;
                },
                stop: () => clearInterval(interval),
            };
        },
    })
    // Second group of services, which depend on first
    .up({
        api: ctx => {
            const db = ctx.services.db;
            return {
                routes: express.Router()
                    .get('/joke', async (req, res) => {
                        // Access other services
                        res.send(ctx.services.hourlyJoke.joke);
                    })
                    .post('/like', async (req, res) => {
                        await db.query('UPDATE likes SET amount = amount + 1 WHERE joke = ?', [req.query.joke]);
                    }),
            };
        },
        telegram: async ctx => {
            const bot = new Telegraf(ctx.envs.TG_BOT_TOKEN.s() /* s() is short for string() */);
            const webhookRoutes = await bot.createWebhook({domain: ctx.envs.PUBLIC_ADDRESS.string()});
            return { bot, webhookRoutes };
        },
    })
    // Now it's time for http server, which exposes routes from other services above
    .up({
        http: async ctx => {
            let server: Server;
            await new Promise<void>((resolve, reject) => {
                server = express()
                    .use(ctx.services.telegram.webhookRoutes)
                    .use('/api', ctx.services.api.routes)
                    .listen(ctx.envs.LISTEN_PORT.port(8080), err => err ? reject(err) : resolve());
            });
            return server!;
        },
    })
    // Define how to stop the services
    .down({
        db: async pool => await pool.end(),
        hourlyJoke: service => service.stop(),
        telegram: async service => service.bot.stop(),
        http: async service => service.close()
    })
    // .launch() automates lifecycle management, but it can be handled manually using .start()/.stop() instead
    .start()
        .then(froge => {
            console.log("I'm ready!");
            process.once('SIGINT', () => {
                froge.stop().catch(e => {
                    console.error('Failed to stop: ', e);
                    process.exit(1);
                });
            });
        })
        .catch(e => {
            console.error('Failed to start: ', e);
            process.exit(1);
        });
```

## Start one specific service

`only` method starts a specific service and all it's dependencies.
It can be useful to write cli commands for your server.

Imagine a server which has a db service and some others, defined in `server.ts`:

```typescript
import froge from 'froge';
import { createPool } from 'mysql2/promise';

export default froge()
    .up({ /* dependencies of db (imagine something here), will be started */ })
    .up({
        // db - will be started
        db: ctx => createPool({
            host: ctx.envs.MYSQL_HOST.s('localhost'),
            port: ctx.envs.MYSQL_PORT.port(3306),
            // ...
        }),
        something: () => 'something else', // won't start
    })
    .up({ /* more services that won't start */ })
    .down({
        db: pool => pool.end(),
    })

```

You only need to start db in the cli command `migrate`:

```typescript
import { Command } from 'commander';
import server from './server';

const program = new Command();
program.command('migrate')
    .description('Init database structure')
    .action(async () => {
        const db = await server.only('db'); // this will only start db and it's dependencies
        try {
            await db.query('CREATE TABLE ...');
        } finally {
            await server.shutdown();
        }
    });

program.parse();
```

## Inferred context

When service has lots of dependencies, you may want to pass the context as is to the service instead.

This is a more invasive approach as your services will have to know about the froge context, but it can be handy sometimes.

server.ts
```typescript
import froge, { type InferContext } from "froge";
import { TestService } from "./test-service";

export const server = froge().up({
    test1: () => 'test1',
    test2: () => 'test2',
}, 'alpha' /* <== */).up({
    testService: ctx => new TestService(ctx),
}, 'beta');

// Contains all services from the first group named "alpha"
export type AlphaContext = InferContext<typeof server, 'alpha' /* <== */>;

// Contains all services from the second group named "beta"
export type BetaContext = InferContext<typeof server, 'beta'>;
```

test-service.ts
```typescript
import type { AlphaContext } from "./server";

export class TestService {
    constructor(private ctx: AlphaContext) {}

    public test() {
        // Services from the first group available
        return this.ctx.services.test1 + '+' + this.ctx.services.test2;
    }
}
```

## Reverse dependencies (service plugs)

Sometimes the service may need to communicate with a service in the group below.

There are two ways to implement this.

### Event emitter:

```typescript
import froge from "froge";
import EventEmitter from 'events';

const server = froge().up({
    events: () => new EventEmitter(),
}).up({
    service1: ctx => ({
        // there is no service2 in the context, but we can send an event
        sendFoo: () => ctx.services.events.push('foo', 'bar'),
    }),
}).up({
    service2: ctx => {
        ctx.services.events.on('foo', data => console.log(data));
    },
});
await server.launch();
server.services.service1.sendFoo(); // prints "bar"
```

### Service plugs:

A more complex method would be to add a plug for a service, which itself will be added later.

```typescript
import froge from "froge";

const server = froge().up({
    service2: ctx => ctx.plug<{
        acceptFoo: (data: string) => void,
    }>(),
}).up({
    service1: ctx => ({
        // there is a plug for service2 in the context, with acceptFoo method available
        sendFoo: () => {
            // It must not be accessed before actual service2 started, it will cause an error
            if (!ctx.service.service2.isReady) {
                console.log('service2 not ready yet');
            } else {
                // Note! service2 is called as a function to access the service
                ctx.services.service2().acceptFoo('bar');
            }
        },
    }),
}).up({
    // Normally, existing service can't be overwritten (unless it's a plug)
    // Type declaration must be compatible with a plug defined above (extra properties are allowed)
    service2: ctx => {
        const myService = {
            acceptFoo: (data: string) => console.log(data),
            somethingElse: () => console.log('Something else!'),
        };
        // Note! Plug services must return a function
        return () => myService;
    },
});
await server.launch();
server.services.service1.sendFoo(); // prints "bar"
server.services.service2().somethingElse();
```


## Full configuration reference

```typescript
interface FrogeConfig {
    /** Start services which don't depend on each other in parallel */
    parallelStartGroups: boolean,
    /** Stop services which don't depend on each other in parallel */
    parallelStopGroups: boolean,
    /** Kill the process if shutdown took longer than expected */
    gracefulShutdownTimeoutMs?: number,
    /** Force exit the current process after shutdown is completed */
    forceExitAfterShutdown: boolean,
    /** Print info logs */
    verbose: boolean,
}
```
