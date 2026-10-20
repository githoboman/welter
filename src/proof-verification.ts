export type VerificationStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export function assessReconstructedProof(
  recorded: { proofIdentifier?: string; headerNumber?: number },
  reconstructed: { proofIdentifier: string; headerNumber: number; nativeVerified: boolean },
): { status: VerificationStatus; detail: string } {
  if (String(recorded.proofIdentifier ?? '').toLowerCase() !== reconstructed.proofIdentifier.toLowerCase()) {
    return { status: 'FAIL', detail: `proof digest mismatch: recorded=${recorded.proofIdentifier ?? 'missing'} reconstructed=${reconstructed.proofIdentifier}` };
  }
  if (Number(recorded.headerNumber) !== reconstructed.headerNumber) {
    return { status: 'FAIL', detail: `proof header mismatch: recorded=${recorded.headerNumber ?? 'missing'} reconstructed=${reconstructed.headerNumber}` };
  }
  if (!reconstructed.nativeVerified) return { status: 'FAIL', detail: 'CC3 native Block Prover preflight returned false' };
  return { status: 'PASS', detail: `proof digest/header match and native preflight passed at header ${reconstructed.headerNumber}` };
}
