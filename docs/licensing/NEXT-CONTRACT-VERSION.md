# Switching the contract to BUSL 1.1 (staged for the next contract version)

**Status:** prepared on 2026-11-04, **not applied**. Today's `contracts/HeldArbiter.sol` and its tests stay MIT.

**Why not now:** the server accepts a merchant only if their contract matches the genuine HeldArbiter bytecode
(`server/merchants.ts`), and the compiled bytecode embeds a hash of the source, comments included. Changing only the
header would produce new bytecode that needs a new deployment for every merchant. So the switch ships with the next real
contract change, in that same release.

**What stays MIT:** every version already published as MIT stays MIT for good (including the forks and Portunus's copy).
BUSL only covers the new version onward.

## The header

Replace the first line of `contracts/HeldArbiter.sol`, `test/HeldArbiter.t.sol` and `test/HeldArbiter.invariant.t.sol`
(`// SPDX-License-Identifier: MIT`) with:

```solidity
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Emil Bob. All rights reserved.
// Licensed under the Business Source License 1.1: see contracts/LICENSE (Change Date <YYYY-MM-DD>, then GPL-2.0-or-later).
// Production use is allowed only through Held (getheld.xyz); reading, auditing and testing are free.
```

`BUSL-1.1` is a valid SPDX identifier, so solc accepts it.

## Release checklist

1. Make the real contract change, then swap the header above into the three files.
2. Copy `docs/licensing/BUSL-1.1.txt` to `contracts/LICENSE`. Delete its "STAGED" lines at the top, then fill in:
   - **Licensed Work version:** the new contract version (e.g. v5);
   - **Change Date:** three years after the first deployment, the same date in the license and in the header.
3. `grep -rn "<VERSION>\|<YYYY-MM-DD>" contracts test` must print nothing.
4. Rebuild the bytecode (`scripts/compile.ts`), update the genuine-bytecode check in `server/merchants.ts`, run the forge
   tests and the merchant e2e, as for any contract version.
5. The root `LICENSE` already says files with their own license header follow that header, so it needs no change.
6. Optional: one line in the FAQ ("The contract source is public under the Business Source License: anyone can read and
   verify it").

Check the final wording with a lawyer before the release.
