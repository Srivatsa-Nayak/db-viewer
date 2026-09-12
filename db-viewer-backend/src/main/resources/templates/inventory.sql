-- Warehouse inventory starter schema.
-- Stock is tracked per warehouse, so the same product can sit in several places at once.

CREATE TABLE "warehouses" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"     VARCHAR(128) NOT NULL,
  "city"     VARCHAR(128),
  "capacity" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "suppliers" (
  "id"      INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"    VARCHAR(128) NOT NULL,
  "email"   VARCHAR(255),
  "country" VARCHAR(64)
);

CREATE TABLE "items" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "sku"         VARCHAR(32) NOT NULL,
  "name"        VARCHAR(128) NOT NULL,
  "unit_cost"   DECIMAL NOT NULL DEFAULT 0,
  "supplier_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE
);

CREATE TABLE "stock_levels" (
  "id"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "quantity"     INTEGER NOT NULL DEFAULT 0,
  "reorder_at"   INTEGER NOT NULL DEFAULT 10,
  "item_id"      INTEGER DEFAULT 0,
  "warehouse_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE,
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE
);

CREATE TABLE "purchase_orders" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "reference"   VARCHAR(32) NOT NULL,
  "status"      VARCHAR(32) NOT NULL DEFAULT 'draft',
  "ordered_on"  DATE,
  "supplier_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE
);

CREATE TABLE "order_lines" (
  "id"                INTEGER PRIMARY KEY AUTOINCREMENT,
  "quantity"          INTEGER NOT NULL DEFAULT 1,
  "unit_price"        DECIMAL NOT NULL DEFAULT 0,
  "purchase_order_id" INTEGER DEFAULT 0,
  "item_id"           INTEGER DEFAULT 0,
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE
);

INSERT INTO "warehouses" ("name", "city", "capacity") VALUES
  ('North Depot', 'Leeds', 5000),
  ('Harbour Store', 'Rotterdam', 12000);

INSERT INTO "suppliers" ("name", "email", "country") VALUES
  ('Baltic Components', 'sales@baltic.example', 'Estonia'),
  ('Cape Fittings', 'hello@cape.example', 'South Africa');

INSERT INTO "items" ("sku", "name", "unit_cost", "supplier_id") VALUES
  ('BRK-100', 'Steel bracket', 2.40, 1),
  ('BLT-220', 'Hex bolt (100pk)', 6.10, 1),
  ('SEA-030', 'Rubber seal', 0.85, 2);

INSERT INTO "stock_levels" ("quantity", "reorder_at", "item_id", "warehouse_id") VALUES
  (420, 100, 1, 1),
  (85, 100, 2, 1),
  (1300, 250, 3, 2);

INSERT INTO "purchase_orders" ("reference", "status", "ordered_on", "supplier_id") VALUES
  ('PO-2041', 'received', '2024-05-14', 1),
  ('PO-2042', 'draft', '2024-07-02', 2);

INSERT INTO "order_lines" ("quantity", "unit_price", "purchase_order_id", "item_id") VALUES
  (500, 2.30, 1, 1),
  (200, 5.90, 1, 2),
  (1000, 0.80, 2, 3);
