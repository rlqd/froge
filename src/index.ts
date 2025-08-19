import envHelper from './env';
import { type Plug, plug } from './plug';

const AsyncFunction = async function () {}.constructor;

type MaybePromise<T> = T|Promise<T>;
type UnpackPromise<T> = T extends Promise<infer R> ? R : T;
type UnpackAsyncFunction<T> = T extends (...args: any) => infer R ? UnpackPromise<R> : T;
type UnpackAsyncMap<Map extends {}> = {
    [K in keyof Map]: UnpackAsyncFunction<Map[K]>;
};

export interface CommonFrogeContext<ServiceMap extends {}> {
    services: ServiceMap,
    envs: typeof envHelper,
}

export interface FrogeContext<ServiceMap extends {}> extends CommonFrogeContext<ServiceMap> {
    log: (...items: any) => void,
    plug: <T extends NonNullable<unknown>>() => Plug<T>,
}

type PlugCallback<T extends keyof ServiceMap, ServiceMap extends {}>
    = ServiceMap[T] extends Plug<infer S> ? (ctx: FrogeContext<ServiceMap>) => MaybePromise<() => S> : never;

// note: update in README as well
export interface FrogeConfig {
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
const defaultConfig: FrogeConfig = {
    parallelStartGroups: true,
    parallelStopGroups: true,
    forceExitAfterShutdown: false,
    verbose: true,
}

interface ServiceContainer<T> {
    level: number,
    group?: string,
    up: boolean,
    init: (ctx: FrogeContext<any>) => MaybePromise<T>,
    destroy?: (service: T) => MaybePromise<void>,
    value?: T,
    plug?: Plug<T>,
    serverSymbol: Symbol,
}

type PluginFactory<ServiceMapIn extends {}, ServiceMapOut extends {}>
    = (ctx: CommonFrogeContext<ServiceMapIn>) => FrogeServer<ServiceMapOut, any> | Promise<FrogeServer<ServiceMapOut, any>>;

interface PluginContainer {
    factory: PluginFactory<any, any>,
    pushConfig: boolean,
    server?: FrogeServer<any,any>,
};

class FrogeServer<ServiceMap extends Record<string,any>, ServiceGroups extends Record<string,Record<string,any>>> {
    private map: Map<string, ServiceContainer<any>> = new Map();
    private groups: Set<string> = new Set();
    private config: FrogeConfig = {...defaultConfig};
    private plugins = new Map<number, PluginContainer[]>;
    private currentLevel: number = -1;
    private symbol = Symbol();

    public configure(config: Partial<FrogeConfig>) {
        this.config = {...this.config, ...config};
        return this;
    }

    public readonly services: ServiceMap = new Proxy({}, {
        get: (_, prop: string) => {
            const service = this.map.get(prop);
            if (typeof service === 'undefined') {
                throw new Error(`Can't access service "${prop}", make sure it exists and started`);
            }
            if (service.plug) {
                return service.plug;
            }
            if (!service.up) {
                throw new Error(`Can't access service "${prop}" before it was started`);
            }
            return service.value;
        },
    }) as ServiceMap;

    public up<NewServices extends (
        {
            // Don't allow to override existing properties unless it's a plug
            [T in keyof ServiceMap]?: PlugCallback<T, ServiceMap>
        } & Record<string, (ctx: FrogeContext<ServiceMap>) => any>
    ), GroupKey extends string|undefined>(
        services: NewServices,
        group?: GroupKey,
    ) {
        if (group && this.groups.has(group)) {
            throw new Error(`Group with key ${group} already exists, trying to add new group with the same name (${Object.keys(services).join(', ')})`);
        }
        const level = ++this.currentLevel;
        for (const key in services) {
            const existing = this.map.get(key);
            let maybePlug: any;
            if (existing) {
                const errorMsg = `Trying to override existing service ${key} from group ${existing.group ?? 'undefined'}.`
                    + '\nOnly plugs can be overridden. Function defining a plug must not be async and must only use ctx.plug() method.'
                    + '\nExample: ctx => ctx.plug<MyService>()';
                if (existing.init instanceof AsyncFunction) {
                    throw new Error(errorMsg + `\nInit function for ${key} is async`);
                }
                const plugContextMock = new Proxy({}, {
                    get(_, prop: string) {
                        if (prop === 'plug') {
                            return plug;
                        }
                        throw new Error(errorMsg + `\nInit function for ${key} tried accessing ctx.${prop}`);
                    }
                }) as FrogeContext<ServiceMap>;
                try {
                    maybePlug = existing.init(plugContextMock);
                } catch (e) {
                    throw new Error(errorMsg + `\nInit function for ${key} raised an error: ${e}`);
                }
                if (!maybePlug?.isFrogePlug) {
                    throw new Error(errorMsg + `\nInit function for ${key} didn't return a Froge plug`);
                }
                // Ok, we are satisfied, it's definitely a plug. Deleted to ensure correct startup order.
                this.map.delete(key);
            }
            this.map.set(key, {level, group, up: false, init: services[key], plug: maybePlug, serverSymbol: this.symbol});
        }
        group && this.groups.add(group);
        return this as FrogeServer<
            ServiceMap & UnpackAsyncMap<NewServices>,
            ServiceGroups & (GroupKey extends string ? (GroupKey extends keyof ServiceGroups ? never : Record<GroupKey, ServiceMap & UnpackAsyncMap<NewServices>>) : {})
        >;
    }

