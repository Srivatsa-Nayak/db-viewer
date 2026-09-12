-- SaaS subscription billing starter schema.
-- Multi-tenant shape: everything hangs off an organization, which is the join most billing
-- questions start from.

CREATE TABLE "organizations" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"       VARCHAR(128) NOT NULL,
  "slug"       VARCHAR(128) NOT NULL,
  "country"    VARCHAR(64),
  "created_on" DATE
);

CREATE TABLE "plans" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"          VARCHAR(64) NOT NULL,
  "price_monthly" DECIMAL NOT NULL DEFAULT 0,
  "seat_limit"    INTEGER NOT NULL DEFAULT 1,
  "is_active"     BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE "users" (
  "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
  "email"           VARCHAR(255) NOT NULL,
  "full_name"       VARCHAR(128),
  "role"            VARCHAR(32) NOT NULL DEFAULT 'member',
  "last_seen_at"    DATETIME,
  "organization_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
);

CREATE TABLE "subscriptions" (
  "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
  "status"          VARCHAR(32) NOT NULL DEFAULT 'trialing',
  "started_on"      DATE,
  "renews_on"       DATE,
  "organization_id" INTEGER DEFAULT 0,
  "plan_id"         INTEGER DEFAULT 0,
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE
);

CREATE TABLE "invoices" (
  "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
  "number"          VARCHAR(32) NOT NULL,
  "amount"          DECIMAL NOT NULL DEFAULT 0,
  "status"          VARCHAR(32) NOT NULL DEFAULT 'open',
  "issued_on"       DATE,
  "subscription_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE
);

CREATE TABLE "payments" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "amount"     DECIMAL NOT NULL DEFAULT 0,
  "method"     VARCHAR(32) NOT NULL DEFAULT 'card',
  "paid_on"    DATE,
  "invoice_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE
);

INSERT INTO "organizations" ("name", "slug", "country", "created_on") VALUES
  ('Northwind Labs', 'northwind', 'Ireland', '2024-01-08'),
  ('Kite Analytics', 'kite', 'Singapore', '2024-02-19'),
  ('Meridian Co', 'meridian', 'Canada', '2024-06-30');

INSERT INTO "plans" ("name", "price_monthly", "seat_limit", "is_active") VALUES
  ('Free', 0, 3, 1),
  ('Team', 49.00, 25, 1),
  ('Business', 199.00, 200, 1),
  ('Legacy Pro', 99.00, 50, 0);

INSERT INTO "users" ("email", "full_name", "role", "last_seen_at", "organization_id") VALUES
  ('ada@northwind.example', 'Ada Byron', 'owner', '2024-07-01 09:12:00', 1),
  ('raj@northwind.example', 'Raj Menon', 'member', '2024-07-01 11:40:00', 1),
  ('wei@kite.example', 'Wei Zhang', 'owner', '2024-06-28 16:05:00', 2),
  ('sam@meridian.example', 'Sam Oduya', 'owner', '2024-07-02 08:00:00', 3);

INSERT INTO "subscriptions" ("status", "started_on", "renews_on", "organization_id", "plan_id") VALUES
  ('active', '2024-01-08', '2024-08-08', 1, 3),
  ('active', '2024-02-19', '2024-08-19', 2, 2),
  ('trialing', '2024-06-30', '2024-07-14', 3, 1);

INSERT INTO "invoices" ("number", "amount", "status", "issued_on", "subscription_id") VALUES
  ('INV-1001', 199.00, 'paid', '2024-06-08', 1),
  ('INV-1002', 49.00, 'paid', '2024-06-19', 2),
  ('INV-1003', 199.00, 'open', '2024-07-08', 1);

INSERT INTO "payments" ("amount", "method", "paid_on", "invoice_id") VALUES
  (199.00, 'card', '2024-06-08', 1),
  (49.00, 'transfer', '2024-06-20', 2);
