import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { server as sampleGroupsServer } from './samples/server-groups';

describe('Froge (named groups)', () => {
    it('supports named group and inferred context', async () => {
        await sampleGroupsServer.start();
        assert.equal(sampleGroupsServer.services.testService.test(), 'test1+test2');
    });
});
