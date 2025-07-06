
export type Plug<T> = T & {isFrogePlug: true};

export function plug<T>(key: string): Plug<T> {
    return new Proxy({}, {
        get: (_, prop: string) => {
            if (prop === 'isFrogePlug') {
                return true;
            }
            throw new Error(`Trying to access member '${prop}' on uninitialized plug for service '${key}'`);
        },
    }) as Plug<T>;
}
