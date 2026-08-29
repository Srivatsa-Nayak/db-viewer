# 📊 SQL Visualizer

A full-stack application for importing relational data (CSV or SQL), visualizing the resulting database schema as an interactive diagram, editing table data, and exporting the result back out as SQL or CSV.

Built with **Spring Boot (Java 17)** for the backend and **Next.js** for the frontend.

## 🚀 Features

- **📂 CSV / SQL Import**: Upload `.csv` or `.sql` files to populate the database.
- **🕸️ Schema Visualization**: Interactive entity-relationship diagram powered by **React Flow**.
- **🔗 Relationship Inference**: Foreign keys are inferred from column naming conventions (e.g. a column named `id` or ending in `_id`).
- **✏️ Table Data Editor**: View, edit, add, and delete rows directly from the schema canvas.
- **🧱 Table & Column Management**: Create new tables and add columns through the UI.
- **⬇️ Export**: Export a single table as CSV or the whole database as SQL.
- **📑 API Docs**: OpenAPI/Swagger UI generated from the backend.

---

## 🛠️ Tech Stack

### Backend (`db-viewer-backend`)
- **Language**: Java 17
- **Framework**: Spring Boot 3.3
- **Database**: SQLite (default, file-based) or MySQL (via the `mysql` Spring profile)
- **Docs**: springdoc-openapi (Swagger UI)

### Frontend (`db-viewer-ui`)
- **Framework**: [Next.js](https://nextjs.org/) 16 (App Router)
- **Language**: TypeScript (strict mode)
- **Visualization**: [React Flow](https://reactflow.dev/)
- **Styling**: Tailwind CSS v4
- **HTTP Client**: Axios
- **Icons**: Lucide React

---

## ⚙️ Prerequisites

- **Java**: 17 or higher
- **Node.js**: 20 or higher
- **npm**: (comes with Node.js)

---

## 🧑‍💻 Local Development

**Backend** — runs on `http://localhost:8080` (SQLite mode by default):

```bash
cd db-viewer-backend
./mvnw spring-boot:run        # or mvnw.cmd spring-boot:run on Windows
```

Swagger UI: `http://localhost:8080/swagger-ui.html`

**Frontend** — runs on `http://localhost:3000`:

```bash
cd db-viewer-ui
npm install
npm run dev
```

The frontend reads the backend URL from `NEXT_PUBLIC_API_URL`, falling back to `http://localhost:8080` if unset (`db-viewer-ui/services/api.ts`).

### Running the backend against MySQL

```bash
cd db-viewer-backend
docker-compose --profile mysql up
```

---

## ☁️ Deployment (Azure)

Both apps are deployed as separate Azure App Service Web Apps on a shared free (F1) Linux plan:

| App | Azure Web App | URL |
|---|---|---|
| Backend | `db-viewer-api-srivatsa` | https://db-viewer-api-srivatsa.azurewebsites.net |
| Frontend | `db-viewer-ui-srivatsa` | https://db-viewer-ui-srivatsa.azurewebsites.net |

Deploys run via GitHub Actions on push to `master`, scoped by path so a change to one app doesn't redeploy the other:

- `.github/workflows/deploy-backend.yml` — builds the Maven jar and deploys it to `db-viewer-api-srivatsa`.
- `.github/workflows/deploy-frontend.yml` — builds the Next.js `standalone` output (with `NEXT_PUBLIC_API_URL` baked in at build time) and deploys it to `db-viewer-ui-srivatsa`.

Both workflows authenticate via a publish profile stored as a GitHub Actions secret (`AZURE_BACKEND_PUBLISH_PROFILE` / `AZURE_FRONTEND_PUBLISH_PROFILE`).

---

## 📁 Project Structure

```
db-viewer/
  db-viewer-backend/    Spring Boot API (Java 17)
  db-viewer-ui/         Next.js frontend
  .github/workflows/    CI/CD pipelines for Azure deployment
```

See each subproject's own README/AGENTS/CLAUDE docs for details on its internal structure.
