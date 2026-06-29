-- M7: bookkeeping, session summaries, session archive flag

CREATE TABLE IF NOT EXISTS `bookkeeping_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text,
  `category` text NOT NULL,
  `amount` real NOT NULL,
  `currency` text DEFAULT 'CNY' NOT NULL,
  `note` text,
  `entry_type` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session_summaries` (
  `session_id` text PRIMARY KEY NOT NULL,
  `summary` text NOT NULL,
  `compressed_up_to_message_id` text,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `archived` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `compressed` integer DEFAULT 0 NOT NULL;
