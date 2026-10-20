import assert from 'node:assert/strict';
import { assessReconstructedProof } from '../src/proof-verification.js';

const recorded = { proofIdentifier: `0x${'11'.repeat(32)}`, headerNumber: 10 };
assert.equal(assessReconstructedProof(recorded, { proofIdentifier: recorded.proofIdentifier, headerNumber: 10, nativeVerified: true }).status, 'PASS');
assert.equal(assessReconstructedProof(recorded, { proofIdentifier: `0x${'22'.repeat(32)}`, headerNumber: 10, nativeVerified: true }).status, 'FAIL');
assert.equal(assessReconstructedProof(recorded, { proofIdentifier: recorded.proofIdentifier, headerNumber: 11, nativeVerified: true }).status, 'FAIL');
assert.equal(assessReconstructedProof(recorded, { proofIdentifier: recorded.proofIdentifier, headerNumber: 10, nativeVerified: false }).status, 'FAIL');
console.log(JSON.stringify({ proofReconstructionClassification: 'PASS' }, null, 2));
