import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { roleKey } from '../src/deployment.js';

const names = ['DEPLOYER', 'FINALIZER', 'ORGANIZER', 'PLAYER_ONE', 'PLAYER_TWO', 'WORKER', 'PAYOUT_TRIGGER'] as const;
const prior = new Map<string, string | undefined>();
for (const name of names) {
  prior.set(`${name}_PRIVATE_KEY`, process.env[`${name}_PRIVATE_KEY`]);
  prior.set(`ROLE_REUSE_${name}`, process.env[`ROLE_REUSE_${name}`]);
}
try {
  const keys = Array.from({ length: names.length }, (_, index) => `0x${(index + 1).toString(16).padStart(64, '0')}`);
  names.forEach((name, index) => { process.env[`${name}_PRIVATE_KEY`] = keys[index]; delete process.env[`ROLE_REUSE_${name}`]; });
  const roles = ['finalizer', 'organizer', 'player_one', 'player_two', 'worker', 'payout_trigger'];
  const addresses = roles.map((role) => new Wallet(roleKey(role)!).address.toLowerCase());
  assert.equal(new Set(addresses).size, roles.length, 'separated role keys must resolve to distinct addresses');

  delete process.env.PLAYER_TWO_PRIVATE_KEY;
  process.env.ROLE_REUSE_PLAYER_TWO = 'WORKER';
  assert.equal(roleKey('player_two'), process.env.WORKER_PRIVATE_KEY);

  delete process.env.PLAYER_TWO_PRIVATE_KEY;
  delete process.env.ROLE_REUSE_PLAYER_TWO;
  assert.throws(() => roleKey('player_two'), /PLAYER_TWO_PRIVATE_KEY is required/);
  console.log(JSON.stringify({ explicitRoleResolution: 'PASS', distinctRoles: roles.length, implicitFallbackRejected: true }, null, 2));
} finally {
  for (const [name, value] of prior) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
