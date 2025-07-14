
export type Plug<T> = (() => T) & {isFrogePlug: true};

export function plug<T>(key: string): Plug<T> {
    const plug = (function plugResolver() {
        const service = (plugResolver as any).__startedService;
        if (typeof service !== 'undefined') {
            return service();
        }
        throw new Error(`Trying to access uninitialized plug for service '${key}'`);
    }) as any;
    plug.isFrogePlug = true;
    return plug as Plug<T>;
}