    public down<NewDestroyers extends {
        [T in keyof ServiceMap]?: (service: ServiceMap[T]) => MaybePromise<void>
    }>(destroyers: NewDestroyers) {
        for (const key in destroyers) {
            const service = this.map.get(key);
            if (typeof service === 'undefined') {
                throw new Error(`Trying to add destroyer to unknown service ${key}`);
            }
            service.destroy = destroyers[key];
        }
        return this;
    }

    public use<
        ServiceMap2 extends {
            // Don't allow overriding existing services
            [T in keyof ServiceMap]?: never
        } & Record<string,any>
    >(
        other: FrogeServer<ServiceMap2,any> | PluginFactory<ServiceMap,ServiceMap2>,
        /** Change plugin config to match main instance */
        pushConfig: boolean = true,
    ) {
        const container: PluginContainer = {
            factory: other instanceof FrogeServer ? () => other : other,
            pushConfig,
        };
        const after = this.currentLevel;
        if (this.plugins.has(after)) {
            this.plugins.get(after)?.push(container);
        } else {
            this.plugins.set(after, [container]);
        }
        return this as FrogeServer<ServiceMap & ServiceMap2, ServiceGroups>;
    }

    private async startPlugins(level: number) {
        const groupPlugins = this.plugins.get(level);
        if (!groupPlugins) {
            return;
        }
        for (const plugin of groupPlugins) {
            if (plugin.server) {
                continue;
            }
            plugin.server = await plugin.factory({
                services: this.services,
                envs: envHelper,
            });
            if (plugin.pushConfig) {
                plugin.server.configure(this.config);
            }
            for (const key of plugin.server.map.keys()) {
                if (this.map.has(key)) {
                    throw new Error(`Plugin service ${key} is conflicting with existing service ${key}`);
                }
            }
            await plugin.server.start();
            for (const [key, container] of plugin.server.map) {
                this.map.set(key, container);
            }
        }
    }

    private async stopPlugins(level: number) {
        const groupPlugins = this.plugins.get(level);
        if (!groupPlugins) {
            return;
        }
        for (const plugin of groupPlugins.toReversed()) {
            if (!plugin.server) {
                continue;
            }
            await plugin.server.stop();
            for (const key of plugin.server.map.keys()) {
                this.map.delete(key);
            }
            plugin.server = undefined;
        }
    }

    private async startService(key: keyof ServiceMap & string, container: ServiceContainer<any>) {
        if (container.up) {
            this.config.verbose && console.log(`[${key}] Already initialized`);
            return;
        }
        this.config.verbose && console.log(`[${key}] Initializing...`);
        const value = container.init({
            services: this.services,
            envs: envHelper,
            log: (...items: any) => this.config.verbose && console.log(`[${key}]`, ...items),
            plug: <T>() => plug<T>(key),
        });
        if (value instanceof Promise) {
            container.value = await value;
        } else {
            container.value = value;
        }
        if (container.plug) {
            (container.plug as any).__startedService = container.value;
        }
        container.up = true;
        if (container.value?.isFrogePlug) {
            console.warn(`[${key}] Got a plug instead of the service`);
        } else {
            this.config.verbose && console.log(`[${key}] Ready`);
        }
    }

