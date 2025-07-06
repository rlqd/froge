import envHelper from './env';
import { type Plug, plug } from './plug';

type MaybePromise<T> = T|Promise<T>;
type UnpackPromise<T> = T extends Promise<infer R> ? R : T;
type UnpackAsyncFunction<T> = T extends (...args: any) => infer R ? UnpackPromise<R> : T;
type UnpackAsyncMap<Map extends {}> = {
    [K in keyof Map]: UnpackAsyncFunction<Map[K]>;
};

export interface FrogeContext<ServiceMap extends {}> {
    services: ServiceMap,
    envs: typeof envHelper,
    log: (...items: any) => void,
    plug: <T>() => Plug<T>,
}

type PlugCallback<T extends keyof ServiceMap, ServiceMap extends {}>
    = ServiceMap[T] extends Plug<infer S> ? (ctx: FrogeContext<ServiceMap>) => MaybePromise<S> : never;

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
}

class FrogeServer<ServiceMap extends Record<string,any>, ServiceGroups extends Record<string,Record<string,any>>> {
    private map: Map<string, ServiceContainer<any>> = new Map();
    private config: FrogeConfig = {...defaultConfig};

    public configure(config: Partial<FrogeConfig>) {
        this.config = {...this.config, ...config};
        return this;
    }

    public readonly services: ServiceMap = new Proxy({}, {
        get: (_, prop: string) => {
            const service = this.map.get(prop);
            if (typeof service === 'undefined') {
                return;
            }
            if (!service.up) {
                throw new Error(`Can't access service "${prop}" before it was started`);
            }
            if (service.value?.isFrogePlug) {
                throw new Error(`Can't access service "${prop}" - it's a plug`);
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
        const level = this.map.size;
        for (const key in services) {
            this.map.set(key, {level, group, up: false, init: services[key]});
        }
        return this as FrogeServer<
            ServiceMap & UnpackAsyncMap<NewServices>,
            ServiceGroups & (GroupKey extends string ? Record<GroupKey, ServiceMap & UnpackAsyncMap<NewServices>> : {})
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

    private async startInternal(target?: keyof ServiceMap & string) {
        const targetLevel: number|undefined = target && this.map.get(target)?.level;
        const startGroups = Map.groupBy(
            this.map.entries().filter(([key, info]) => key === target || typeof targetLevel === 'undefined' || info.level < targetLevel),
            ([key, info]) => this.config.parallelStartGroups ? info.level : key,
        );
        for (const group of startGroups.values()) {
            await Promise.all(group.map(([key, container]) => (async () => {
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
                container.up = true;
                if (container.value?.isFrogePlug) {
                    console.warn(`[${key}] Got a plug instead of the service`);
                } else {
                    this.config.verbose && console.log(`[${key}] Ready`);
                }
            })()));
        }
    }

    public async only<K extends keyof ServiceMap & string>(key: K): Promise<ServiceMap[K]> {
        const info = this.map.get(key);
        if (!info?.up) {
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
            Array.from(this.map.entries()).reverse(),
            ([key, info]) => this.config.parallelStopGroups ? info.level : key,
        );
        for (const group of stopGroups.values()) {
            await Promise.all(group.map(([key, container]) => (async() => {
                if (typeof container.destroy === 'undefined' || typeof container.value === 'undefined') {
                    return;
                }
                this.config.verbose && console.log(`[${key}] Destroying...`);
                await container.destroy(container.value);
                container.value = undefined;
                container.up = false;
                this.config.verbose && console.log(`[${key}] Destroyed`);
            })()));
        }
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
