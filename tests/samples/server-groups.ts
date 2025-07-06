import froge, { type InferContext } from "../../src";
import { TestService } from "./test-service";

export const server = froge().configure({
        verbose: false,
    }).up({
        test1: () => 'test1',
        test2: () => 'test2',
    }, 'alpha').up({
        testService: ctx => new TestService(ctx),
    }, 'beta');

export type AlphaContext = InferContext<typeof server, 'alpha'>;
export type BetaContext = InferContext<typeof server, 'beta'>;
