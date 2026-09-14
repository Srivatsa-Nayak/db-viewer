package com.dbviewer.app.config;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * CORS Configuration - mirrors gin-contrib/cors default settings
 */
@Configuration
public class CorsConfig {

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
        config.setAllowedOriginPatterns(List.of("*"));
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
