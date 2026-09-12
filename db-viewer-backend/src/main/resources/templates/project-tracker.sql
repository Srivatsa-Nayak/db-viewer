-- Project / issue tracker starter schema.
-- Includes a self-referencing style lookup (tasks -> tasks via parent) kept simple, plus a
-- labels junction table.

CREATE TABLE "members" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"      VARCHAR(128) NOT NULL,
  "email"     VARCHAR(255),
  "role"      VARCHAR(32) NOT NULL DEFAULT 'contributor'
);

CREATE TABLE "projects" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"       VARCHAR(128) NOT NULL,
  "key"        VARCHAR(16) NOT NULL,
  "status"     VARCHAR(32) NOT NULL DEFAULT 'active',
  "started_on" DATE,
  "lead_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("lead_id") REFERENCES "members"("id") ON DELETE CASCADE
);

CREATE TABLE "labels" (
  "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"  VARCHAR(64) NOT NULL,
  "color" VARCHAR(16) NOT NULL DEFAULT 'gray'
);

CREATE TABLE "tasks" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"       VARCHAR(255) NOT NULL,
  "description" TEXT,
  "status"      VARCHAR(32) NOT NULL DEFAULT 'todo',
  "priority"    VARCHAR(16) NOT NULL DEFAULT 'medium',
  "estimate"    DECIMAL DEFAULT 0,
  "due_on"      DATE,
  "project_id"  INTEGER DEFAULT 0,
  "assignee_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  FOREIGN KEY ("assignee_id") REFERENCES "members"("id") ON DELETE CASCADE
);

CREATE TABLE "task_labels" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "task_id"  INTEGER DEFAULT 0,
  "label_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE
);

CREATE TABLE "task_comments" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "body"       TEXT NOT NULL,
  "created_on" DATETIME,
  "task_id"    INTEGER DEFAULT 0,
  "author_id"  INTEGER DEFAULT 0,
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE CASCADE
);

INSERT INTO "members" ("name", "email", "role") VALUES
  ('Priya Nair', 'priya@team.example', 'lead'),
  ('Tom Becker', 'tom@team.example', 'contributor'),
  ('Aisha Khan', 'aisha@team.example', 'contributor');

INSERT INTO "projects" ("name", "key", "status", "started_on", "lead_id") VALUES
  ('Schema Visualiser', 'SV', 'active', '2024-03-01', 1),
  ('Billing Migration', 'BILL', 'planning', '2024-07-15', 1);

INSERT INTO "labels" ("name", "color") VALUES
  ('bug', 'red'), ('feature', 'blue'), ('chore', 'gray'), ('urgent', 'amber');

INSERT INTO "tasks" ("title", "description", "status", "priority", "estimate", "due_on", "project_id", "assignee_id") VALUES
  ('Draw foreign key edges', 'Edges need handles on both ends.', 'done', 'high', 3, '2024-04-02', 1, 2),
  ('Add share links', 'Read-only token links.', 'in_progress', 'high', 5, '2024-08-01', 1, 3),
  ('Export to PNG', 'Whole canvas, not just the viewport.', 'todo', 'medium', 2, '2024-08-20', 1, 2),
  ('Map legacy plans', 'Old Pro plan has no equivalent.', 'todo', 'low', 8, NULL, 2, 1);

INSERT INTO "task_labels" ("task_id", "label_id") VALUES
  (1, 1), (2, 2), (2, 4), (3, 2), (4, 3);

INSERT INTO "task_comments" ("body", "created_on", "task_id", "author_id") VALUES
  ('Handles were missing on the shared view too.', '2024-04-01 10:22:00', 1, 1),
  ('Token should be 192 bits.', '2024-07-29 14:05:00', 2, 1),
  ('Sized from the node bounds, not the pane.', '2024-08-05 09:30:00', 3, 2);
