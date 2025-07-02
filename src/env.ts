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

    public string(defaultValue?: string) {
        const val = process.env[this.name] ?? defaultValue;
        if (typeof val === 'undefined') {
            throw new Error(`Env var "${this.name}" is not set`);
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

    public path(defaultValue?: string, config: {file?: boolean, exist?: boolean} = {}): string {
        const val = this.string(defaultValue);
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

    public number(defaultValue?: number, config: {min?: number, max?: number} = {}): number {
        const val = process.env[this.name];
        if (typeof val === 'undefined' && typeof defaultValue === 'undefined') {
            throw new Error(`Env var "${this.name}" is not set`);
        }
        const num = Number(val ?? defaultValue);
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

    public int(defaultValue?: number, config: {min?: number, max?: number, strict?: boolean} = {}): number {
        const strict = config.strict ?? true;

        const val = this.number(defaultValue, config);
        const int = parseInt(String(val));
        if (strict && int != val) {
            throw new Error(`Env var "${this.name}" is not a valid integer`);
        }
        return int;
    }

    public port(defaultValue?: number, config: {min?: number, max?: number, strict?: boolean} = {}): number {
        const val = this.int(defaultValue, config);
        if (val < 0 || val > 65535) {
            throw new Error(`Env var "${this.name}" is not a valid port number`);
        }
        return val;
    }

    public bool(defaultValue?: boolean, config: {strict?: boolean, map?: Record<string,boolean>} = {}): boolean {
        const strict = config.strict ?? false;

        const val = process.env[this.name];
        if (typeof val === 'undefined') {
            if (typeof defaultValue === 'undefined') {
                throw new Error(`Env var "${this.name}" is not set`);
            }
            return defaultValue;
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
