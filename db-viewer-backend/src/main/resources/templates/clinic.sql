-- Clinic / appointments starter schema.
-- Shows a chain three levels deep: departments -> doctors -> appointments -> prescriptions.

CREATE TABLE "departments" (
  "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"  VARCHAR(128) NOT NULL,
  "floor" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "doctors" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"          VARCHAR(128) NOT NULL,
  "speciality"    VARCHAR(128),
  "email"         VARCHAR(255),
  "department_id" INTEGER DEFAULT 0,
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE
);

CREATE TABLE "patients" (
  "id"            INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"          VARCHAR(128) NOT NULL,
  "date_of_birth" DATE,
  "phone"         VARCHAR(32),
  "email"         VARCHAR(255),
  "registered_on" DATE
);

CREATE TABLE "appointments" (
  "id"         INTEGER PRIMARY KEY AUTOINCREMENT,
  "scheduled_at" DATETIME,
  "status"     VARCHAR(32) NOT NULL DEFAULT 'booked',
  "reason"     VARCHAR(255),
  "patient_id" INTEGER DEFAULT 0,
  "doctor_id"  INTEGER DEFAULT 0,
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE,
  FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE
);

CREATE TABLE "medications" (
  "id"    INTEGER PRIMARY KEY AUTOINCREMENT,
  "name"  VARCHAR(128) NOT NULL,
  "form"  VARCHAR(32) NOT NULL DEFAULT 'tablet'
);

CREATE TABLE "prescriptions" (
  "id"             INTEGER PRIMARY KEY AUTOINCREMENT,
  "dosage"         VARCHAR(64),
  "days"           INTEGER NOT NULL DEFAULT 7,
  "appointment_id" INTEGER DEFAULT 0,
  "medication_id"  INTEGER DEFAULT 0,
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE,
  FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE
);

INSERT INTO "departments" ("name", "floor") VALUES
  ('General Practice', 1),
  ('Cardiology', 3),
  ('Dermatology', 2);

INSERT INTO "doctors" ("name", "speciality", "email", "department_id") VALUES
  ('Dr. Amara Silva', 'Family medicine', 'amara@clinic.example', 1),
  ('Dr. Jonas Weber', 'Cardiology', 'jonas@clinic.example', 2),
  ('Dr. Mei Lin', 'Dermatology', 'mei@clinic.example', 3);

INSERT INTO "patients" ("name", "date_of_birth", "phone", "email", "registered_on") VALUES
  ('Rosa Mendes', '1987-04-22', '+351 912 000 111', 'rosa@example.com', '2023-05-02'),
  ('Ken Adachi', '1965-11-03', '+81 90 1234 5678', 'ken@example.com', '2022-10-14'),
  ('Lucia Ferrari', '2001-07-19', '+39 320 456 7890', 'lucia@example.com', '2024-03-08');

INSERT INTO "appointments" ("scheduled_at", "status", "reason", "patient_id", "doctor_id") VALUES
  ('2024-07-01 09:30:00', 'completed', 'Annual check-up', 1, 1),
  ('2024-07-03 14:00:00', 'completed', 'Chest pain follow-up', 2, 2),
  ('2024-07-10 11:15:00', 'booked', 'Rash on forearm', 3, 3);

INSERT INTO "medications" ("name", "form") VALUES
  ('Amoxicillin', 'capsule'),
  ('Atorvastatin', 'tablet'),
  ('Hydrocortisone', 'cream');

INSERT INTO "prescriptions" ("dosage", "days", "appointment_id", "medication_id") VALUES
  ('500mg twice daily', 7, 1, 1),
  ('20mg once daily', 30, 2, 2),
  ('Apply thinly twice daily', 14, 3, 3);
