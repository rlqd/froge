
export type Plug<T> = (() => T) & {
    isFrogePlug: true,
    isReady: boolean,
};

export function plug<T>(key: string): Plug<T> {
    const plug = (function plugResolver() {
        const service = (plugResolver as any).__startedService;
        if (typeof service !== 'undefined') {
            return service();
        }
        throw new Error(`Trying to access uninitialized plug for service '${key}'`);
    });
    Object.defineProperties(plug, {
        __startedService: {
            writable: true,
        },
        isReady: {
            get: function () {
                return typeof this.__startedService !== 'undefined';
            },
        },
        isFrogePlug: {
            get: () => true,
        },
    });
    return Object.seal(plug) as Plug<T>;
}
