package com.dbviewer.app.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.Arrays;
import java.util.List;

/**
 * Which browser origins may call the API.
 *
 * <p>It used to be every origin ({@code *}). Credentials are off and auth is a bearer token, so
 * that was not an open door, but it let any page on the web drive the API from a visitor's
 * browser with whatever {@code X-Client-Id} it read or guessed. Now it is a list: the local dev
 * server and the deployed UI by default, overridable with {@code CORS_ALLOWED_ORIGINS}
 * (comma-separated; patterns such as {@code https://*.example.com} are allowed). Swagger UI is
 * served from the API's own origin and needs no entry.
 */
@Configuration
public class CorsConfig {

    @Value("${app.cors.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}")
    private String allowedOrigins;

    /**
     * Registered first in the chain, ahead of every application filter.
     *
     * <p>Ordering matters here, not just tidiness. {@code WorkspaceOwnershipFilter} answers a
     * request for somebody else's workspace with 403 and stops the chain — and a response that
     * never reaches this filter carries no {@code Access-Control-Allow-Origin}. The browser then
     * refuses to show the body at all, so the frontend sees an opaque network failure instead of
     * the 403 it knows how to explain. Every short-circuiting filter has the same problem, so
     * CORS runs before all of them.
     */
    @Bean
    public FilterRegistrationBean<CorsFilter> corsFilter() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(false);
        config.setMaxAge(86400L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);

        FilterRegistrationBean<CorsFilter> registration =
                new FilterRegistrationBean<>(new CorsFilter(source));
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }
}
