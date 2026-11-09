package com.dbviewer.app.config;

import com.dbviewer.app.auth.RequiresAccountInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** MVC interceptors. Today, only the account gate for handlers marked {@code @RequiresAccount}. */
@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final RequiresAccountInterceptor requiresAccountInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(requiresAccountInterceptor);
    }
}