    private async stopService(key: keyof ServiceMap & string, container: ServiceContainer<any>) {
        if (typeof container.destroy === 'undefined' || typeof container.value === 'undefined') {
            return;
        }
        this.config.verbose && console.log(`[${key}] Destroying...`);
        await container.destroy(container.value);
        container.value = undefined;
        if (container.plug) {
            (container.plug as any).__startedService = undefined;
        }
        container.up = false;
        this.config.verbose && console.log(`[${key}] Destroyed`);
    }

    private async startInternal(target?: keyof ServiceMap & string) {
        const targetLevel: number|undefined = target && this.map.get(target)?.level;
        const startGroups = Map.groupBy(
            this.map.entries().filter(([key, info]) => key === target || typeof targetLevel === 'undefined' || info.level < targetLevel),
            ([, info]) => info.level,
        );
        await this.startPlugins(-1);
        for (const [level, group] of startGroups.entries()) {
            if (this.config.parallelStartGroups) {
                await Promise.all(group.map(entry => this.startService(...entry)));
            } else {
                for (const entry of group) {
                    await this.startService(...entry);
                }
            }
            if (level !== targetLevel) {
                await this.startPlugins(level);
            }
        }
    }

    public async only<K extends keyof ServiceMap & string>(key: K): Promise<ServiceMap[K]> {
        const info = this.map.get(key);
        if (!info) {
            throw new Error(`Service ${key} doesn't exist or is from a plugin`);
        }
        if (!info.up) {
            this.config.verbose && console.log(`Starting only service '${String(key)}' and dependencies...`);
            await this.startInternal(key);
        }
        return this.services[key];
    }

    public async start() {
        this.config.verbose && console.log('Starting...');
        await this.startInternal();
        return this;
    }

    public async stop(reasonText?: string) {
        this.config.verbose && console.log(`Stopping (${reasonText ?? 'unspecified reason'})...`);
        const stopGroups = Map.groupBy(
            Array.from(this.map.entries())
                // only stop my services
                .filter(([, c]) => c.serverSymbol === this.symbol)
                // in reverse order
                .reverse(),
            ([, info]) => info.level,
        );
        for (const [level, group] of stopGroups.entries()) {
            await this.stopPlugins(level);
            if (this.config.parallelStopGroups) {
                await Promise.all(group.map(entry => this.stopService(...entry)));
            } else {
                for (const entry of group) {
                    await this.stopService(...entry);
                }
            }
        }
        await this.stopPlugins(-1);
    }

    public async launch() {
        if (!this.config.gracefulShutdownTimeoutMs) {
            console.info('gracefulShutdownTimeoutMs config option not set, fallback to 60 sec');
            this.config.gracefulShutdownTimeoutMs = 60000;
        }
        try {
            await this.start();
            process.once('SIGINT', () => this.shutdown('SIGINT'));
            process.once('SIGTERM', () => this.shutdown('SIGTERM'));
        } catch (e) {
            console.error('Failed to start: ', e);
            await this.shutdown('failed start cleanup');
        }
        return this;
    }

    public async shutdown(reasonText?: string) {
        const timeoutInfo = this.config.gracefulShutdownTimeoutMs ? `timeout: ${this.config.gracefulShutdownTimeoutMs}ms` : 'no timeout';
        if (this.config.gracefulShutdownTimeoutMs) {
            setTimeout(() => {
                console.error(`Reached shutdown timeout ${this.config.gracefulShutdownTimeoutMs}ms, killing...`);
                process.exit(1);
            }, this.config.gracefulShutdownTimeoutMs).unref();
        }
        try {
            await this.stop((reasonText ?? 'shutdown') + ', ' + timeoutInfo);
            if (this.config.forceExitAfterShutdown) {
                process.exit(0);
            }
        } catch (e) {
            console.error('Shutdown incomplete, killing... Reason:', e);
            process.exit(1);
        }
    }
}

export type { FrogeServer };
export { envHelper as envs };

export type { Plug } from './plug';

export type InferContext<S extends FrogeServer<any, any>, K> = S extends FrogeServer<any, infer G> ? K extends keyof G ? FrogeContext<G[K]> : never : never;

export default function froge(): FrogeServer<{},{}> {
    return new FrogeServer();
}
