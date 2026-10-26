// trendsgate — Token-2022 transfer hook enforcing "only buyable through the Trends
// (or FOMO) app" for anti-bundle launches.
//
// Forked from the production-proven yolo-gate (yolo/anchor/programs/yolo-gate), with
// three deltas for Trends:
//   1. New program id / upgrade authority.
//   2. pump.fun venue REMOVED — approved venues are Trends (per-mint co-signer) and
//      FOMO (global co-signer) only. We deliberately exclude pump.fun.
//   3. `gate_active` flag on the cfg so a coin can be flipped to fully-open trading
//      before graduation (e.g. the "Open" launch mode after the presale settles), via
//      a co-signer-gated set_gate_active ix. When inactive, every transfer is allowed.
//
// Rule, fail-closed (when gate_active):
//   - tokens flowing INTO a Meteora DBC vault (a SELL) → always allowed
//   - tokens flowing to the per-mint whitelisted dev wallet → allowed (launch/settle)
//   - everything else (BUYS out of the vault, wallet-to-wallet) → allowed only when the
//     transaction carries a signature from an approved venue co-signer (Trends gate key
//     per-mint, or FOMO's global gas-sponsor), detected by scanning the Instructions
//     sysvar for an account reference with is_signer=true. Our swap builder appends a
//     Memo ix referencing the Trends co-signer so the scan is deterministic.
//
// At curve completion Meteora DBC revokes the hook from the mint — post-graduation this
// program never runs for that coin again.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program_error::ProgramError,
    pubkey,
    sysvar::{self, instructions::load_instruction_at_checked},
};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};
use spl_token_2022::{
    extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions},
    state::Account as Token22Account,
};

declare_id!("7VMUCakFHhawRhz7YoUUxZHakLuHo6WFrWMyf3ndRw9t");

/// Meteora DBC global pool authority — a static keyless PDA of the DBC program
/// (same on devnet and mainnet; the DBC IDL pins it as a fixed address). Every DBC
/// vault token account is owned by it, and nothing else legitimately is.
pub const DBC_POOL_AUTHORITY: Pubkey = pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");

/// FOMO Labs' app-wide gas-sponsor / co-signer wallet. The FOMO app is gasless — its
/// backend signs AND fee-pays every trade made inside the app with this wallet, so its
/// signature is an unforgeable mark that a buy came through FOMO. Passive detection; no
/// FOMO partnership needed. (If FOMO ever rotates this wallet, change it via program
/// upgrade — applies to all coins at once.)
pub const FOMO_COSIGNER: Pubkey = pubkey!("AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51");

#[program]
pub mod trendsgate {
    use super::*;

    /// Create the per-mint gate config. Permissionless by design: the mint pubkey is a
    /// fresh keypair never seen on chain before the atomic launch tx, and `init` is
    /// first-writer-wins — a squatted cfg just fails our launch tx closed and we
    /// regenerate the mint. `gate_active` starts true for App-Only launches.
    pub fn init_cfg(
        ctx: Context<InitCfg>,
        co_signer: Pubkey,
        dev_wallet: Pubkey,
        gate_active: bool,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.cfg;
        cfg.bump = ctx.bumps.cfg;
        cfg.co_signer = co_signer;
        cfg.dev_wallet = dev_wallet;
        cfg.gate_active = gate_active;
        Ok(())
    }

    /// Flip the gate on/off. Only the per-mint co-signer (the Trends gate key that owns
    /// this coin) may call it. Used to open a coin to all-venue trading before
    /// graduation (the "Open" mode path, or an early un-gate).
    pub fn set_gate_active(ctx: Context<SetGateActive>, active: bool) -> Result<()> {
        ctx.accounts.cfg.gate_active = active;
        Ok(())
    }

