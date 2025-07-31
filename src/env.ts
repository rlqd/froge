import net from 'node:net';
import fs from 'node:fs';

const boolMapStrict = {
    'true': true,
    'false': false,
};
const boolMap = {
    ...boolMapStrict,
    '1': true,
    'y': true,
    'yes': true,
    '0': false,
    'n': false,
    'no': false,
};

class EnvWrapper {
    constructor(
        private name: string,
    ) {}

    public toString(): string {
        return this.string();
    }

    // Aliases
    public readonly s: typeof this.string = this.string.bind(this);
    public readonly n: typeof this.number = this.number.bind(this);
    public readonly i: typeof this.int = this.int.bind(this);
    public readonly b: typeof this.bool = this.bool.bind(this);

    public string(defaultValue?: string): string;
    public string(config?: {def?: string, nonEmpty?: boolean}): string;
    public string(defaultOrConfig?: string|{def?: string, nonEmpty?: boolean}) {
        const config = typeof defaultOrConfig === 'object' ? defaultOrConfig : {};
        const defVal = typeof defaultOrConfig === 'string' ? defaultOrConfig : config.def;
        const nonEmpty = config.nonEmpty ?? true;
        const val = process.env[this.name] ?? defVal;
        if (typeof val === 'undefined') {
            throw new Error(`Env var "${this.name}" is not set`);
        }
        if (nonEmpty && val.length === 0) {
            if (defVal?.length) {
                return defVal;
            }
            throw new Error(`Env var "${this.name}" is empty`);
        }
        return val;
    }

    public match(regExp: RegExp, defaultValue?: string) {
        const val = this.string(defaultValue);
        const matches = val.match(regExp);
        if (matches === null) {
            throw new Error(`Env var "${this.name}" doesn't match expected format ${regExp}`);
        }
        return matches[0];
    }

    public path(defaultValue?: string): string;
    public path(config?: {def?: string, file?: boolean, exist?: boolean}): string;
    public path(defaultOrConfig?: string|{def?: string, file?: boolean, exist?: boolean}): string {
        const config = typeof defaultOrConfig === 'object' ? defaultOrConfig : {};
        const defVal = typeof defaultOrConfig === 'string' ? defaultOrConfig : config.def;
        const val = this.string(defVal);
        if (config.exist || typeof config.file !== 'undefined') {
            try {
                const stat = fs.statSync(val);
                if (typeof config.file !== 'undefined') {
                    if (config.file && !stat.isFile) {
                        throw new Error(`Env var "${this.name}" is not a file path`);
                    }
                    if (!config.file && !stat.isDirectory) {
                        throw new Error(`Env var "${this.name}" is not a directory path`);
                    }
                }
            } catch (e: any) {
                if (e.code === 'ENOENT') {
                    if (config.exist) {
                        throw new Error(`Env var "${this.name}" path doesn't exist`);
                    }
                } else {
                    throw new Error(`Failed to check file stat for path in env var "${this.name}", error: ${e.message}`);
                }
            }
        }
        return val;
    }

    public url(defaultValue?: string): URL {
        return new URL(this.string(defaultValue));
    }

    public urls(defaultValue?: string): string {
        return this.url(defaultValue).toString();
    }

    public ip(defaultValue?: string): string {
        const val = this.string(defaultValue);
        if (!net.isIP(val)) {
            throw new Error(`Env var "${this.name}" is not a valid IP address`);
        }
        return val;
    }

    public ipv4(defaultValue?: string): string {
        const val = this.string(defaultValue);
        if (!net.isIPv4(val)) {
            throw new Error(`Env var "${this.name}" is not a valid IPv4 address`);
        }
        return val;
    }

    public ipv6(defaultValue?: string): string {
        const val = this.string(defaultValue);
        if (!net.isIPv6(val)) {
            throw new Error(`Env var "${this.name}" is not a valid IPv6 address`);
        }
        return val;
    }

    public number(defaultValue?: number): number;
    public number(config?: {def?: number, min?: number, max?: number}): number;
    public number(defaultOrConfig?: number|{def?: number, min?: number, max?: number}): number {
        const config = typeof defaultOrConfig === 'object' ? defaultOrConfig : {};
        const defVal = typeof defaultOrConfig === 'number' ? defaultOrConfig : config.def;
        const val = process.env[this.name];
        if (typeof val === 'undefined' && typeof defVal === 'undefined') {
            throw new Error(`Env var "${this.name}" is not set`);
        }
        const num = Number(val ?? defVal);
        if (isNaN(num)) {
            throw new Error(`Env var "${this.name}" is not a valid number`);
        }
        if (typeof config.min !== 'undefined' && num < config.min) {
            throw new Error(`Env var "${this.name}" value is too small (<${config.min})`);
        }
        if (typeof config.max !== 'undefined' && num > config.max) {
            throw new Error(`Env var "${this.name}" value is too large (>${config.max})`);
        }
        return num;
    }

    public int(defaultValue?: number): number;
    public int(config?: {def?: number, min?: number, max?: number, strict?: boolean}): number;
    public int(defaultOrConfig?: number|{def?: number, min?: number, max?: number, strict?: boolean}): number {
        const config = typeof defaultOrConfig === 'object' ? defaultOrConfig : {};
        const defVal = typeof defaultOrConfig === 'number' ? defaultOrConfig : config.def;
        const strict = config.strict ?? true;

        const val = this.number({...config, def: defVal});
        const int = parseInt(String(val));
        if (strict && int != val) {
            throw new Error(`Env var "${this.name}" is not a valid integer`);
        }
        return int;
    }

    public port(defaultValue?: number): number;
    public port(config?: {def?: number, min?: number, max?: number, strict?: boolean}): number;
    public port(defaultOrConfig?: number|{def?: number, min?: number, max?: number, strict?: boolean}): number {
        const config = typeof defaultOrConfig === 'object' ? defaultOrConfig : {};
        const defVal = typeof defaultOrConfig === 'number' ? defaultOrConfig : config.def;
        const val = this.int({...config, def: defVal});
        if (val < 0 || val > 65535) {
            throw new Error(`Env var "${this.name}" is not a valid port number`);
        }
        return val;
    }

    public bool(defaultValue?: boolean): boolean;
    public bool(config?: {def?: boolean, strict?: boolean, map?: Record<string,boolean>}): boolean;
    public bool(defaultOrConfig?: boolean|{def?: boolean, strict?: boolean, map?: Record<string,boolean>}): boolean {
        const config = typeof defaultOrConfig === 'object' ? defaultOrConfig : {};
        const defVal = typeof defaultOrConfig === 'boolean' ? defaultOrConfig : config.def;
        const strict = config.strict ?? false;

        const val = process.env[this.name];
        if (typeof val === 'undefined') {
            if (typeof defVal === 'undefined') {
                throw new Error(`Env var "${this.name}" is not set`);
            }
            return defVal;
        }
        const map: Record<string,boolean> = config.map ?? (strict ? boolMapStrict : boolMap);
        const parsed = map[val.toLowerCase()];
        if (typeof parsed === 'undefined') {
            throw new Error(`Env var "${this.name}" is not a valid boolean`);
        }
        return parsed;
    }
}

const envHelper = new Proxy({}, {
    get(_, prop: string): EnvWrapper {
        return new EnvWrapper(prop);
    }
}) as {
    [key: string]: EnvWrapper;
};
export default envHelper;
