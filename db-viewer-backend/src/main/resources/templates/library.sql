-- Library lending starter schema.
-- A compact five-table example: good for seeing the diagram without much scrolling.

CREATE TABLE "authors" (
  "id"      INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"    VARCHAR(128) NOT NULL,
  "country" VARCHAR(64)
);

CREATE TABLE "members" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"       VARCHAR(128) NOT NULL,
  "email"      VARCHAR(255),
  "card_no"    VARCHAR(32) NOT NULL,
  "joined_on"  DATE
);

CREATE TABLE "books" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"     VARCHAR(255) NOT NULL,
  "isbn"      VARCHAR(20),
  "published" INTEGER,
  "copies"    INTEGER NOT NULL DEFAULT 1,
  "author_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE
);

CREATE TABLE "loans" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "borrowed_on" DATE,
  "due_on"      DATE,
  "returned_on" DATE,
  "book_id"     INTEGER DEFAULT 0,
  "member_id"   INTEGER DEFAULT 0,
  FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE,
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE
);

CREATE TABLE "reservations" (
  "id"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "requested_on" DATE,
  "status"       VARCHAR(32) NOT NULL DEFAULT 'waiting',
  "book_id"      INTEGER DEFAULT 0,
  "member_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE,
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE
);

INSERT INTO "authors" ("name", "country") VALUES
  ('Ursula K. Le Guin', 'United States'),
  ('Chinua Achebe', 'Nigeria'),
  ('Italo Calvino', 'Italy');

INSERT INTO "members" ("name", "email", "card_no", "joined_on") VALUES
  ('Hana Sato', 'hana@example.com', 'LIB-0001', '2023-02-11'),
  ('Diego Ramos', 'diego@example.com', 'LIB-0002', '2023-08-04'),
  ('Fatima Noor', 'fatima@example.com', 'LIB-0003', '2024-01-19');

INSERT INTO "books" ("title", "isbn", "published", "copies", "author_id") VALUES
  ('A Wizard of Earthsea', '9780553262506', 1968, 3, 1),
  ('The Left Hand of Darkness', '9780441478125', 1969, 2, 1),
  ('Things Fall Apart', '9780385474542', 1958, 4, 2),
  ('Invisible Cities', '9780156453804', 1972, 1, 3);

INSERT INTO "loans" ("borrowed_on", "due_on", "returned_on", "book_id", "member_id") VALUES
  ('2024-06-01', '2024-06-22', '2024-06-18', 1, 1),
  ('2024-06-20', '2024-07-11', NULL, 3, 2),
  ('2024-07-02', '2024-07-23', NULL, 4, 3);

INSERT INTO "reservations" ("requested_on", "status", "book_id", "member_id") VALUES
  ('2024-07-05', 'waiting', 4, 1),
  ('2024-07-06', 'ready', 2, 2);
