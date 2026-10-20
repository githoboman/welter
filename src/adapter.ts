import type { ProofData } from './attestcoin.js';
import { Interface } from 'ethers';

/** A source result adapter turns one game's canonical event into PrizeRail predicates. */
export interface SourceResultAdapter<Result> {
  readonly name: string;
  readonly eventSignature: string;
  decode(receipt: { status: number | null; logs: readonly unknown[] }, sourceContract: string): Result;
  businessKey(result: Result): string;
}

/** The only MVP adapter: TournamentResultRegistry.MatchFinalized on Sepolia. */
export type RpsMatchResult = {
  tournamentId: string;
  matchId: string;
  playerOne: string;
  playerTwo: string;
  winner: string;
  result: number;
  rulesHash: string;
  resultNonce: string;
  finalizationStatus: number;
  sourceChainId: string;
  finalizedAt: string;
  deadline: string;
};

export const RPS_MATCH_FINALIZED_SIGNATURE = 'MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)';

const RPS_INTERFACE = new Interface([
  'event MatchFinalized(bytes32 indexed tournamentId,bytes32 matchId,address playerOne,address playerTwo,address winner,uint8 result,bytes32 rulesHash,uint256 resultNonce,uint8 finalizationStatus,uint64 sourceChainId,uint64 finalizedAt,uint64 deadline)',
]);

/**
 * Decode the one supported source event. This is an evidence adapter only;
 * PrizeRailASC repeats these checks against the Attestcoin-proven receipt.
 */
export function decodeRpsMatchFinalized(
  receipt: { status: number | null; logs: readonly unknown[] },
  sourceContract: string,
): RpsMatchResult {
  if (receipt.status !== 1) throw new Error('source receipt is not successful');
  const expectedAddress = sourceContract.toLowerCase();
  for (const rawLog of receipt.logs as readonly { address?: string }[]) {
    if (rawLog.address?.toLowerCase() !== expectedAddress) continue;
    try {
      const parsed = RPS_INTERFACE.parseLog(rawLog as never);
      if (!parsed || parsed.name !== 'MatchFinalized') continue;
      return {
        tournamentId: String(parsed.args.tournamentId),
        matchId: String(parsed.args.matchId),
        playerOne: String(parsed.args.playerOne),
        playerTwo: String(parsed.args.playerTwo),
        winner: String(parsed.args.winner),
        result: Number(parsed.args.result),
        rulesHash: String(parsed.args.rulesHash),
        resultNonce: String(parsed.args.resultNonce),
        finalizationStatus: Number(parsed.args.finalizationStatus),
        sourceChainId: String(parsed.args.sourceChainId),
        finalizedAt: String(parsed.args.finalizedAt),
        deadline: String(parsed.args.deadline),
      };
    } catch {
      // Ignore unrelated logs; the expected event is required below.
    }
  }
  throw new Error('MatchFinalized event not found for the expected source contract');
}

export const rpsMatchFinalizedAdapter = createRpsAdapter(decodeRpsMatchFinalized);

export function createRpsAdapter(decoder: (receipt: { status: number | null; logs: readonly unknown[] }, sourceContract: string) => RpsMatchResult): SourceResultAdapter<RpsMatchResult> {
  return {
    name: 'TournamentResultRegistry/RPS',
    eventSignature: RPS_MATCH_FINALIZED_SIGNATURE,
    decode: decoder,
    businessKey: (result) => `${result.tournamentId}:${result.resultNonce}`,
  };
}

export function proofToQuery(proof: ProofData) {
  return {
    chainKey: proof.chainKey,
    blockHeight: proof.headerNumber,
    encodedTransaction: proof.txBytes,
    merkleRoot: proof.merkleProof.root,
    siblings: proof.merkleProof.siblings,
    lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest,
    continuityRoots: proof.continuityProof.roots,
  } as const;
}
