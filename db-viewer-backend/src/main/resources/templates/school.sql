-- School / course management starter schema.
-- The enrollments table is the classic junction between students and courses.

CREATE TABLE "departments" (
  "id"       INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"     VARCHAR(128) NOT NULL,
  "building" VARCHAR(64)
);

CREATE TABLE "teachers" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"          VARCHAR(128) NOT NULL,
  "email"         VARCHAR(255),
  "hired_on"      DATE,
  "department_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE
);

CREATE TABLE "students" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"       VARCHAR(128) NOT NULL,
  "email"      VARCHAR(255),
  "year_group" INTEGER NOT NULL DEFAULT 1,
  "joined_on"  DATE
);

CREATE TABLE "courses" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "code"          VARCHAR(16) NOT NULL,
  "title"         VARCHAR(128) NOT NULL,
  "credits"       INTEGER NOT NULL DEFAULT 3,
  "department_id" INTEGER DEFAULT 0,
  "teacher_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE,
  FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE
);

CREATE TABLE "enrollments" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "enrolled_on" DATE,
  "final_grade" VARCHAR(4),
  "student_id"  INTEGER DEFAULT 0,
  "course_id"   INTEGER DEFAULT 0,
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE
);

CREATE TABLE "assignments" (
  "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"     VARCHAR(128) NOT NULL,
  "due_on"    DATE,
  "max_score" INTEGER NOT NULL DEFAULT 100,
  "course_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE
);

CREATE TABLE "submissions" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "submitted_on"  DATE,
  "score"         INTEGER,
  "assignment_id" INTEGER DEFAULT 0,
  "student_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE,
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE
);

INSERT INTO "departments" ("name", "building") VALUES
  ('Computer Science', 'Turing Hall'),
  ('Mathematics', 'Noether Wing');

INSERT INTO "teachers" ("name", "email", "hired_on", "department_id") VALUES
  ('Dr. Grace Okafor', 'grace@school.example', '2019-09-01', 1),
  ('Dr. Ivan Petrov', 'ivan@school.example', '2021-01-10', 2);

INSERT INTO "students" ("name", "email", "year_group", "joined_on") VALUES
  ('Nina Alvarez', 'nina@school.example', 2, '2023-09-04'),
  ('Omar Haddad', 'omar@school.example', 1, '2024-09-02'),
  ('Yuki Tanaka', 'yuki@school.example', 3, '2022-09-05');

INSERT INTO "courses" ("code", "title", "credits", "department_id", "teacher_id") VALUES
  ('CS101', 'Intro to Databases', 4, 1, 1),
  ('CS210', 'Algorithms', 4, 1, 1),
  ('MA150', 'Linear Algebra', 3, 2, 2);

INSERT INTO "enrollments" ("enrolled_on", "final_grade", "student_id", "course_id") VALUES
  ('2024-09-10', 'A', 1, 1),
  ('2024-09-10', 'B+', 1, 3),
  ('2024-09-11', NULL, 2, 1),
  ('2024-09-11', 'A-', 3, 2);

INSERT INTO "assignments" ("title", "due_on", "max_score", "course_id") VALUES
  ('Normalisation exercise', '2024-10-01', 100, 1),
  ('Query optimisation lab', '2024-10-20', 50, 1),
  ('Matrix proofs', '2024-10-15', 100, 3);

INSERT INTO "submissions" ("submitted_on", "score", "assignment_id", "student_id") VALUES
  ('2024-09-30', 92, 1, 1),
  ('2024-10-01', 78, 1, 2),
  ('2024-10-14', 88, 3, 1);
