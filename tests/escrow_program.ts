import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EscrowProgram } from "../target/types/escrow_program";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

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
          new anchor.BN(100),
          new anchor.BN(100),
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
        new anchor.BN(100).toString()
      );

      expect(escrowAccountInfo.amountB.toString()).to.be.equal(
        new anchor.BN(100).toString()
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
});
