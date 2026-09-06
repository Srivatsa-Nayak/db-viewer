# ─── Build Stage ────────────────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /app

# Cache dependencies
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Build
COPY src ./src
RUN mvn clean package -DskipTests -B

# ─── Runtime Stage ───────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

RUN mkdir -p /data/workspaces

COPY --from=builder /app/target/db-viewer-*.jar app.jar

ENV DB_PATH=/data/visualizer.db
ENV WORKSPACE_DIR=/data/workspaces
# Override at run time: -e AUTH_SECRET=... (sessions reset on restart without it)
ENV AUTH_SECRET=""
ENV PORT=8080
ENV SPRING_PROFILES_ACTIVE=prod

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar", "--server.port=${PORT}"]
