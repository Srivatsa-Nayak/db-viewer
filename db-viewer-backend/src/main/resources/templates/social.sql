-- Social network starter schema.
-- The follows table is a self-join: both sides point back at users, which is the shape people
-- most often get stuck modelling.

CREATE TABLE "users" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "handle"    VARCHAR(64) NOT NULL,
  "full_name" VARCHAR(128),
  "bio"       VARCHAR(255),
  "joined_on" DATE
);

CREATE TABLE "follows" (
  "id"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "followed_on"  DATE,
  "follower_id"  INTEGER DEFAULT 0,
  "following_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE,
  FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "posts" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "body"       TEXT NOT NULL,
  "posted_at"  DATETIME,
  "visibility" VARCHAR(32) NOT NULL DEFAULT 'public',
  "author_id"  INTEGER DEFAULT 0,
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "likes" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "liked_at" DATETIME,
  "post_id"  INTEGER DEFAULT 0,
  "user_id"  INTEGER DEFAULT 0,
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "replies" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "body"      TEXT NOT NULL,
  "posted_at" DATETIME,
  "post_id"   INTEGER DEFAULT 0,
  "author_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE
);

INSERT INTO "users" ("handle", "full_name", "bio", "joined_on") VALUES
  ('ada', 'Ada Byron', 'Counting on machines.', '2023-01-04'),
  ('rey', 'Reyhan Kaya', 'Backend and coffee.', '2023-06-18'),
  ('nao', 'Naomi Cole', 'Designing quiet software.', '2024-02-27');

INSERT INTO "follows" ("followed_on", "follower_id", "following_id") VALUES
  ('2023-07-01', 2, 1),
  ('2024-03-05', 3, 1),
  ('2024-03-06', 1, 3);

INSERT INTO "posts" ("body", "posted_at", "visibility", "author_id") VALUES
  ('Foreign keys are documentation that cannot go stale.', '2024-05-02 10:15:00', 'public', 1),
  ('Spent all morning on an index that saved 4ms. Worth it.', '2024-05-03 09:02:00', 'public', 2),
  ('Draft thoughts on schema design.', '2024-05-04 21:40:00', 'private', 3);

INSERT INTO "likes" ("liked_at", "post_id", "user_id") VALUES
  ('2024-05-02 10:40:00', 1, 2),
  ('2024-05-02 11:05:00', 1, 3),
  ('2024-05-03 09:30:00', 2, 1);

INSERT INTO "replies" ("body", "posted_at", "post_id", "author_id") VALUES
  ('Only if someone reads them.', '2024-05-02 11:12:00', 1, 3),
  ('Show the query plan.', '2024-05-03 10:01:00', 2, 1);
