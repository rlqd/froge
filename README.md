# Froge

![froge](froge.webp)

Jump-start your NodeJS services with dependency & lifecycle management with handy helper methods.

Typescript-friendly with service types inferred!

```
npm i froge
```

## Learn more

* [Basic usage & explanation](#basic-usage--explanation)
* [Advanced example](#advanced-example)
* [Full configuration reference](#full-configuration-reference)

## Basic usage & explanation

```typescript
import froge from 'froge';

froge()
    // Change some config options
    .configure({
        // By default, Froge will handle Ctrl+C
        // It's recommended to set timeout to kill the app if it didn't stop on it's own
        gracefulShutdownTimeoutMs: 15000,
    })
    // Define how to start the services
    .up({
        // Services within same group start and stop in parallel by default
        service1: () => {
            // This method can be async and init the service (e.g. connect to DB)
            // We will just return the mock object
            return {
                doSomething: () => console.log('I did something!'),
                stop: () => console.log('I stopped'),
            };
        },
        service2: ctx => {
            // ctx contains useful helpers like env var helpers or server-specific log
            ctx.log("I'm starting on " + ctx.env.OS.string("unknown" /* default */));
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
            const bot = new Telegraf(ctx.envs.TG_BOT_TOKEN.string());
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

## Full configuration reference

```typescript
interface FrogeConfig {
    /** Start services which don't depend on each other in parallel */
    parallelStartGroups: boolean,
    /** Stop services which don't depend on each other in parallel */
    parallelStopGroups: boolean,
    /** Kill the process if shutdown took longer than expected */
    gracefulShutdownTimeoutMs?: number,
    /** Print info logs */
    verbose: boolean,
}
```
