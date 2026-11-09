package com.dbviewer.app.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The guards added after the review: request limits, the account gate, and CORS.
 *
 * <p>Limits are set low here so the tests can reach them; the defaults are far higher.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite:file:hardening?mode=memory&cache=shared",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite",
        "app.auth.secret=a-test-signing-secret-long-enough-for-hmac-hardening",
        "app.ratelimit.signup-per-hour=3",
        "app.ratelimit.login-per-10-minutes=50",
        "app.cors.allowed-origins=http://localhost:3000"
})
class SecurityHardeningTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    /**
     * Every route marked {@link RequiresAccount} refuses a signed-out caller. Walks the real
     * mapping table, so a route annotated tomorrow is covered without touching this test.
     */
    @Test
    void everyAccountOnlyRouteRefusesAnAnonymousCaller() throws Exception {
        List<String> checked = new ArrayList<>();
        for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : mappings.getHandlerMethods().entrySet()) {
            if (!RequiresAccountInterceptor.requiresAccount(entry.getValue())) continue;
            RequestMappingInfo info = entry.getKey();
            for (String pattern : info.getPatternValues()) {
                String path = pattern.replaceAll("\\{[^}]+}", "x");
                for (var method : info.getMethodsCondition().getMethods()) {
                    mockMvc.perform(request(HttpMethod.valueOf(method.name()), path)
                                    .contentType(MediaType.APPLICATION_JSON).content("{}"))
                            .andExpect(status().isUnauthorized());
                    checked.add(method + " " + path);
                }
            }
        }
        // The routes the review found unguarded or guarded only by convention.
        assertThat(checked).contains("POST /query", "POST /scratchpad", "POST /chat",
                "GET /export-sql", "POST /share", "PUT /auth/api-key", "PATCH /auth/api-key");
    }

    @Test
    void signupsArePerAddressLimited() throws Exception {
        int refused = 0;
        for (int i = 0; i < 5; i++) {
            int code = mockMvc.perform(post("/auth/signup").header("X-Forwarded-For", "203.0.113.7")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("email", "flood" + i + "@example.com",
                                    "password", "A-good-password"))))
                    .andReturn().getResponse().getStatus();
            if (code == 429) refused++;
        }
        assertThat(refused).isEqualTo(2);

        // A different address is unaffected.
        mockMvc.perform(post("/auth/signup").header("X-Forwarded-For", "203.0.113.8")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "other@example.com", "password", "A-good-password"))))
                .andExpect(status().isOk());
    }

    /**
     * Only the last X-Forwarded-For hop is trusted: that is the one the proxy appended. Anything
     * before it came from the client, so rotating it must not reset the limit.
     */
    @Test
    void aForgedForwardedForPrefixDoesNotEvadeTheLimit() throws Exception {
        int refused = 0;
        for (int i = 0; i < 5; i++) {
            int code = mockMvc.perform(post("/auth/signup")
                            .header("X-Forwarded-For", "10.0.0." + i + ", 198.51.100.9")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("email", "forged" + i + "@example.com",
                                    "password", "A-good-password"))))
                    .andReturn().getResponse().getStatus();
            if (code == 429) refused++;
        }
        assertThat(refused).isEqualTo(2);
    }

    @Test
    void repeatedFailedSignInsLockTheAccountForAWhile() throws Exception {
        mockMvc.perform(post("/auth/signup").header("X-Forwarded-For", "192.0.2.50")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "target@example.com", "password", "A-good-password"))))
                .andExpect(status().isOk());

        for (int i = 0; i < 10; i++) {
            mockMvc.perform(post("/auth/login").header("X-Forwarded-For", "192.0.2." + (60 + i))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("email", "target@example.com", "password", "wrong" + i))))
                    .andExpect(status().isUnauthorized());
        }
        // From yet another address, and with the right password: still locked for now.
        mockMvc.perform(post("/auth/login").header("X-Forwarded-For", "192.0.2.99")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "TARGET@example.com", "password", "A-good-password"))))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void corsAllowsTheConfiguredOriginAndNoOther() throws Exception {
        mockMvc.perform(options("/db-info").header("Origin", "http://localhost:3000")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:3000"));

        mockMvc.perform(options("/db-info").header("Origin", "https://evil.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/db-info").header("Origin", "https://evil.example"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void onlyTheHealthEndpointIsExposedAndItSaysNothingElse() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .content().json("{\"status\":\"UP\"}", true));
        mockMvc.perform(get("/actuator/env")).andExpect(status().isNotFound());
        mockMvc.perform(get("/actuator/beans")).andExpect(status().isNotFound());
    }

    @Test
    void anUnexpectedServerErrorDoesNotLeakItsMessage() throws Exception {
        // A malformed workspace id is a 400 with a message the caller can act on…
        mockMvc.perform(get("/db-info").header("X-Workspace-Id", "bad id!"))
                .andExpect(status().isBadRequest());
        // …and the generic 500 path carries a reference rather than internals. Exercised
        // directly, because a route that 500s on purpose would be a bug to keep.
        var response = com.dbviewer.app.controller.ErrorResponsesProbe.unexpected();
        assertThat(response.getStatusCode().value()).isEqualTo(500);
        assertThat(String.valueOf(response.getBody())).contains("Reference").doesNotContain("secret-path");
    }
}
