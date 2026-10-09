CREATE TABLE `strokes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stroke_id` text NOT NULL,
	`day` text NOT NULL,
	`room` integer NOT NULL,
	`color` text NOT NULL,
	`size` real NOT NULL,
	`points` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strokes_stroke_id_unique` ON `strokes` (`stroke_id`);--> statement-breakpoint
CREATE INDEX `strokes_board_idx` ON `strokes` (`day`,`room`,`id`);