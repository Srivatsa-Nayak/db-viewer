-- Example schema shown the first time someone opens the app.
-- A small online-store database: eight tables, wired together with foreign keys so the
-- canvas has relationships to draw rather than a row of disconnected boxes.

CREATE TABLE "customers" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"     VARCHAR(128) NOT NULL,
  "email"    VARCHAR(255) NOT NULL,
  "city"     VARCHAR(128),
  "joined_on" DATE
);

CREATE TABLE "categories" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"        VARCHAR(128) NOT NULL,
  "description" VARCHAR(255)
);

CREATE TABLE "suppliers" (
  "id"      INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"    VARCHAR(128) NOT NULL,
  "country" VARCHAR(128),
  "email"   VARCHAR(255)
);

CREATE TABLE "products" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"        VARCHAR(128) NOT NULL,
  "price"       DECIMAL NOT NULL DEFAULT 0,
  "stock"       INTEGER NOT NULL DEFAULT 0,
  "category_id" INTEGER DEFAULT 0,
  "supplier_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE,
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE
);

CREATE TABLE "employees" (
  "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"  VARCHAR(128) NOT NULL,
  "role"  VARCHAR(128),
  "email" VARCHAR(255)
);

CREATE TABLE "orders" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "placed_on"   DATE,
  "status"      VARCHAR(64) NOT NULL DEFAULT 'pending',
  "customer_id" INTEGER DEFAULT 0,
  "employee_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE
);

CREATE TABLE "order_items" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "quantity"   INTEGER NOT NULL DEFAULT 1,
  "unit_price" DECIMAL NOT NULL DEFAULT 0,
  "order_id"   INTEGER DEFAULT 0,
  "product_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
);

CREATE TABLE "reviews" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "rating"      INTEGER NOT NULL DEFAULT 5,
  "comment"     VARCHAR(255),
  "product_id"  INTEGER DEFAULT 0,
  "customer_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE
);

INSERT INTO "categories" ("name", "description") VALUES
  ('Peripherals', 'Keyboards, mice and desk hardware'),
  ('Displays', 'Monitors and stands'),
  ('Audio', 'Headsets and speakers');

INSERT INTO "suppliers" ("name", "country", "email") VALUES
  ('Northwind Supply', 'Ireland', 'sales@northwind.example'),
  ('Kite Electronics', 'Singapore', 'hello@kite.example');

INSERT INTO "employees" ("name", "role", "email") VALUES
  ('Ana Ruiz', 'Sales', 'ana@store.example'),
  ('Ben Adeyemi', 'Support', 'ben@store.example');

INSERT INTO "customers" ("name", "email", "city", "joined_on") VALUES
  ('Priya Nair', 'priya@example.com', 'Bengaluru', '2024-02-11'),
  ('Tom Becker', 'tom@example.com', 'Berlin', '2024-05-03'),
  ('Aisha Khan', 'aisha@example.com', 'Karachi', '2024-09-27');

INSERT INTO "products" ("name", "price", "stock", "category_id", "supplier_id") VALUES
  ('Mechanical Keyboard', 89.00, 40, 1, 1),
  ('Wireless Mouse', 25.50, 120, 1, 2),
  ('27" 4K Monitor', 349.00, 18, 2, 1),
  ('USB-C Headset', 59.99, 65, 3, 2);

INSERT INTO "orders" ("placed_on", "status", "customer_id", "employee_id") VALUES
  ('2024-10-02', 'shipped', 1, 1),
  ('2024-10-14', 'pending', 2, 2),
  ('2024-11-01', 'shipped', 3, 1);

INSERT INTO "order_items" ("quantity", "unit_price", "order_id", "product_id") VALUES
  (1, 89.00, 1, 1),
  (2, 25.50, 1, 2),
  (1, 349.00, 2, 3),
  (1, 59.99, 3, 4);

INSERT INTO "reviews" ("rating", "comment", "product_id", "customer_id") VALUES
  (5, 'Excellent build quality.', 1, 1),
  (4, 'Great screen, heavy stand.', 3, 2),
  (5, 'Very comfortable for long calls.', 4, 3);
