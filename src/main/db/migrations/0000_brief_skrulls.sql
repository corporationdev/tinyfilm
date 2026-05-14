CREATE TABLE `project_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`original_path` text NOT NULL,
	`asset_path` text NOT NULL,
	`relative_path` text NOT NULL,
	`size_bytes` integer,
	`mime_type` text,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`root_path` text NOT NULL,
	`entry_point` text DEFAULT 'src/index.ts' NOT NULL,
	`composition_id` text DEFAULT 'MyComp' NOT NULL,
	`thumbnail_path` text,
	`duration_ms` integer,
	`fps` integer DEFAULT 30 NOT NULL,
	`width` integer DEFAULT 1280 NOT NULL,
	`height` integer DEFAULT 720 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`last_opened_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
