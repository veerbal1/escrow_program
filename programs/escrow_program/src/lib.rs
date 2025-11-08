use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, Token, TokenAccount},
    token_2022::spl_token_2022::pod::PodAccount,
};

#[error_code]
pub enum ErrorCode {
    #[msg("Deadline should be greater than 24 hours")]
    InvalidDeadline,

    #[msg("Amount must be greater than 0")]
    AmountMustBePositive,
}

declare_id!("AsUjRV671ni3WY4NeppvNNMqTHCof8pP5rkTb3ytXvTV");

#[program]
pub mod escrow_program {
    use super::*;

    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        amount_a: u64,
        amount_b: u64,
        deadline: i64,
    ) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let ten_minutes_buffer: i64 = 10 * 60;

        require!(
            deadline > current_time + ten_minutes_buffer,
            ErrorCode::InvalidDeadline
        );

        require!(amount_a > 0, ErrorCode::AmountMustBePositive);
        require!(amount_b > 0, ErrorCode::AmountMustBePositive);

        let escrow_account = &mut ctx.accounts.escrow;
        escrow_account.user_a = ctx.accounts.user_a.key();
        escrow_account.user_b = ctx.accounts.user_b.key();

        escrow_account.user_a_mint = ctx.accounts.user_a_mint.key();
        escrow_account.user_b_mint = ctx.accounts.user_b_mint.key();

        escrow_account.deadline = deadline;

        escrow_account.amount_a = amount_a;
        escrow_account.amount_b = amount_b;

        escrow_account.a_deposited = false;
        escrow_account.b_deposited = false;

        escrow_account.bump = ctx.bumps.escrow;
        escrow_account.vault_a_bump = ctx.bumps.vault_a;
        escrow_account.vault_b_bump = ctx.bumps.vault_b;

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub user_a: Pubkey,
    pub user_b: Pubkey,

    pub user_a_mint: Pubkey,
    pub user_b_mint: Pubkey,

    pub amount_a: u64,
    pub amount_b: u64,

    pub deadline: i64,

    pub a_deposited: bool,
    pub b_deposited: bool,

    pub bump: u8,
    pub vault_a_bump: u8,
    pub vault_b_bump: u8,
}

impl Escrow {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

#[derive(Accounts)]
pub struct InitializeEscrow<'i> {
    #[account(init, seeds=[b"escrow", user_a.key().as_ref(), user_b.key().as_ref()], bump, payer = user_a, space = Escrow::LEN)]
    pub escrow: Account<'i, Escrow>,

    #[account(mut)]
    pub user_a: Signer<'i>,

    /// CHECKED Just a normal public key
    pub user_b: AccountInfo<'i>,

    pub user_a_mint: Account<'i, Mint>,
    pub user_b_mint: Account<'i, Mint>,

    // Token Accounts - Program Vault
    #[account(init, seeds=[b"vault_a", escrow.key().as_ref(), user_a_mint.key().as_ref()], bump, payer = user_a, token::mint = user_a_mint, token::authority = escrow)]
    pub vault_a: Account<'i, TokenAccount>,
    #[account(init, seeds=[b"vault_b", escrow.key().as_ref(), user_b_mint.key().as_ref()], bump, payer = user_a, token::mint = user_b_mint, token::authority = escrow)]
    pub vault_b: Account<'i, TokenAccount>,

    pub system_program: Program<'i, System>,
    pub token_program: Program<'i, Token>,
}
