import type { AlphaContext } from "./server-groups";

export class TestService {
    constructor(
        private ctx: AlphaContext,
    ) {}

    public test() {
        return this.ctx.services.test1 + '+' + this.ctx.services.test2;
    }
}
