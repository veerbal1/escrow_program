use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

#[error_code]
pub enum ErrorCode {
    #[msg("Deadline should be greater than 24 hours")]
    InvalidDeadline,

    #[msg("Amount must be greater than 0")]
    AmountMustBePositive,

    #[msg("Unknown Caller")]
    UnknownCaller,

    #[msg("Already Deposited")]
    AlreadyDeposited,

    #[msg("Wrong Mint")]
    WrongMint,

    #[msg("Token Account Authority Mismatch")]
    TokenAccountAuthorityMismatch,

    #[msg("AmountMismatch")]
    AmountMismatch,
}

declare_id!("AsUjRV671ni3WY4NeppvNNMqTHCof8pP5rkTb3ytXvTV");

#[program]
pub mod escrow_program {

    use anchor_spl::token;

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

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let escrow: &mut Account<'_, Escrow> = &mut ctx.accounts.escrow;
        let caller: Pubkey = ctx.accounts.user.key();

        let is_caller_user_a: bool = caller == escrow.user_a;
        let is_caller_user_b: bool = caller == escrow.user_b;

        require!(
            is_caller_user_a || is_caller_user_b,
            ErrorCode::UnknownCaller
        );

        if is_caller_user_a {
            require!(!escrow.a_deposited, ErrorCode::AlreadyDeposited);

            require!(escrow.amount_a == amount, ErrorCode::AmountMismatch);

            let vault_a = &mut ctx.accounts.vault_a;

            let user_a_token_account = &mut ctx.accounts.user_a_token;
            require!(
                user_a_token_account.mint == escrow.user_a_mint,
                ErrorCode::WrongMint
            );
            require!(
                user_a_token_account.owner == escrow.user_a,
                ErrorCode::TokenAccountAuthorityMismatch
            );

            // CPI
            let cpi_accounts = Transfer {
                from: user_a_token_account.to_account_info(),
                to: vault_a.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };

            let token_program = ctx.accounts.token_program.to_account_info();

            let cpi_context = CpiContext::new(token_program, cpi_accounts);
            escrow.a_deposited = true;
            token::transfer(cpi_context, amount)?;
        } else {
            require!(!escrow.b_deposited, ErrorCode::AlreadyDeposited);

            require!(escrow.amount_b == amount, ErrorCode::AmountMismatch);

            let vault_b = &mut ctx.accounts.vault_b;

            let user_b_token_account = &mut ctx.accounts.user_b_token;

            require!(
                user_b_token_account.mint == escrow.user_b_mint,
                ErrorCode::WrongMint
            );

            require!(
                user_b_token_account.owner == escrow.user_b,
                ErrorCode::TokenAccountAuthorityMismatch
            );

            let cpi_accounts = Transfer {
                from: user_b_token_account.to_account_info(),
                to: vault_b.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };

            let token_program = ctx.accounts.token_program.to_account_info();

            let cpi_context = CpiContext::new(token_program, cpi_accounts);
            escrow.b_deposited = true;
            token::transfer(cpi_context, amount)?;
        }

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

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, seeds=[b"escrow", escrow.user_a.as_ref(), escrow.user_b.as_ref()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub user_a_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_b_token: Account<'info, TokenAccount>,

    #[account(mut, seeds=[b"vault_a", escrow.key().as_ref(), escrow.user_a_mint.as_ref()], bump = escrow.vault_a_bump, token::mint = escrow.user_a_mint, token::authority = escrow)]
    pub vault_a: Account<'info, TokenAccount>,
    #[account(mut, seeds=[b"vault_b", escrow.key().as_ref(), escrow.user_b_mint.as_ref()], bump = escrow.vault_b_bump, token::mint = escrow.user_b_mint, token::authority = escrow)]
    pub vault_b: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
