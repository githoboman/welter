# Git publication audit

Snapshot: 2026-09-13. Scope: public deployment preparation, stopping before any commit, push, external project or blockchain write.

## Result

**FAIL — do not publish yet.** The local directory has no usable Git metadata, and the dependency audit has unresolved
compiler-toolchain advisories. Packaging and service supervision have been implemented; their scoped evidence and residual
issues are recorded in [PUBLIC-PREPARATION-REPORT.md](PUBLIC-PREPARATION-REPORT.md).

## Exact Git observations

The target supplied by the owner is https://github.com/unifyWeb3/prizerail.
Read-only `git ls-remote --symref https://github.com/unifyWeb3/prizerail.git HEAD 'refs/heads/*'` returned exit 0 with no refs.
GitHub repository metadata reports `private=false`, `size=0`, `default_branch=main`. The target is empty at this snapshot:
there is no remote commit or tree to diff. No local implementation file is currently represented by an advertised remote ref.

Local `.git/` is an empty read-only directory. The same Git failures were verified outside the sandbox, so this is not just
a restricted-shell visibility assumption.

| Item | Observed state |
|---|---|
| Current branch | None available; `git branch --show-current` fails |
| HEAD | Unusable; `git rev-parse --verify HEAD` fails |
| Configured remotes | None available; `git remote -v` fails |
| Tracked/untracked status | Cannot be classified without an index; `git status --short` fails |
| Git-ignored file status | Cannot be queried through Git; filesystem inventory respects .gitignore via `rg --no-require-git` |
| Exact patch against local HEAD | Unavailable because HEAD does not exist |
| Remote comparison | Empty repository; no commit base and no advertised branch refs |

The changed-file inventory is a record of this preparation's edits, not a fabricated Git diff.

## Exact publication candidates

[PUBLICATION-FILES.txt](PUBLICATION-FILES.txt) is the explicit relative-path inventory to review and stage. It includes source,
tests, documentation, package manifests, .env.example, .gitignore, vendored Solidity source and reviewed historical evidence.
Do not substitute `git add .` or a recursive directory glob for that inventory.

All 14 current evidence JSON files remain eligible as public historical artifacts, including the current-deployment selector
needed by backend startup and the default verifier's historical files. The two worker artifacts contain portable, curated
historical journal snapshots and relative local-path labels. They are deliberately retained as judge evidence; they are not
the mutable runtime .data journal or proof cache. Public transaction hashes, query hashes and deployed addresses are not
credentials. Only the three UI-required evidence files are copied to the browser output.

## Keep local

`.env` and every real key/mnemonic/provider credential; `.data/` and live worker journals/proof caches; `node_modules/`;
`artifacts/`, `out/`, `cache/`, `coverage/`; `frontend/dist/`, `frontend/evidence/`, `frontend/public/`;
`lib/openzeppelin-contracts/build/` (vendored generated compiler output); `.vercel/`, `.render/`; logs, databases,
private proof material, temporary test artifacts, and machine-specific operator configuration. .env.example is the explicit
safe exception to the .env pattern. Generated browser output is deployed by the build provider but is not committed.

No private file was deleted or rewritten. Existing runtime journals and immutable evidence remain in place.

## Secret and security checks

`node scripts/publication-scan.mjs` enumerates candidates through .gitignore, rejects suspicious private filenames and
non-regular files, checks against actual local credential values without printing them, and creates a temporary scan snapshot.
It also checks those values against all seven browser output files. This is a filesystem scan, not a history scan.

Gitleaks 8.30.1 was downloaded from its official release and checked against its published SHA-256:
`551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.
The initial default-rules source scan reported 80 candidates: 57 token-address occurrences, 21 public source-query hashes,
and two recorded API source-file hashes. The browser scan reported three token-address occurrences. All were individually
classified using their original file/line context; no rule was disabled and no evidence was rewritten. Raw Gitleaks exit
status was 1 because it reports these public values; the reviewed secret assessment is distinct from that raw exit status.
The final scan counts and inventory are recorded in the preparation report.
The completed inventory contains 523 existing files. The final default-rules scan reported 81 source findings (58 token
addresses, 21 query hashes, two file hashes) and three browser token-address findings, with no unclassified finding remaining.

The build uses a seven-file output allowlist and explicit public environment injection. It rejects missing, invalid, or
secret-marker-bearing evidence and unexpected output files. A sentinel server secret was not emitted into the test bundle.
These scans do not prove arbitrary future values are safe; rerun them after changing deployment configuration.

`npm audit` reports one low and one high finding through the development compiler's tmp dependency.
`npm audit --omit=dev` reports zero runtime dependency findings. Because the Render build installs development dependencies
to compile artifacts, the compiler finding still applies to its build environment. No automatic dependency fix was run.
Solidity lint and boundary/fuzz tests are recorded in the preparation report; no independent security audit is claimed.

## Recommended non-destructive publication procedure

After separate publication authorization:

1. Re-query the target's refs and metadata. If it is no longer empty, clone it into a new sibling directory and review the
   new remote history before transferring the approved inventory. Do not force-push.
2. Preserve this worktree and local .env/.data. Use a fresh clone of the verified target in a new directory, or restore the
   intended Git metadata if an existing history is supplied. Do not reset, clean, or replace broad paths.
3. Copy only the approved inventory into that checkout; keep .env, runtime state, caches and generated output out.
4. Review `git status --short --untracked-files=all`, `git status --short --ignored`, `git ls-files`, and
   `git ls-files --others --exclude-standard`. A .gitignore entry does not untrack a file already in the index.
5. Run the build/test/secret checks there, then stage the explicit inventory. Inspect `git diff --cached --stat`,
   `git diff --cached --name-status`, `git diff --cached --check`, and the full staged patch. Since the target is currently
   empty, this would be an initial implementation commit, not a small patch atop remote source.
6. Create the reviewed commit on `main` (the target's reported default) only when authorized. Before any push, recheck
   `git remote get-url origin` and remote refs, inspect `git push --dry-run origin main`, then request/confirm the separately
   authorized publication step. Push the explicit branch without force.

No step above was executed as a mutation in this session.
