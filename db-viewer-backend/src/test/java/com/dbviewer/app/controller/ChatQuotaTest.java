package com.dbviewer.app.controller;

import com.dbviewer.app.llm.LlmClient;
import com.dbviewer.app.llm.LlmException;
import com.dbviewer.app.llm.StreamResult;
import com.dbviewer.app.llm.Usage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Spend control on the assistant, through the real controller with the provider stubbed out.
 *
 * <p>The quota exists because accounts are free: without it, one script could sign up and spend
 * the application's key without limit. The limits here are set low so the tests can reach them.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite:file:chatquota?mode=memory&cache=shared",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite",
        "app.auth.secret=a-test-signing-secret-long-enough-for-hmac-chat",
        "app.llm.api-key=the-apps-own-key",
        "app.llm.provider=OPENROUTER",
        "app.llm.quota.app-key-per-hour=2",
        "app.llm.quota.app-key-per-day=5"
})
class ChatQuotaTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcTemplate appDb;

    @MockBean LlmClient llmClient;

    private String token;

    @BeforeEach
    void signUp() throws Exception {
        String email = "quota" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        String response = mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", email, "password", "A-good-password"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = "Bearer " + objectMapper.readTree(response).get("token").asText();
    }

    @SuppressWarnings("unchecked")
    private void providerAnswers(String text) {
        // doAnswer rather than when(...): re-stubbing with when() calls the mock, which throws
        // if an earlier stub in the same test made it throw.
        doAnswer(invocation -> {
            ((Consumer<String>) invocation.getArgument(3)).accept(text);
            return new StreamResult(text.length(), "stop", new Usage(1000, 20, 800, 0.0001));
        }).when(llmClient).stream(any(), any(), any(), any());
    }

    private MvcResult ask() throws Exception {
        return mockMvc.perform(post("/chat").header("Authorization", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"What tables are there?\",\"history\":[]}"))
                .andReturn();
    }

    private String finish(MvcResult started) throws Exception {
        return mockMvc.perform(asyncDispatch(started)).andReturn().getResponse().getContentAsString();
    }

    @Test
    void theAppsKeyIsCappedPerUserPerHour() throws Exception {
        providerAnswers("Two tables.");

        assertThat(finish(ask())).contains("event: done");
        assertThat(finish(ask())).contains("event: done");

        MvcResult third = ask();
        assertThat(third.getResponse().getStatus()).isEqualTo(429);
        assertThat(third.getResponse().getHeader("Retry-After")).isNotBlank();
        assertThat(finish(third)).contains("questions this hour");
    }

    /** A provider outage should not use up anyone's questions. */
    @Test
    void aFailedAnswerIsNotCounted() throws Exception {
        when(llmClient.stream(any(), any(), any(), any()))
                .thenThrow(new LlmException("No endpoints available", 503));

        for (int i = 0; i < 4; i++) {
            assertThat(finish(ask())).contains("event: error");
        }

        providerAnswers("Back now.");
        assertThat(finish(ask())).contains("event: done");
    }

    /**
     * "Out of credit" was the wrong message for this 402: the account had credit, just not
     * enough for the requested max_tokens, and the user kept creating new keys. The provider's
     * reason is shown instead, minus the link to the app key's settings page.
     */
    @Test
    void aPaymentRefusalShowsTheProvidersReasonWithoutTheAppKeysLink() throws Exception {
        when(llmClient.stream(any(), any(), any(), any())).thenThrow(new LlmException(
                "This request requires more credits, or fewer max_tokens. You requested up to 8192 "
                        + "tokens, but can only afford 300. To increase, visit "
                        + "https://openrouter.ai/workspaces/default/keys/abc123 and adjust the limit", 402));

        String stream = finish(ask());

        assertThat(stream).contains("event: error").contains("can only afford 300")
                .contains("Add your own key").doesNotContain("openrouter.ai/workspaces");
    }

    @Test
    void usageIsRecordedPerUserAndModel() throws Exception {
        providerAnswers("Logged.");
        Long before = appDb.queryForObject(
                "SELECT COALESCE(SUM(requests), 0) FROM llm_usage WHERE own_key = 0", Long.class);

        finish(ask());

        Map<String, Object> totals = appDb.queryForMap(
                "SELECT COALESCE(SUM(requests), 0) r, COALESCE(SUM(cached_tokens), 0) c "
                        + "FROM llm_usage WHERE own_key = 0");
        assertThat(((Number) totals.get("r")).longValue()).isEqualTo(before + 1);
        assertThat(((Number) totals.get("c")).longValue()).isGreaterThanOrEqualTo(800);
    }

    @Test
    void configReportsWhatIsLeftToday() throws Exception {
        providerAnswers("One.");
        finish(ask());

        mockMvc.perform(get("/chat/config").header("Authorization", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.usingOwnKey").value(false))
                .andExpect(jsonPath("$.quota.limit").value(5))
                .andExpect(jsonPath("$.quota.remaining").value(4));
    }

    @Test
    void aTruncatedAnswerSaysSoInTheDoneFrame() throws Exception {
        when(llmClient.stream(any(), any(), any(), any())).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            Consumer<String> out = (Consumer<String>) invocation.getArgument(3);
            out.accept("CREATE TABLE t (");
            return new StreamResult(16, "length", Usage.NONE);
        });

        assertThat(finish(ask())).contains("\"truncated\":true");
    }

    @Test
    void signedOutCallersAreRefused() throws Exception {
        mockMvc.perform(post("/chat").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }
}
