package com.dbviewer.app.auth;

import com.dbviewer.app.service.JwtService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Two things every response depends on: whether a token is still good after a password change,
 * and the headers {@code SecurityHeadersFilter} puts on every answer.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite",
        "app.auth.secret=a-test-signing-secret-long-enough-for-hmac",
        "app.ratelimit.enabled=false"
})
class SessionAndHeadersTest {

    private static final String PASSWORD = "First-password1";
    private static final String NEW_PASSWORD = "Second-password2";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JwtService jwtService;

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    private String signUp(String email) throws Exception {
        String body = mockMvc.perform(post("/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", email, "password", PASSWORD))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return "Bearer " + objectMapper.readTree(body).get("token").asText();
    }

    private String emailSeenWith(String bearer) throws Exception {
        String body = mockMvc.perform(get("/auth/me").header("Authorization", bearer))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        var email = objectMapper.readTree(body).get("email");
        return email == null ? null : email.asText();
    }

    // ─── Sessions ─────────────────────────────────────────────────────────────────

    @Test
    void changingThePassword_signsOutOtherDevices_andKeepsThisOne() throws Exception {
        String laptop = signUp("revoke@example.com");
        String body = mockMvc.perform(post("/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "revoke@example.com", "password", PASSWORD))))
                .andReturn().getResponse().getContentAsString();
        String phone = "Bearer " + objectMapper.readTree(body).get("token").asText();
        assertThat(emailSeenWith(phone)).isEqualTo("revoke@example.com");

        String changed = mockMvc.perform(patch("/auth/profile")
                        .header("Authorization", laptop)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", PASSWORD, "newPassword", NEW_PASSWORD))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        String fresh = "Bearer " + objectMapper.readTree(changed).get("token").asText();

        // Both tokens issued before the change are refused - including the one that made it.
        assertThat(emailSeenWith(phone)).isNull();
        assertThat(emailSeenWith(laptop)).isNull();
        // The device that changed the password was handed a new one, and it works.
        assertThat(emailSeenWith(fresh)).isEqualTo("revoke@example.com");
    }

    @Test
    void changingOnlyTheName_keepsEveryToken() throws Exception {
        String bearer = signUp("rename@example.com");

        mockMvc.perform(patch("/auth/profile")
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("displayName", "New name"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").doesNotExist());

        assertThat(emailSeenWith(bearer)).isEqualTo("rename@example.com");
    }

    @Test
    void aTokenFromBeforeStampsExisted_isStillAcceptedUntilItExpires() throws Exception {
        signUp("legacy@example.com");
        String legacy = "Bearer " + jwtService.issue("legacy@example.com", null);

        assertThat(emailSeenWith(legacy)).isEqualTo("legacy@example.com");
    }

    @Test
    void aTokenWithAWrongStamp_isAnonymous() throws Exception {
        signUp("stamp@example.com");
        String forgedStamp = "Bearer " + jwtService.issue("stamp@example.com", "not-the-real-one");

        assertThat(emailSeenWith(forgedStamp)).isNull();
    }

    @Test
    void aTokenForAnAccountThatDoesNotExist_isAnonymous() throws Exception {
        String ghost = "Bearer " + jwtService.issue("nobody@example.com", "abcdefghijklmnop");

        assertThat(emailSeenWith(ghost)).isNull();
    }

    // ─── Headers ──────────────────────────────────────────────────────────────────

    @Test
    void everyResponse_carriesTheSecurityHeaders_andIsNotCached() throws Exception {
        MockHttpServletResponse response = mockMvc.perform(get("/auth/me"))
                .andExpect(status().isOk())
                .andReturn().getResponse();

        assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(response.getHeader("X-Frame-Options")).isEqualTo("DENY");
        assertThat(response.getHeader("Referrer-Policy")).isEqualTo("no-referrer");
        assertThat(response.getHeaders("Cache-Control")).containsExactly("no-store");
        // Plain HTTP: no HSTS.
        assertThat(response.getHeader("Strict-Transport-Security")).isNull();
    }

    @Test
    void aRefusedRequest_stillCarriesTheHeaders() throws Exception {
        MockHttpServletResponse response = mockMvc.perform(get("/db-info")
                        .header("X-Workspace-Id", "__sandbox"))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse();

        assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
    }

    @Test
    void aHandlersOwnCaching_replacesTheDefault_ratherThanSittingBesideIt() throws Exception {
        MockHttpServletResponse response = mockMvc.perform(get("/templates"))
                .andExpect(status().isOk())
                .andReturn().getResponse();

        assertThat(response.getHeaders("Cache-Control")).containsExactly("max-age=600, public");
    }

    @Test
    void behindAnHttpsProxy_hstsIsSent() throws Exception {
        MockHttpServletResponse response = mockMvc.perform(get("/auth/me")
                        .header("X-Forwarded-Proto", "https"))
                .andReturn().getResponse();

        assertThat(response.getHeader("Strict-Transport-Security")).isEqualTo("max-age=31536000");
    }
}
