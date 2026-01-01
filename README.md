# 📊 SQL Visualizer

A full-stack application that allows users to upload relational data (CSVs), visualize the database schema dynamically, and execute SQL queries in an interactive environment.

Built with **Go (Golang)** for the high-performance backend and **Next.js** for a modern, interactive frontend.

## 🚀 Features

-   **📂 CSV Import**: Upload multiple CSV files to instantly create an in-memory SQLite database.
-   **🕸️ Schema Visualization**: Interactive Entity-Relationship (ER) diagram using **React Flow**.
-   **🤖 Auto-Inference**: Automatically detects data types (`INT`, `VARCHAR`, `BOOL`, `DECIMAL`) and relationships (Foreign Keys) based on column naming conventions (e.g., `user_id` links to `users`).
-   **📝 SQL Editor**: Full-featured SQL code editor powered by **Monaco Editor** (VS Code engine).
-   **🌗 Dark/Light Mode**: Fully responsive UI with theme switching.
-   **⚡ In-Memory Engine**: Uses SQLite in-memory mode for fast, ephemeral testing sessions.

---

## 🛠️ Tech Stack

### **Backend (Go)**
-   **Language**: Go (Golang)
-   **Framework**: [Gin](https://github.com/gin-gonic/gin) (HTTP Web Framework)
-   **Database**: [SQLite](https://modernc.org/sqlite) (Embedded, Serverless)
-   **Docs**: Swagger (Swaggo)

### **Frontend (Next.js)**
-   **Framework**: [Next.js 14](https://nextjs.org/) (App Router)
-   **Visualization**: [React Flow](https://reactflow.dev/)
-   **Editor**: [Monaco Editor](https://github.com/suren-atoyan/monaco-react)
-   **Styling**: Tailwind CSS
-   **Icons**: Lucide React

---

## ⚙️ Prerequisites

Before running the project, ensure you have the following installed:
-   **Go**: v1.20 or higher
-   **Node.js**: v18 or higher
-   **npm**: (Comes with Node.js)

---

## 🏃‍♂️ Getting Started

### 1. Clone the Repository
```bash
git clone [https://github.com/YOUR_USERNAME/sql-visualizer.git](https://github.com/YOUR_USERNAME/sql-visualizer.git)
cd sql-visualizer