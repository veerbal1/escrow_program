use anchor_lang::prelude::*;

declare_id!("AsUjRV671ni3WY4NeppvNNMqTHCof8pP5rkTb3ytXvTV");

#[program]
pub mod escrow_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
