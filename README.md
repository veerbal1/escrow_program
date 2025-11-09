# Escrow Program: Trustless Token Swaps

A Solana smart contract implementing atomic token swaps using the **escrow pattern** - the foundational architecture for custody, conditions, and release mechanisms used across all DeFi protocols.

## Overview

This escrow program enables two parties (User A and User B) to trustlessly swap tokens. Neither party needs to trust each other - the smart contract guarantees:

- **All-or-nothing execution**: Both deposits happen → both transfers happen. One fails → everything reverts.
- **Custody safety**: Tokens are held in program-owned PDAs (Program Derived Accounts), not in any user's wallet
- **Time-bound protection**: If the swap doesn't complete by the deadline, either user can refund their deposit
- **Atomic operations**: Token transfers are processed via CPI (Cross-Program Invocation) to the SPL Token Program

## Architecture

### Account Structure

```
┌─────────────────────────────────────────────────────────────┐
│                  Escrow Program                             │
└─────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────┐
│   Escrow PDA             │
├──────────────────────────┤
│ • user_a: PublicKey      │
│ • user_b: PublicKey      │
│ • amount_a: u64          │
│ • amount_b: u64          │
│ • a_deposited: bool      │
│ • b_deposited: bool      │
│ • deadline: i64          │
│ • bump: u8               │
│ • vault_a_bump: u8       │
│ • vault_b_bump: u8       │
└──────────────────────────┘
      ↙              ↖
   Vault A        Vault B
   (PDA owned)    (PDA owned)

   Holds tokens    Holds tokens
   from User A     from User B
```

### PDAs (Program Derived Addresses)

**Escrow PDA:**
- Seeds: `[b"escrow", user_a_pubkey, user_b_pubkey]`
- Stores escrow state: amounts, flags, deadline, bumps

**Vault A PDA:**
- Seeds: `[b"vault_a", escrow_pda, user_a_mint]`
- Token account owned by Escrow PDA
- Holds User A's tokens during swap

**Vault B PDA:**
- Seeds: `[b"vault_b", escrow_pda, user_b_mint]`
- Token account owned by Escrow PDA
- Holds User B's tokens during swap

## Workflow

### 1. Initialize Escrow

**Caller**: User A (initiator)

```
initializeEscrow(amount_a, amount_b, deadline)
```

**What happens:**
- Creates Escrow PDA with state
- Creates Vault A and Vault B token accounts (both program-owned)
- Sets deposit flags to `false`
- Stores amounts and deadline

**Constraints:**
- Deadline must be at least 10 minutes in the future
- User A's mint ≠ User B's mint

### 2. Deposit Phase

**User A Deposits:**
```
deposit(amount_a)
```
- Transfers `amount_a` tokens from User A's token account → Vault A
- Sets `a_deposited = true`

**User B Deposits:**
```
deposit(amount_b)
```
- Transfers `amount_b` tokens from User B's token account → Vault B
- Sets `b_deposited = true`

