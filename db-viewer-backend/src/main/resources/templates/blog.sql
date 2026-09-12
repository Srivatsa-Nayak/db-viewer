-- Blog / CMS starter schema.
-- Shows a many-to-many relationship (posts <-> tags through post_tags), which is the shape
-- people most often want an example of.

CREATE TABLE "authors" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"      VARCHAR(128) NOT NULL,
  "email"     VARCHAR(255) NOT NULL,
  "bio"       VARCHAR(255),
  "joined_on" DATE
);

CREATE TABLE "categories" (
  "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"  VARCHAR(128) NOT NULL,
  "slug"  VARCHAR(128) NOT NULL
);

CREATE TABLE "tags" (
  "id"   INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" VARCHAR(64) NOT NULL
);

CREATE TABLE "posts" (
  "id"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"        VARCHAR(255) NOT NULL,
  "slug"         VARCHAR(255) NOT NULL,
  "body"         TEXT,
  "status"       VARCHAR(32) NOT NULL DEFAULT 'draft',
  "published_on" DATE,
  "author_id"    INTEGER DEFAULT 0,
  "category_id"  INTEGER DEFAULT 0,
  FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE CASCADE,
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE
);

CREATE TABLE "post_tags" (
  "id"      INTEGER PRIMARY KEY AUTOINCREMENT,
  "post_id" INTEGER DEFAULT 0,
  "tag_id"  INTEGER DEFAULT 0,
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE
);

CREATE TABLE "comments" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "body"       TEXT NOT NULL,
  "author_name" VARCHAR(128) NOT NULL,
  "approved"   BOOLEAN NOT NULL DEFAULT 0,
  "created_on" DATE,
  "post_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE
);

INSERT INTO "authors" ("name", "email", "bio", "joined_on") VALUES
  ('Maya Iyer', 'maya@example.com', 'Writes about databases.', '2024-01-15'),
  ('Leo Fischer', 'leo@example.com', 'Backend engineer.', '2024-03-02');

INSERT INTO "categories" ("name", "slug") VALUES
  ('Engineering', 'engineering'),
  ('Product', 'product'),
  ('Tutorials', 'tutorials');

INSERT INTO "tags" ("name") VALUES
  ('sql'), ('postgres'), ('performance'), ('beginner');

INSERT INTO "posts" ("title", "slug", "body", "status", "published_on", "author_id", "category_id") VALUES
  ('Indexing for beginners', 'indexing-for-beginners', 'An index is a lookup table...', 'published', '2024-04-10', 1, 3),
  ('Why we moved to Postgres', 'why-we-moved-to-postgres', 'After two years on MySQL...', 'published', '2024-05-21', 2, 1),
  ('Roadmap for Q3', 'roadmap-q3', 'Here is what we are building...', 'draft', NULL, 2, 2);

INSERT INTO "post_tags" ("post_id", "tag_id") VALUES
  (1, 1), (1, 4), (2, 2), (2, 3);

INSERT INTO "comments" ("body", "author_name", "approved", "created_on", "post_id") VALUES
  ('This finally made it click, thanks.', 'devfan', 1, '2024-04-11', 1),
  ('Any benchmarks to share?', 'skeptic', 1, '2024-05-22', 2),
  ('First!', 'spambot', 0, '2024-05-22', 2);
