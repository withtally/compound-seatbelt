# Compound Governor Implementation for Seatbelt

This document explains the custom modifications required to make governance-seatbelt work with the new Compound Governor, which uses ERC-7201 namespaced storage.

## Problem Statement

The new Compound Governor contract uses OpenZeppelin's upgradeable contracts with **ERC-7201 namespaced storage**. Tenderly's state override encoding API does not support this storage pattern, causing simulations to fail with "Transaction reverted with no reason provided."

### Why Traditional Approaches Failed

In traditional (non-upgradeable) contracts like GovernorBravo, storage slots are assigned sequentially:

```solidity
contract GovernorBravo {
    address public admin;                    // slot 0
    mapping(uint => Proposal) proposals;     // slot 2
    uint public proposalCount;               // slot 3
}
```

Tenderly can encode these because it knows `proposals` is at slot 2.

However, the new Compound Governor uses **pseudo-random namespace locations**:

```solidity
abstract contract GovernorUpgradeable {
    // Computed namespace, not sequential slot
    bytes32 private constant GovernorStorageLocation =
        0x7c712897014dbe49c045ef1299aa2d5f9e67e48eea4403efa21f1e0f3ac0cb00;

    struct GovernorStorage {
        string _name;
        mapping(uint256 => ProposalCore) _proposals;  // NOT at slot 2!
    }
}
```

When we sent named storage locations like `_proposals[487].proposer` to Tenderly, it returned an empty object `{}` because it couldn't compute the namespaced slots.

## Solution Architecture

### 1. Manual Storage Slot Computation

Created `getCompoundGovernorSlots()` in `utils/clients/tenderly.ts` (lines 1025-1074) that manually computes ERC-7201 storage slots.

**Key namespace locations from Compound Governor contracts:**

```typescript
const GOVERNOR_STORAGE_LOCATION =
  BigInt('0x7c712897014dbe49c045ef1299aa2d5f9e67e48eea4403efa21f1e0f3ac0cb00');
const COUNTING_FRACTIONAL_STORAGE_LOCATION =
  BigInt('0xd073797d8f9d07d835a3fc13195afeafd2f137da609f97a44f7a3aa434170800');
const SEQUENTIAL_PROPOSAL_ID_STORAGE_LOCATION =
  BigInt('0x357e1d0c89980520b3654c57f444238d75a15e5f41d389a090caabe54617d800');
```

**Storage slot formula:**
```typescript
// For mapping at offset N within namespace
const mappingSlot = NAMESPACE_LOCATION + N;

// For specific key in mapping
const slot = keccak256(encodeAbiParameters(
  [{ type: 'uint256' }, { type: 'uint256' }],
  [key, mappingSlot]
));
```

### 2. Custom Governor State Override Builder

Created `buildCompoundGovernorStateOverrides()` (lines 1076-1118) that:

1. Computes storage slots for the proposal
2. Packs the `ProposalCore` struct across 2 slots
3. Sets vote counts in `_proposalVotes` mapping
4. Sets `descriptionHash` in `_proposalDetails` mapping (required by GovernorSequentialProposalId)

**Critical struct packing details:**

```solidity
struct ProposalCore {
    address proposer;      // 160 bits
    uint48 voteStart;      // 48 bits
    uint32 voteDuration;   // 32 bits
    bool executed;         // 8 bits
    bool canceled;         // 8 bits
    // ↑ Total: 256 bits (Slot 0)

    uint48 etaSeconds;     // 48 bits (Slot 1)
}
```

### 3. Hybrid Encoding Approach

Since we need both manual slots (governor) and Tenderly encoding (timelock):

```typescript
// Encode timelock storage via Tenderly API (works fine)
const encodedTimelockStorage = await sendEncodeRequest(timelockStateOverrides);

// Combine with manual governor slots
const storageObj = {
  stateOverrides: {
    [timelock.address.toLowerCase()]: encodedTimelockStorage.stateOverrides[...],
    [governor.address.toLowerCase()]: {
      value: governorStateOverrides,  // Raw hex slots
    },
  },
};
```

### 4. Simplified Compound-Specific Path

Modified `simulate()` (line 127) to always route to `simulateProposedCompound()` for `type: 'proposed'`, which:

- Hard-codes `governorType = 'oz'` (no inference needed)
- Removes all Bravo-specific conditionals
- Uses only OZ-style ABIs and execution patterns

### 5. Removed Governor Type Inference

To avoid ugly `initialProposalId` revert errors, we hard-coded the governor type in:

- `run-checks.ts` (line 149)
- `index.ts` (lines 206, 251)

```typescript
// Instead of:
const governorType = await inferGovernorType(GOVERNOR_ADDRESS);

// We use:
const governorType = 'oz' as const;
```

## Files Modified

### Core Implementation
- **`utils/clients/tenderly.ts`** (lines 125-264, 1016-1118)
  - `simulate()` - Routes to Compound-specific function
  - `simulateProposedCompound()` - Main simulation logic
  - `getCompoundGovernorSlots()` - ERC-7201 slot computation
  - `buildCompoundGovernorStateOverrides()` - Manual state override builder

### Type Inference Removal
- **`run-checks.ts`** (lines 23, 149-150)
- **`index.ts`** (lines 27, 206-207, 251-252)

## Generalizing for Other Upgraded OZ DAOs

To adapt this approach for other DAOs using ERC-7201 storage:

### Step 1: Identify Storage Namespace Locations

Look in the DAO's governor contract source for storage location constants:

```solidity
// Example from GovernorUpgradeable.sol
bytes32 private constant GovernorStorageLocation =
    keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.Governor")) - 1))
    & ~bytes32(uint256(0xff));
```

Common OpenZeppelin namespaces to look for:
- `openzeppelin.storage.Governor` - Core governor storage
- `openzeppelin.storage.GovernorCountingSimple` or `GovernorCountingFractional` - Vote counting
- `openzeppelin.storage.GovernorTimelockControl` or `GovernorTimelockCompound` - Timelock integration

**Finding the computed value:**
1. Check the contract source code for the constant value
2. Or compute it yourself using the namespace string:
   ```typescript
   const namespace = "openzeppelin.storage.Governor";
   const location = BigInt(keccak256(toBytes(namespace))) - 1n;
   const storageLocation = location & ~BigInt(0xff);
   ```

### Step 2: Map Storage Layout

Determine which mappings/variables are at which offsets within each namespace:

```solidity
struct GovernorStorage {
    string _name;                                    // offset 0
    mapping(uint256 => ProposalCore) _proposals;     // offset 1
    DoubleEndedQueue.Bytes32Deque _governanceCall;   // offset 2
}
```

### Step 3: Understand Struct Packing

Examine the structs to understand how fields are packed:

```solidity
struct ProposalCore {
    address proposer;      // 20 bytes
    uint48 voteStart;      // 6 bytes
    uint32 voteDuration;   // 4 bytes
    bool executed;         // 1 byte
    bool canceled;         // 1 byte
    // = 32 bytes (1 slot)

    uint48 etaSeconds;     // 6 bytes (next slot)
}
```

**Packing rules:**
- Solidity packs variables sequentially until a slot (32 bytes) is full
- New variables that don't fit start a new slot
- Arrays and mappings always start a new slot

### Step 4: Create Custom Slot Computation Function

```typescript
function getCustomGovernorSlots(proposalId: bigint) {
  // Define namespace locations from contract
  const YOUR_GOVERNOR_STORAGE = BigInt('0x...');
  const YOUR_VOTING_STORAGE = BigInt('0x...');

  // Calculate mapping slots (namespace + offset)
  const proposalsMapSlot = YOUR_GOVERNOR_STORAGE + 1n; // if _proposals is at offset 1

  // Compute slot for specific proposal
  const proposalSlot = keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [proposalId, proposalsMapSlot]
  ));

  return {
    // Return slots for all fields you need to override
    proposalSlot,
    voteSlot: toHex(BigInt(anotherNamespace) + offset),
    // etc...
  };
}
```

### Step 5: Implement Custom State Override Builder

```typescript
function buildCustomGovernorStateOverrides(params) {
  const slots = getCustomGovernorSlots(proposalId);

  // Pack structs according to your governor's layout
  const packed =
    (field1 << 0n) |
    (field2 << 160n) |
    (field3 << 208n);

  return {
    [slots.proposalSlot]: toHex(packed, { size: 32 }),
    [slots.voteSlot]: toHex(votes, { size: 32 }),
    // etc...
  };
}
```

### Step 6: Route to Custom Function

```typescript
export async function simulate(config: SimulationConfig) {
  if (config.type === 'executed') return await simulateExecuted(config);

  // Route to your custom simulation function
  if (config.daoName === 'YourDAO') {
    return await simulateProposedYourDAO(config);
  }

  if (config.type === 'proposed') return await simulateProposed(config);
  return await simulateNew(config);
}
```

## Testing Strategy

### Verify Storage Slots Are Correct

1. **Test with intentional failures** - Set `executed = true` in overrides and verify you get a specific error (not "no reason")
2. **Compare with on-chain data** - For executed proposals, compare your computed slots with actual on-chain storage
3. **Check struct packing** - Ensure multi-field structs pack correctly (use a debugger or print hex values)

### Validation Checklist

- [ ] State changes check passes (not "reverted with no reason")
- [ ] Correct proposal state returned (Queued, not Nonexistent)
- [ ] Vote counts properly set
- [ ] Timelock transactions marked as queued
- [ ] ETA set correctly
- [ ] No "initialProposalId" errors

## Key Takeaways

1. **ERC-7201 uses pseudo-random storage locations**, not sequential slots
2. **Tenderly's encoding API can't handle namespaced storage** - must compute manually
3. **Storage slot formula**: `keccak256(key . (namespace + offset))`
4. **Hybrid approach works**: Manual slots for governor, Tenderly encoding for timelock
5. **Each upgradeable module has its own namespace** - must handle all relevant namespaces
6. **Struct packing matters** - must pack fields exactly as Solidity does

## Resources

- [EIP-7201: Namespaced Storage Layout](https://eips.ethereum.org/EIPS/eip-7201)
- [OpenZeppelin Upgradeable Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable)
- [Solidity Storage Layout](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html)
- Compound Governor contracts: `local_ignored/contracts/governor/`

## Troubleshooting

**Simulation still fails with "no reason":**
- Verify namespace locations match contract source
- Check struct packing (print hex values to debug)
- Ensure all required storage slots are set (especially `descriptionHash` for GovernorSequentialProposalId)

**Wrong proposal state returned:**
- Check `voteStart` and `voteDuration` calculations
- Verify `executed` and `canceled` flags are correct
- Ensure `etaSeconds` is non-zero

**Timelock errors:**
- Verify transaction hashes are computed correctly
- Check that `queuedTransactions[hash]` is set to `true`
- For OZ timelocks, ensure `_timestamps[id]` is set
