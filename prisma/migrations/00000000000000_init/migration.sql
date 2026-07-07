-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "finance";

-- CreateTable
CREATE TABLE "finance"."bank_accounts" (
    "id" UUID NOT NULL,
    "uid" TEXT NOT NULL,
    "name" VARCHAR,
    "sm_private_key" TEXT NOT NULL,
    "sm_public_key" TEXT NOT NULL,
    "sm_sym_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."bank_account_cards" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "card_nbr" TEXT NOT NULL,

    CONSTRAINT "bank_account_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."bank_transactions" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "uid" TEXT NOT NULL,
    "card_nbr" TEXT NOT NULL,
    "trans_datetime" TIMESTAMPTZ NOT NULL,
    "trans_sequence_idn" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "synced_to_bitable_at" TIMESTAMPTZ,
    "bitable_record_id" VARCHAR,
    "bitable_fields_hash" VARCHAR,
    "bitable_checked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."bank_transaction_sync_states" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "uid" TEXT NOT NULL,
    "card_nbr" TEXT NOT NULL,
    "breakpoint_y1" JSONB NOT NULL DEFAULT '[]',
    "last_begin_date" VARCHAR,
    "last_end_date" VARCHAR,
    "last_started_at" TIMESTAMPTZ,
    "last_finished_at" TIMESTAMPTZ,
    "last_synced_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_transaction_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_uid_key" ON "finance"."bank_accounts"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_cards_card_nbr_key" ON "finance"."bank_account_cards"("card_nbr");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_trans_sequence_idn_key" ON "finance"."bank_transactions"("trans_sequence_idn");

-- CreateIndex
CREATE INDEX "bank_transactions_trans_datetime_idx" ON "finance"."bank_transactions"("trans_datetime");

-- CreateIndex
CREATE INDEX "bank_transactions_card_nbr_trans_datetime_idx" ON "finance"."bank_transactions"("card_nbr", "trans_datetime");

-- CreateIndex
CREATE INDEX "bank_transactions_uid_card_nbr_trans_datetime_idx" ON "finance"."bank_transactions"("uid", "card_nbr", "trans_datetime");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_account_id_idx" ON "finance"."bank_transactions"("bank_account_id");

-- CreateIndex
CREATE INDEX "bank_transactions_uid_idx" ON "finance"."bank_transactions"("uid");

-- CreateIndex
CREATE INDEX "bank_transactions_card_nbr_idx" ON "finance"."bank_transactions"("card_nbr");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_sync_states_bank_account_id_card_nbr_key" ON "finance"."bank_transaction_sync_states"("bank_account_id", "card_nbr");

-- AddForeignKey
ALTER TABLE "finance"."bank_account_cards" ADD CONSTRAINT "bank_account_cards_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "finance"."bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "finance"."bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."bank_transaction_sync_states" ADD CONSTRAINT "bank_transaction_sync_states_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "finance"."bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
