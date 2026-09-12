-- HR and payroll starter schema.
-- employees carries a manager_id back into itself, so the diagram shows a reporting line as
-- well as the usual department join.

CREATE TABLE "departments" (
  "id"     INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"   VARCHAR(128) NOT NULL,
  "budget" DECIMAL NOT NULL DEFAULT 0
);

CREATE TABLE "positions" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "title"       VARCHAR(128) NOT NULL,
  "grade"       VARCHAR(16),
  "base_salary" DECIMAL NOT NULL DEFAULT 0
);

CREATE TABLE "employees" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "full_name"     VARCHAR(128) NOT NULL,
  "email"         VARCHAR(255),
  "hired_on"      DATE,
  "department_id" INTEGER DEFAULT 0,
  "position_id"   INTEGER DEFAULT 0,
  "manager_id"    INTEGER DEFAULT 0,
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE,
  FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE,
  FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE CASCADE
);

CREATE TABLE "payslips" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "period"      VARCHAR(16) NOT NULL,
  "gross"       DECIMAL NOT NULL DEFAULT 0,
  "tax"         DECIMAL NOT NULL DEFAULT 0,
  "net"         DECIMAL NOT NULL DEFAULT 0,
  "employee_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE
);

CREATE TABLE "leave_requests" (
  "id"          INTEGER PRIMARY KEY AUTOINCREMENT,
  "kind"        VARCHAR(32) NOT NULL DEFAULT 'annual',
  "starts_on"   DATE,
  "ends_on"     DATE,
  "status"      VARCHAR(32) NOT NULL DEFAULT 'pending',
  "employee_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE
);

INSERT INTO "departments" ("name", "budget") VALUES
  ('Engineering', 1200000),
  ('People', 380000);

INSERT INTO "positions" ("title", "grade", "base_salary") VALUES
  ('Software Engineer', 'E3', 72000),
  ('Engineering Manager', 'M1', 98000),
  ('People Partner', 'P2', 61000);

INSERT INTO "employees" ("full_name", "email", "hired_on", "department_id", "position_id", "manager_id") VALUES
  ('Dana Whitfield', 'dana@corp.example', '2019-03-11', 1, 2, 0),
  ('Ibrahim Toure', 'ibrahim@corp.example', '2021-09-06', 1, 1, 1),
  ('Sofia Marchetti', 'sofia@corp.example', '2022-01-17', 2, 3, 0);

INSERT INTO "payslips" ("period", "gross", "tax", "net", "employee_id") VALUES
  ('2024-06', 8166.67, 2450.00, 5716.67, 1),
  ('2024-06', 6000.00, 1620.00, 4380.00, 2),
  ('2024-06', 5083.33, 1321.66, 3761.67, 3);

INSERT INTO "leave_requests" ("kind", "starts_on", "ends_on", "status", "employee_id") VALUES
  ('annual', '2024-08-05', '2024-08-16', 'approved', 2),
  ('sick', '2024-07-01', '2024-07-02', 'approved', 3),
  ('annual', '2024-09-23', '2024-10-04', 'pending', 1);
