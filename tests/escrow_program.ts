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
  });

  // Mint
  describe("Initialize Escrow Tests", async () => {
    it("Check if tokens accounts have tokens", async () => {
      const userATokenAccountInfo = await getAccount(
        provider.connection,
        userATokenAccount
      );

      expect(Number(userATokenAccountInfo.amount)).to.be.equal(
        10 * DECIMAL_FACTOR
      );

      const userBTokenAccountInfo = await getAccount(
        provider.connection,
        userBTokenAccount
      );

      expect(Number(userBTokenAccountInfo.amount)).to.be.equal(
        10 * DECIMAL_FACTOR
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
    });
  });
});
