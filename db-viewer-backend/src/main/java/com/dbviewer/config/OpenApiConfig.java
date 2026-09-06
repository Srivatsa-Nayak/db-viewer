package com.dbviewer.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger / OpenAPI configuration
 */
@Configuration
public class OpenApiConfig {

    @Value("${app.version:unknown}")
    private String appVersion;

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("Database Visualizer API")
                        .version(appVersion)
                        .description("A simple API to upload CSVs to SQLite and run queries.")
                        .contact(new Contact().name("DB Viewer")));
    }
}
