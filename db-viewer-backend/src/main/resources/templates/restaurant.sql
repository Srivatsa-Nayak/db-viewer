-- Restaurant orders starter schema.
-- Menu items are built from ingredients through a recipe junction, which is the part most
-- people leave out until they need to cost a dish.

CREATE TABLE "tables_seating" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "label"    VARCHAR(16) NOT NULL,
  "seats"    INTEGER NOT NULL DEFAULT 2,
  "section"  VARCHAR(32)
);

CREATE TABLE "staff" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"     VARCHAR(128) NOT NULL,
  "role"     VARCHAR(32) NOT NULL DEFAULT 'server',
  "hired_on" DATE
);

CREATE TABLE "ingredients" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"       VARCHAR(128) NOT NULL,
  "unit"       VARCHAR(16) NOT NULL DEFAULT 'g',
  "cost_per_unit" DECIMAL NOT NULL DEFAULT 0
);

CREATE TABLE "menu_items" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"     VARCHAR(128) NOT NULL,
  "price"    DECIMAL NOT NULL DEFAULT 0,
  "course"   VARCHAR(32) NOT NULL DEFAULT 'main',
  "is_vegan" BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE "recipe_lines" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "quantity"      DECIMAL NOT NULL DEFAULT 0,
  "menu_item_id"  INTEGER DEFAULT 0,
  "ingredient_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
  FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE
);

CREATE TABLE "orders" (
  "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
  "opened_at"       DATETIME,
  "status"          VARCHAR(32) NOT NULL DEFAULT 'open',
  "tables_seating_id" INTEGER DEFAULT 0,
  "staff_id"        INTEGER DEFAULT 0,
  FOREIGN KEY ("tables_seating_id") REFERENCES "tables_seating"("id") ON DELETE CASCADE,
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE
);

CREATE TABLE "order_items" (
  "id"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "quantity"     INTEGER NOT NULL DEFAULT 1,
  "notes"        VARCHAR(255),
  "order_id"     INTEGER DEFAULT 0,
  "menu_item_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
  FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE
);

INSERT INTO "tables_seating" ("label", "seats", "section") VALUES
  ('T1', 2, 'Window'), ('T2', 4, 'Window'), ('T7', 6, 'Garden');

INSERT INTO "staff" ("name", "role", "hired_on") VALUES
  ('Marco Rossi', 'server', '2022-04-01'),
  ('Yara Haddad', 'chef', '2021-11-15');

INSERT INTO "ingredients" ("name", "unit", "cost_per_unit") VALUES
  ('Tomato', 'g', 0.004),
  ('Mozzarella', 'g', 0.012),
  ('Basil', 'g', 0.030),
  ('Flour', 'g', 0.002);

INSERT INTO "menu_items" ("name", "price", "course", "is_vegan") VALUES
  ('Margherita', 11.50, 'main', 0),
  ('Marinara', 9.00, 'main', 1),
  ('Tiramisu', 6.50, 'dessert', 0);

INSERT INTO "recipe_lines" ("quantity", "menu_item_id", "ingredient_id") VALUES
  (200, 1, 1), (150, 1, 2), (5, 1, 3), (250, 1, 4),
  (200, 2, 1), (250, 2, 4);

INSERT INTO "orders" ("opened_at", "status", "tables_seating_id", "staff_id") VALUES
  ('2024-07-12 19:05:00', 'paid', 2, 1),
  ('2024-07-12 20:30:00', 'open', 3, 1);

INSERT INTO "order_items" ("quantity", "notes", "order_id", "menu_item_id") VALUES
  (2, NULL, 1, 1),
  (1, 'no basil', 1, 2),
  (3, NULL, 2, 1),
  (2, NULL, 2, 3);