    /// Create the ExtraAccountMetaList so Token-2022 injects [cfg PDA, Instructions
    /// sysvar] into every transfer of this mint. Must exist before the first transfer
    /// (the launch tx creates it right after the pool, before the dev first-buy).
    pub fn initialize_extra_account_meta_list(ctx: Context<InitializeEaml>) -> Result<()> {
        let metas = vec![
            // Execute account index 1 = mint → cfg PDA ["cfg", mint] on this program
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: b"cfg".to_vec() },
                    Seed::AccountKey { index: 1 },
                ],
                false,
                false,
            )?,
            ExtraAccountMeta::new_with_pubkey(&sysvar::instructions::ID, false, false)?,
        ];
        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
        Ok(())
    }

    /// The hook. Token-2022 invokes this (via fallback) mid-transfer, read-only.
    pub fn transfer_hook(ctx: Context<TransferHookCtx>, _amount: u64) -> Result<()> {
        // Only callable mid-transfer: the source token account's TransferHookAccount
        // extension `transferring` flag is set by Token-2022 immediately before this
        // CPI and cleared after. Direct invocation ⇒ flag unset ⇒ fail.
        assert_is_transferring(&ctx.accounts.source_token)?;

        // Gate disabled → fully open coin: every transfer passes (Open mode / un-gated).
        if !ctx.accounts.cfg.gate_active {
            return Ok(());
        }

        // Resolve real owners from account data (never trust labels).
        let dst_owner = token_account_owner(&ctx.accounts.destination_token)?;
        let src_owner = token_account_owner(&ctx.accounts.source_token)?;

        // SELL leg (user → vault): always free. FhVo… is keyless; only DBC vaults are
        // owned by it, and "donating" tokens to a stray FhVo-owned account is a
        // self-burn, not a bypass.
        if dst_owner == DBC_POOL_AUTHORITY {
            return Ok(());
        }

        // Dev-wallet whitelist: the launch first-buy, the presale settle distribution,
        // and ops transfers all originate from / land on the per-mint dev wallet.
        if dst_owner == ctx.accounts.cfg.dev_wallet {
            return Ok(());
        }

        // Everything else — BUY (vault → user) and wallet-to-wallet — is allowed only
        // if the transaction came through an APPROVED VENUE: the Trends app (our
        // per-mint co-signer) or the FOMO app (FOMO's global co-signer). pump.fun is
        // intentionally NOT an approved venue.
        if approved_venue(&ctx.accounts.instructions_sysvar, &ctx.accounts.cfg.co_signer)? {
            return Ok(());
        }
        if src_owner == DBC_POOL_AUTHORITY {
            err!(GateError::NotCoSigned)
        } else {
            err!(GateError::TransferBlocked)
        }
    }

    /// Token-2022 calls Execute with the SPL interface discriminator, which matches no
    /// Anchor discriminator — route it through the fallback.
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        match TransferHookInstruction::unpack(data) {
            Ok(TransferHookInstruction::Execute { amount }) => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

// ───────────────────────────── accounts ─────────────────────────────

#[derive(Accounts)]
pub struct InitCfg<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only its key is used as a PDA seed; the launch tx creates the mint
    /// earlier in the same transaction.
    pub mint: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = Cfg::SPACE,
        seeds = [b"cfg", mint.key().as_ref()],
        bump
    )]
    pub cfg: Account<'info, Cfg>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetGateActive<'info> {
    /// Must equal cfg.co_signer (the Trends gate key owning this coin).
    pub authority: Signer<'info>,
    /// CHECK: only its key is used as a PDA seed.
    pub mint: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"cfg", mint.key().as_ref()],
        bump = cfg.bump,
        constraint = authority.key() == cfg.co_signer @ GateError::Unauthorized
    )]
    pub cfg: Account<'info, Cfg>,
}

