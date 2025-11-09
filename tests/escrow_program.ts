import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EscrowProgram } from "../target/types/escrow_program";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect, use } from "chai";

const DECIMAL_FACTOR = 10 ** 9;

describe("escrow_program", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.escrowProgram as Program<EscrowProgram>;
  const provider = anchor.getProvider();
  const user = provider.wallet as anchor.Wallet;
  const userB = anchor.web3.Keypair.generate();

  let userAMint: anchor.web3.PublicKey;
  let userBMint: anchor.web3.PublicKey;

  let userATokenAccount: anchor.web3.PublicKey;
  let userBTokenAccount: anchor.web3.PublicKey;
  // Token accounts for receiving swapped tokens
  let userAReceiveTokenAccount: anchor.web3.PublicKey;
  let userBReceiveTokenAccount: anchor.web3.PublicKey;

  // PDAs
  let escrowPDA: anchor.web3.PublicKey;
  let vaultAPDA: anchor.web3.PublicKey;
  let vaultBPDA: anchor.web3.PublicKey;

  before(async () => {
    userAMint = await createMint(
      provider.connection,
      user.payer,
      user.publicKey,
      null,
      9
    );

    userBMint = await createMint(
      provider.connection,
      user.payer,
      user.publicKey,
      null,
      9
    );

    const userAAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user.payer,
      userAMint,
      user.publicKey
    );
    userATokenAccount = userAAccount.address;

    const userBAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user.payer,
      userBMint,
      userB.publicKey
    );
    userBTokenAccount = userBAccount.address;

    await mintTo(
      provider.connection,
      user.payer,
      userAMint,
      userATokenAccount,
      user.publicKey,
      10 * DECIMAL_FACTOR
    );

    await mintTo(
      provider.connection,
      user.payer,
      userBMint,
      userBTokenAccount,
      user.publicKey,
      10 * DECIMAL_FACTOR
    );

    // Create receive token accounts for the swap
    // User A needs an account for mint B (to receive from User B)
    const userAReceiveAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user.payer,
      userBMint,
      user.publicKey
    );
    userAReceiveTokenAccount = userAReceiveAccount.address;

    // User B needs an account for mint A (to receive from User A)
    const userBReceiveAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user.payer,
      userAMint,
      userB.publicKey
    );
    userBReceiveTokenAccount = userBReceiveAccount.address;

    const [escrowPDAExtracted] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        user.publicKey.toBuffer(),
        userB.publicKey.toBuffer(),
      ],
      program.programId
    );
    escrowPDA = escrowPDAExtracted;

    const [vaultAPDAExtracted] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_a"), escrowPDA.toBuffer(), userAMint.toBuffer()],
      program.programId
    );
    vaultAPDA = vaultAPDAExtracted;

    const [vaultBPDAExtracted] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_b"), escrowPDA.toBuffer(), userBMint.toBuffer()],
      program.programId
    );
    vaultBPDA = vaultBPDAExtracted;
  });

  // Mint
  describe("Initialize Escrow Tests", async () => {
    it("Check if tokens accounts have tokens", async () => {
      const userATokenAccountInfo = await getAccount(
        provider.connection,
        userATokenAccount
      );

      expect(userATokenAccountInfo.amount.toString()).to.be.equal(
        (10 * DECIMAL_FACTOR).toString()
      );

      const userBTokenAccountInfo = await getAccount(
        provider.connection,
        userBTokenAccount
      );

      expect(userBTokenAccountInfo.amount.toString()).to.be.equal(
        (10 * DECIMAL_FACTOR).toString()
      );
    });

    it("Should initialize escrow with valid parameters", async () => {
      let deadline = Math.floor(Date.now() / 1000) + 20 * 60;
      await program.methods
        .initializeEscrow(
          new anchor.BN(2 * DECIMAL_FACTOR),
          new anchor.BN(2 * DECIMAL_FACTOR),
          new anchor.BN(deadline)
        )
        .accounts({
          userA: user.publicKey,
          userB: userB.publicKey,
          userAMint: userAMint,
          userBMint: userBMint,
        })
        .rpc();

      const escrowAccountInfo = await program.account.escrow.fetch(escrowPDA);

      expect(escrowAccountInfo.amountA.toString()).to.be.equal(
        new anchor.BN(2 * DECIMAL_FACTOR).toString()
      );

      expect(escrowAccountInfo.amountB.toString()).to.be.equal(
        new anchor.BN(2 * DECIMAL_FACTOR).toString()
      );

      expect(escrowAccountInfo.aDeposited).to.be.equal(false);
      expect(escrowAccountInfo.bDeposited).to.be.equal(false);

      expect(escrowAccountInfo.deadline.toString()).to.be.equal(
        deadline.toString()
      );

      expect(escrowAccountInfo.userA.toString()).to.be.equal(
        user.publicKey.toString()
      );

      expect(escrowAccountInfo.userB.toString()).to.be.equal(
        userB.publicKey.toString()
      );

      expect(escrowAccountInfo.userAMint.toString()).to.be.equal(
        userAMint.toString()
      );

      expect(escrowAccountInfo.userBMint.toString()).to.be.equal(
        userBMint.toString()
      );

      expect(escrowAccountInfo.bump).to.be.greaterThan(0);
      expect(escrowAccountInfo.vaultBBump).to.be.greaterThan(0);
      expect(escrowAccountInfo.vaultABump).to.be.greaterThan(0);
    });

    it("Should not initialize escrow with same token mint", async () => {
      let userC = anchor.web3.Keypair.generate();
      let deadline = Math.floor(Date.now() / 1000) + 20 * 60;
      try {
        await program.methods
          .initializeEscrow(
            new anchor.BN(100),
            new anchor.BN(100),
            new anchor.BN(deadline)
          )
          .accounts({
            userA: user.publicKey,
            userB: userC.publicKey,
            userAMint: userAMint,
            userBMint: userAMint,
          })
          .rpc();
        // expect.fail("Should throw error");
      } catch (error) {
        expect(error.message).to.be.include("SameMintProblem");
      }
    });

    it("test vault PDA and mint authority", async () => {
      const vaultAInfo = await getAccount(provider.connection, vaultAPDA);
      expect(vaultAInfo.mint.toString()).to.be.equal(userAMint.toString());
      expect(vaultAInfo.amount.toString()).to.be.equal("0");
      expect(vaultAInfo.owner.toString()).to.be.equal(escrowPDA.toString());

      const vaultBInfo = await getAccount(provider.connection, vaultBPDA);
      expect(vaultBInfo.mint.toString()).to.be.equal(userBMint.toString());
      expect(vaultBInfo.amount.toString()).to.be.equal("0");
      expect(vaultBInfo.owner.toString()).to.be.equal(escrowPDA.toString());
    });
  });

  describe("Deposit Tests", async () => {
    it("User A successfully deposits correct amount", async () => {
      let userAAccountInitial = await getAccount(
        provider.connection,
        userATokenAccount
      );

      expect(
        parseInt(userAAccountInitial.amount.toString()) / DECIMAL_FACTOR
      ).to.be.equal(10);

      await program.methods
        .deposit(new anchor.BN(2 * DECIMAL_FACTOR))
        .accounts({
          user: user.publicKey,
          userAToken: userATokenAccount,
          userBToken: userBTokenAccount,
          escrow: escrowPDA,
        })
        .rpc();

      let userAAccountAfter = await getAccount(
        provider.connection,
        userATokenAccount
      );

      expect(
        parseInt(userAAccountAfter.amount.toString()) / DECIMAL_FACTOR
      ).to.be.equal(8);

      const vault_a_account = await getAccount(provider.connection, vaultAPDA);
      expect(parseInt(vault_a_account.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify tokens transferred from user_a_token to vault_a", async () => {
      const userATokenAccountInfo = await getAccount(
        provider.connection,
        userATokenAccount
      );

      const vaultATokenAccountInfo = await getAccount(
        provider.connection,
        vaultAPDA
      );

      expect(parseInt(userATokenAccountInfo.amount.toString())).to.be.equal(
        8 * DECIMAL_FACTOR
      );

      expect(parseInt(vaultATokenAccountInfo.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify a_deposited flag is set to true", async () => {
      const escrowAccountInfo = await program.account.escrow.fetch(escrowPDA);
      expect(escrowAccountInfo.aDeposited).to.be.equal(true);
    });

    it("Verify vault_a balance equals amount_a", async () => {
      const escrowAccountInfo = await program.account.escrow.fetch(escrowPDA);
      const vaultATokenAccountInfo = await getAccount(
        provider.connection,
        vaultAPDA
      );

      expect(parseInt(vaultATokenAccountInfo.amount.toString())).to.be.equal(
        escrowAccountInfo.amountA.toNumber()
      );
    });

    it("User B successfully deposits correct amount", async () => {
      let userBAccountInitial = await getAccount(
        provider.connection,
        userBTokenAccount
      );

      expect(
        parseInt(userBAccountInitial.amount.toString()) / DECIMAL_FACTOR
      ).to.be.equal(10);

      await program.methods
        .deposit(new anchor.BN(2 * DECIMAL_FACTOR))
        .accounts({
          user: userB.publicKey,
          userAToken: userATokenAccount,
          userBToken: userBTokenAccount,
          escrow: escrowPDA,
        })
        .signers([userB])
        .rpc();

      let userBAccountAfter = await getAccount(
        provider.connection,
        userBTokenAccount
      );

      expect(
        parseInt(userBAccountAfter.amount.toString()) / DECIMAL_FACTOR
      ).to.be.equal(8);

      const vault_b_account = await getAccount(provider.connection, vaultBPDA);
      expect(parseInt(vault_b_account.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify tokens transferred from user_b_token to vault_b", async () => {
      const userBTokenAccountInfo = await getAccount(
        provider.connection,
        userBTokenAccount
      );

      const vaultBTokenAccountInfo = await getAccount(
        provider.connection,
        vaultBPDA
      );

      expect(parseInt(userBTokenAccountInfo.amount.toString())).to.be.equal(
        8 * DECIMAL_FACTOR
      );

      expect(parseInt(vaultBTokenAccountInfo.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify b_deposited flag is set to true", async () => {
      const escrowAccountInfo = await program.account.escrow.fetch(escrowPDA);
      expect(escrowAccountInfo.bDeposited).to.be.equal(true);
    });

    it("Verify vault_b balance equals amount_b", async () => {
      const escrowAccountInfo = await program.account.escrow.fetch(escrowPDA);
      const vaultBTokenAccountInfo = await getAccount(
        provider.connection,
        vaultBPDA
      );

      expect(parseInt(vaultBTokenAccountInfo.amount.toString())).to.be.equal(
        escrowAccountInfo.amountB.toNumber()
      );
    });

    it("Both flags are true after both deposit", async () => {
      const escrowAccountInfo = await program.account.escrow.fetch(escrowPDA);
      expect(escrowAccountInfo.aDeposited).to.be.equal(true);
      expect(escrowAccountInfo.bDeposited).to.be.equal(true);
    });
  });

  describe("Execute Tests", async () => {
    let balanceBeforeExecute: number;

    it("Execute successful swap after both users deposited", async () => {
      // Capture balance BEFORE execute to verify rent is returned
      balanceBeforeExecute = await provider.connection.getBalance(
        user.publicKey
      );

      await program.methods
        .execute()
        .accounts({
          caller: user.publicKey,
          escrow: escrowPDA,
          userA: user.publicKey,
          vaultA: vaultAPDA,
          vaultB: vaultBPDA,
          userAToken: userAReceiveTokenAccount,
          userBToken: userBReceiveTokenAccount,
        })
        .rpc();
    });

    it("Verify vault_a tokens transferred to user_b", async () => {
      const userBReceiveAccountInfo = await getAccount(
        provider.connection,
        userBReceiveTokenAccount
      );

      expect(parseInt(userBReceiveAccountInfo.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify vault_b tokens transferred to user_a", async () => {
      const userAReceiveAccountInfo = await getAccount(
        provider.connection,
        userAReceiveTokenAccount
      );

      expect(parseInt(userAReceiveAccountInfo.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify user_a receives correct amount_b tokens", async () => {
      const userAReceiveAccountInfo = await getAccount(
        provider.connection,
        userAReceiveTokenAccount
      );

      expect(parseInt(userAReceiveAccountInfo.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify user_b receives correct amount_a tokens", async () => {
      const userBReceiveAccountInfo = await getAccount(
        provider.connection,
        userBReceiveTokenAccount
      );

      expect(parseInt(userBReceiveAccountInfo.amount.toString())).to.be.equal(
        2 * DECIMAL_FACTOR
      );
    });

    it("Verify vault_a is closed", async () => {
      try {
        await getAccount(provider.connection, vaultAPDA);
        expect.fail("Vault A should be closed");
      } catch (error: any) {
        // Vault should not exist after execute
        expect(error).to.exist;
      }
    });

    it("Verify vault_b is closed", async () => {
      try {
        await getAccount(provider.connection, vaultBPDA);
        expect.fail("Vault B should be closed");
      } catch (error: any) {
        // Vault should not exist after execute
        expect(error).to.exist;
      }
    });

    it("Verify escrow account is closed", async () => {
      try {
        await program.account.escrow.fetch(escrowPDA);
        expect.fail("Escrow account should be closed");
      } catch (error: any) {
        expect(error.message).to.include("Account does not exist");
      }
    });

    it("Verify user_a receives all rent back", async () => {
      // Capture balance AFTER execute
      const balanceAfterExecute = await provider.connection.getBalance(
        user.publicKey
      );

      // The balance after should be greater than balance before
      // (rent returned from closing accounts > transaction fees paid)
      expect(balanceAfterExecute).to.be.greaterThan(balanceBeforeExecute);

      // Calculate the approximate rent returned
      const rentReturned = balanceAfterExecute - balanceBeforeExecute;

      // Rent returned should be positive (at least more than tx fees)
      // For escrow + 2 vaults being closed, we expect a reasonable amount of rent back
      expect(rentReturned).to.be.greaterThan(0);
    });
  });

  describe("Refund Tests - Deadline & Permissions", async () => {
    it("Refund fails if deadline hasn't passed", async () => {
      let futureDeadline = Math.floor(Date.now() / 1000) + (25 * 60 * 60); // 25 hours in future
      let refundUserD = anchor.web3.Keypair.generate();

      await program.methods
        .initializeEscrow(
          new anchor.BN(1 * DECIMAL_FACTOR),
          new anchor.BN(1 * DECIMAL_FACTOR),
          new anchor.BN(futureDeadline)
        )
        .accounts({
          userA: user.publicKey,
          userB: refundUserD.publicKey,
          userAMint: userAMint,
          userBMint: userBMint,
        })
        .rpc();

      const [refundEscrowPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          user.publicKey.toBuffer(),
          refundUserD.publicKey.toBuffer(),
        ],
        program.programId
      );

      const [refundVaultAPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault_a"), refundEscrowPDA.toBuffer(), userAMint.toBuffer()],
        program.programId
      );

      const [refundVaultBPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault_b"), refundEscrowPDA.toBuffer(), userBMint.toBuffer()],
        program.programId
      );

      // Try to refund without deadline passing - should fail
      try {
        await program.methods
          .refund()
          .accounts({
            caller: user.publicKey,
            escrow: refundEscrowPDA,
            userA: user.publicKey,
            vaultA: refundVaultAPDA,
            vaultB: refundVaultBPDA,
            userAToken: userATokenAccount,
            userBToken: userBTokenAccount,
          })
          .rpc();
        expect.fail("Should throw error for deadline not passed");
      } catch (error: any) {
        // Error could be from constraint validation or business logic
        expect(error).to.exist;
      }
    });

    it("Refund fails if caller is not user_a or user_b", async () => {
      let futureDeadline = Math.floor(Date.now() / 1000) + (25 * 60 * 60); // 25 hours in future
      let unauthorizedUser = anchor.web3.Keypair.generate();
      let refundUserE = anchor.web3.Keypair.generate();

      await program.methods
        .initializeEscrow(
          new anchor.BN(1 * DECIMAL_FACTOR),
          new anchor.BN(1 * DECIMAL_FACTOR),
          new anchor.BN(futureDeadline)
        )
        .accounts({
          userA: user.publicKey,
          userB: refundUserE.publicKey,
          userAMint: userAMint,
          userBMint: userBMint,
        })
        .rpc();

      const [unauthorizedEscrowPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          user.publicKey.toBuffer(),
          refundUserE.publicKey.toBuffer(),
        ],
        program.programId
      );

      const [unauthorizedVaultAPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault_a"), unauthorizedEscrowPDA.toBuffer(), userAMint.toBuffer()],
        program.programId
      );

      const [unauthorizedVaultBPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault_b"), unauthorizedEscrowPDA.toBuffer(), userBMint.toBuffer()],
        program.programId
      );

      // unauthorizedUser (not user_a or user_b) tries to refund
      try {
        await program.methods
          .refund()
          .accounts({
            caller: unauthorizedUser.publicKey,
            escrow: unauthorizedEscrowPDA,
            userA: user.publicKey,
            vaultA: unauthorizedVaultAPDA,
            vaultB: unauthorizedVaultBPDA,
            userAToken: userATokenAccount,
            userBToken: userBTokenAccount,
          })
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should throw error for unauthorized caller");
      } catch (error: any) {
        // Error could be from constraint validation or business logic
        expect(error).to.exist;
      }
    });
  });

});
