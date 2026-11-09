package com.dbviewer.app.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.servlet.config.annotation.AsyncSupportConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The threads that write streamed responses — in practice, the assistant's answers.
 *
 * <p>A {@code StreamingResponseBody} runs on MVC's async executor, and each one holds a thread
 * for as long as the model takes to write, which can be a minute or two. Left to the defaults,
 * those threads come from the small general-purpose pool shared with anything else asynchronous,
 * so a handful of slow answers would queue everything behind them. A pool of its own, sized for
 * the case, keeps that contained; the per-user limit in {@code ChatController} keeps any one
 * account from filling it.
 *
 * <p>Also turns on {@code @Scheduled}, which {@code WorkspaceJanitor} runs on.
 */
@Configuration
@EnableScheduling
public class AsyncConfig implements WebMvcConfigurer {

    @Value("${app.streaming.max-threads:32}")
    private int maxThreads;

    @Value("${app.streaming.queue-capacity:64}")
    private int queueCapacity;

    @Value("${spring.mvc.async.request-timeout:180000}")
    private long timeoutMillis;

    @Override
    public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setThreadNamePrefix("stream-");
        executor.setCorePoolSize(Math.min(4, maxThreads));
        executor.setMaxPoolSize(maxThreads);
        executor.setQueueCapacity(queueCapacity);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        configurer.setTaskExecutor(executor);
        configurer.setDefaultTimeout(timeoutMillis);
    }
}