#[derive(Accounts)]
pub struct InitializeEaml<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only its key is used as a PDA seed.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: initialized with the SPL TLV ExtraAccountMetaList layout; owned by this
    /// program (required by Token-2022's account resolution).
    #[account(
        init,
        payer = payer,
        space = ExtraAccountMetaList::size_of(2).unwrap(),
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferHookCtx<'info> {
    /// CHECK: validated in assert_is_transferring (Token-2022 owner + transferring flag).
    pub source_token: UncheckedAccount<'info>,
    /// CHECK: key used for PDA seeds only.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: owner read from raw token-account data after an owner-program check.
    pub destination_token: UncheckedAccount<'info>,
    /// CHECK: source owner/delegate — unused by the gate logic.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: PDA-checked against this program.
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(seeds = [b"cfg", mint.key().as_ref()], bump = cfg.bump)]
    pub cfg: Account<'info, Cfg>,
    /// CHECK: address-pinned Instructions sysvar.
    #[account(address = sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

// ───────────────────────────── state ─────────────────────────────

/// 74 bytes: anchor discriminator(8) + bump@8 + co_signer@9 + dev_wallet@41 +
/// gate_active@73. (yolo-gate's cfg was 73 bytes; the trailing gate_active flag is the
/// only layout addition.)
#[account]
pub struct Cfg {
    pub bump: u8,
    pub co_signer: Pubkey,
    pub dev_wallet: Pubkey,
    pub gate_active: bool,
}

impl Cfg {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 1;
}

// ───────────────────────────── errors ─────────────────────────────

#[error_code]
pub enum GateError {
    #[msg("transfer hook invoked outside a live Token-2022 transfer")]
    NotTransferring, // 6000
    #[msg("this token can only be bought through the Trends or FOMO app")]
    NotCoSigned, // 6001
    #[msg("pre-graduation transfers of this token are restricted to the Trends app")]
    TransferBlocked, // 6002
    #[msg("only the coin's co-signer may change the gate")]
    Unauthorized, // 6003
}

// ───────────────────────────── helpers ─────────────────────────────

fn assert_is_transferring(acc: &AccountInfo) -> Result<()> {
    require_keys_eq!(*acc.owner, spl_token_2022::ID, GateError::NotTransferring);
    let data = acc.try_borrow_data()?;
    let state = StateWithExtensions::<Token22Account>::unpack(&data)
        .map_err(|_| error!(GateError::NotTransferring))?;
    let ext = state
        .get_extension::<TransferHookAccount>()
        .map_err(|_| error!(GateError::NotTransferring))?;
    require!(bool::from(ext.transferring), GateError::NotTransferring);
    Ok(())
}

fn token_account_owner(acc: &AccountInfo) -> Result<Pubkey> {
    require_keys_eq!(*acc.owner, spl_token_2022::ID, GateError::NotTransferring);
    let data = acc.try_borrow_data()?;
    let state = StateWithExtensions::<Token22Account>::unpack(&data)
        .map_err(|_| error!(GateError::NotTransferring))?;
    Ok(state.base.owner)
}

/// One pass over the transaction's top-level instructions. Approve the transfer if an
/// approved venue co-signer signed:
///   - the Trends co-signer signed (our app)   — cryptographic, per-mint via cfg
///   - FOMO's gas-sponsor signed (FOMO app)     — cryptographic, global constant
///
/// Signatures can't be forged into the is_signer flags (the runtime sets them from the
/// verified message header). Our own swap builder appends a Memo ix referencing the
/// Trends co-signer so our app's buys always match; FOMO buys match on FOMO's own
/// signature already present in their transactions.
fn approved_venue(sysvar_acc: &AccountInfo, trends_cosigner: &Pubkey) -> Result<bool> {
    let count = {
        let data = sysvar_acc.try_borrow_data()?;
        if data.len() < 2 {
            return Ok(false);
        }
        u16::from_le_bytes([data[0], data[1]]) as usize
    };
    for i in 0..count {
        let ix = load_instruction_at_checked(i, sysvar_acc)?;
        if ix
            .accounts
            .iter()
            .any(|m| m.is_signer && (m.pubkey == *trends_cosigner || m.pubkey == FOMO_COSIGNER))
        {
            return Ok(true);
        }
    }
    Ok(false)
}