**Key properties:**
- Either user can deposit at any time (order doesn't matter)
- Once both have deposited, execute can be called
- Deposits are irreversible unless deadline passes

### 3. Execute (Happy Path)

**Caller**: Anyone (typically User A or User B, but permissionless)

```
execute()
```

**What happens:**
1. Verifies both users have deposited
2. Transfers Vault A tokens → User B's token account
3. Transfers Vault B tokens → User A's token account
4. Closes both vaults (reclaims rent to User A)
5. Closes escrow account (reclaims rent to User A)

**Result:** Atomic swap is complete. Both users have their desired tokens.

### 4. Refund (Emergency Path)

**Caller**: User A or User B only

```
refund()
```

**Requirements:**
- Deadline must have passed
- Caller must be User A or User B

**What happens:**
1. If User A deposited: transfers Vault A tokens back to User A
2. If User B deposited: transfers Vault B tokens back to User B
3. Closes both vaults and escrow account

**Result:** Both users get their original tokens back. Swap is cancelled.

## Security Considerations

### 1. **PDA Ownership & Authority**

```rust
// Vaults are owned by the Escrow PDA, not the program
#[account(..., token::authority = escrow)]
pub vault_a: Account<'info, TokenAccount>,
```

- Only the Escrow PDA can authorize transfers from the vaults
- Enforced by SPL Token Program constraints
- No single user can steal funds

### 2. **Signer Seeds for CPI**

```rust
let signer_seeds: &[&[&[u8]]] =
    &[&[b"escrow", user_a_key.as_ref(), user_b_key.as_ref(), &[bump]]];

let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.token_program.to_account_info(),
    transfer,
    signer_seeds,
);
```

- Escrow PDA signs token transfers via CPI
- Seeds are deterministic and can't be spoofed
- Ensures only this program can move vault tokens

### 3. **Atomicity**

- Execute is all-or-nothing: if any transfer fails, the entire transaction reverts
- Solana's transaction model guarantees this
- No partial state inconsistencies possible

### 4. **Deadline Protection**

```rust
require!(current_time > escrow.deadline, ErrorCode::DeadlineNotPassed);
```

- If swap doesn't execute within deadline, refund becomes available
- Prevents tokens from being locked forever
- Users must set adequate deadline (minimum: 10 minutes)

### 5. **Permission Checks**

- **deposit()**: Caller must own the token account being transferred from
- **execute()**: Permissionless (caller doesn't matter)
- **refund()**: Only User A or User B can call

### 6. **Mint Validation**

- Token accounts are constrained to specific mints
- Prevents wrong token type being deposited
- All account constraints verified by Anchor framework

## Test Coverage

**24 comprehensive tests** covering:

### Initialize Tests (4)
- Token accounts have correct balances
- Escrow initialized with valid parameters
- Same mint rejection
- Vault PDA creation and ownership

### Deposit Tests (9)
- User A deposits correct amount
- User B deposits correct amount
- Token transfers verified
- Deposit flags set correctly
- Vault balances match escrow amounts
- Both users can deposit

### Execute Tests (9)
- Successful swap after both deposit
- Vault A tokens transferred to User B
- Vault B tokens transferred to User A
- Both users receive correct amounts
- Vaults closed after execute
- Escrow account closed
- Rent returned to User A

### Refund Tests (2)
- Refund fails if deadline hasn't passed
- Refund fails if unauthorized caller

**Run tests:**
```bash
anchor test
```

## Usage

### Setup

```bash
# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Install dependencies
npm install
```

### Build

```bash
anchor build
```

### Test

```bash
anchor test
```

### Deploy

```bash
anchor deploy
```

## Key DeFi Applications

This escrow pattern powers:

| Use Case | How It Works |
|----------|--------------|
| **Lending** | User locks collateral (escrow), borrows stablecoin (release) |
| **Perpetual Futures** | Trader deposits margin (escrow), can trade with leverage |
| **Staking** | User locks tokens (escrow), earns rewards over time |
| **OTC Swaps** | Two parties agree on exchange (escrow), atomic execution |
| **NFT Marketplaces** | Buyer deposits payment (escrow), seller confirms receipt |
| **Options Trading** | Seller deposits collateral (escrow), option can be exercised |

## Design Patterns Used

1. **PDA-Based State Management**: Account data stored in PDAs, derived deterministically
2. **Program-Owned Accounts**: Token vaults owned by program (not user), preventing unauthorized access
3. **CPI (Cross-Program Invocation)**: Secure interaction with SPL Token Program
4. **Rent Reclamation**: Closing accounts returns SOL to designated recipient
5. **Time-Based Conditions**: Deadline enables refund mechanism
6. **All-or-Nothing Execution**: Single transaction atomicity

## Edge Cases Handled

✅ What if User A deposits but User B never does?
- Refund available after deadline

✅ What if both deposits happen but network fails before execute?
- Refund available after deadline

✅ What if execute is called multiple times?
- Not possible: vaults already closed after first execute

✅ What if token supply is problematic?
- SPL Token Program validates all transfers

✅ What if someone tries to drain a vault directly?
- Only Escrow PDA can authorize transfers (enforced by token program)

## Gas Optimization Notes

- PDA seeds are deterministic (no state queries needed)
- Minimal account touches (5 accounts + token program)
- No loops or complex computations
- Token program handles expensive transfer logic

## Future Enhancements

- [ ] Multi-token swaps (more than 2 tokens)
- [ ] Conditional execution (oracle price feeds, signature verification)
- [ ] Fee mechanism (protocol cut on successful execution)
- [ ] Escrow cancellation (before deadline, with both signatures)
- [ ] Partial fills (flexible amount swaps)
- [ ] Timeout auto-refund (execute refund via anyone after deadline)

## Security Audit Notes

For production deployment, consider:

- [ ] Formal verification of CPI calls
- [ ] Reentrancy analysis (CPI guards)
- [ ] Overflow/underflow checks (Rust u64 arithmetic)
- [ ] Arithmetic precision (token decimal handling)
- [ ] Account ownership validation
- [ ] Missing signature checks

## Resources

- [Anchor Book](https://book.anchor-lang.com/)
- [Solana Program Library (SPL)](https://github.com/solana-labs/solana-program-library)
- [PDA Guide](https://docs.solana.com/developing/programming-model/calling-between-programs#program-derived-addresses)
- [CPI Best Practices](https://docs.solana.com/developing/programming-model/calling-between-programs)

## Summary

This escrow program demonstrates:

✅ **Trustless execution** - No intermediary needed
✅ **Atomic swaps** - All-or-nothing guarantee
✅ **Secure custody** - Program-owned accounts prevent theft
✅ **Time-bound safety** - Deadline protection prevents lock-in
✅ **DeFi fundamentals** - Core pattern used across the ecosystem

Perfect starting point for understanding how DeFi protocols handle custody, conditions, and releases.
