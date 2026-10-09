import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const strokes = sqliteTable("strokes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strokeId: text("stroke_id").notNull().unique(),
  day: text("day").notNull(),
  room: integer("room").notNull(),
  color: text("color").notNull(),
  size: real("size").notNull(),
  points: text("points").notNull(),
}, (table) => [index("strokes_board_idx").on(table.day, table.room, table.id)]);
