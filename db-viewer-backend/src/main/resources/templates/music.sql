-- Music streaming starter schema.
-- Tracks reach playlists through a junction table that carries its own data (the position in
-- the playlist), which is the case a plain many-to-many cannot cover.

CREATE TABLE "artists" (
  "id"      INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"    VARCHAR(128) NOT NULL,
  "country" VARCHAR(64),
  "formed"  INTEGER
);

CREATE TABLE "albums" (
  "id"           INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"        VARCHAR(255) NOT NULL,
  "released_on"  DATE,
  "artist_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE
);

CREATE TABLE "tracks" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"      VARCHAR(255) NOT NULL,
  "seconds"    INTEGER NOT NULL DEFAULT 0,
  "explicit"   BOOLEAN NOT NULL DEFAULT 0,
  "album_id"   INTEGER DEFAULT 0,
  FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE
);

CREATE TABLE "listeners" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "email"     VARCHAR(255) NOT NULL,
  "display_name" VARCHAR(128),
  "plan"      VARCHAR(32) NOT NULL DEFAULT 'free'
);

CREATE TABLE "playlists" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"        VARCHAR(128) NOT NULL,
  "is_public"   BOOLEAN NOT NULL DEFAULT 1,
  "created_on"  DATE,
  "listener_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("listener_id") REFERENCES "listeners"("id") ON DELETE CASCADE
);

CREATE TABLE "playlist_tracks" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "position"    INTEGER NOT NULL DEFAULT 1,
  "added_on"    DATE,
  "playlist_id" INTEGER DEFAULT 0,
  "track_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE,
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE
);

CREATE TABLE "plays" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "played_at"   DATETIME,
  "listener_id" INTEGER DEFAULT 0,
  "track_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("listener_id") REFERENCES "listeners"("id") ON DELETE CASCADE,
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE
);

INSERT INTO "artists" ("name", "country", "formed") VALUES
  ('Low Ceiling', 'Ireland', 2014),
  ('Kaveh Sun', 'Iran', 2019),
  ('The Meridians', 'Canada', 2008);

INSERT INTO "albums" ("title", "released_on", "artist_id") VALUES
  ('Quiet Rooms', '2021-03-19', 1),
  ('Salt Air', '2023-09-01', 2),
  ('Northbound', '2016-06-10', 3);

INSERT INTO "tracks" ("title", "seconds", "explicit", "album_id") VALUES
  ('Ceiling Fan', 214, 0, 1),
  ('Second Floor', 189, 0, 1),
  ('Harbour Light', 263, 0, 2),
  ('Long Drive', 302, 1, 3);

INSERT INTO "listeners" ("email", "display_name", "plan") VALUES
  ('mira@example.com', 'Mira', 'premium'),
  ('joon@example.com', 'Joon', 'free');

INSERT INTO "playlists" ("name", "is_public", "created_on", "listener_id") VALUES
  ('Focus', 1, '2024-02-02', 1),
  ('Late drive', 0, '2024-04-11', 2);

INSERT INTO "playlist_tracks" ("position", "added_on", "playlist_id", "track_id") VALUES
  (1, '2024-02-02', 1, 1),
  (2, '2024-02-03', 1, 3),
  (1, '2024-04-11', 2, 4);

INSERT INTO "plays" ("played_at", "listener_id", "track_id") VALUES
  ('2024-07-01 08:12:00', 1, 1),
  ('2024-07-01 08:16:00', 1, 3),
  ('2024-07-02 23:40:00', 2, 4);
