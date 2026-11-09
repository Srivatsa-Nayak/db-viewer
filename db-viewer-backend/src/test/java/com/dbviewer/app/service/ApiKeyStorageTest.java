package com.dbviewer.app.service;

import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.common.Constants;
import com.dbviewer.app.llm.LlmClient;
import com.dbviewer.app.llm.LlmCredentials;
import com.dbviewer.app.llm.LlmProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * Bring-your-own API keys: where they are kept, what comes back out, and which one pays.
 *
 * <p>The provider is mocked, so nothing here talks to a model vendor. What is being tested is
 * the storage contract around the key — encrypted going in, never returned coming out, and the
 * user's own key taking precedence over the application's.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite:file:apikeys?mode=memory&cache=shared",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite",
        "app.auth.secret=test-secret-for-the-api-key-suite-0123456789",
        "app.llm.api-key=the-applications-own-key",
        "app.llm.provider=OPENROUTER",
        "app.llm.model=openai/gpt-4o"
})
class ApiKeyStorageTest {

    private static final String EMAIL = "byok@example.com";
    private static final String ANTHROPIC_KEY = "sk-ant-api03-Tm90QVJlYWxLZXlBdEFsbA-4f2a";

    @Autowired
    private ApiKeyService apiKeyService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    /**
     * The vendor, mocked — and never called.
     *
     * <p>It is here as a tripwire rather than a stub: nothing in this service should reach a
     * provider, and a mock that is asserted to have no interactions is how that stays true when
     * somebody later adds a "just check it works" call back in.
     */
    @MockBean
    private LlmClient llmClient;

    @BeforeEach
    void createAccount() {
        jdbcTemplate.update("DELETE FROM app_users WHERE email = ?", EMAIL);
        jdbcTemplate.update(Constants.Auth.INSERT_USER,
                EMAIL, "BYOK", "not-a-real-hash", Instant.now().toString());
        AuthContext.set(EMAIL);
    }

    @AfterEach
    void removeAccount() {
        jdbcTemplate.update("DELETE FROM app_users WHERE email = ?", EMAIL);
        AuthContext.clear();
    }

    private String storedCipher() {
        return jdbcTemplate.queryForObject(
                "SELECT llm_key_cipher FROM app_users WHERE email = ?", String.class, EMAIL);
    }

    /* ------------------------------------------------------------------ *
     * Storing
     * ------------------------------------------------------------------ */

    @Test
    void savingAKeyStoresItEncryptedAndNeverInTheClear() {
        apiKeyService.save(null, ANTHROPIC_KEY, null);

        assertThat(storedCipher())
                .isNotNull()
                .isNotEqualTo(ANTHROPIC_KEY)
                .doesNotContain(ANTHROPIC_KEY);
    }

    @Test
    void theKeyIsNeverHandedBackToTheCaller() {
        apiKeyService.save(null, ANTHROPIC_KEY, null);

        // Flattened to one string so this cannot pass by the key hiding in a nested value.
        assertThat(apiKeyService.describe().toString()).doesNotContain(ANTHROPIC_KEY);
    }

    @Test
    void theMaskedHintIdentifiesTheKeyWithoutBeingOne() {
        apiKeyService.save(null, ANTHROPIC_KEY, null);

        String hint = String.valueOf(apiKeyService.describe().get("hint"));
        assertThat(hint).isEqualTo("sk-ant-…4f2a");
        assertThat(hint.length()).isLessThan(ANTHROPIC_KEY.length());
    }

    @Test
    void theProviderIsInferredFromTheKeyWhenItIsNotGiven() {
        apiKeyService.save(null, ANTHROPIC_KEY, null);

        Map<String, Object> described = apiKeyService.describe();
        assertThat(described.get("provider")).isEqualTo("ANTHROPIC");
        assertThat(described.get("usingOwnKey")).isEqualTo(true);
        // No model was given, so the provider's default stands in.
        assertThat(described.get("model")).isEqualTo(LlmProvider.ANTHROPIC.defaultModel());
    }

    @Test
    void anExplicitProviderOverridesTheGuess() {
        // A key that looks like OpenAI's but is actually routed through OpenRouter. The guess
        // exists to save typing, not to overrule the user.
        apiKeyService.save("OPENROUTER", "sk-plainlooking-key-1234", null);

        assertThat(apiKeyService.describe().get("provider")).isEqualTo("OPENROUTER");
    }

    @Test
    void aKeyOfNoRecognisableShapeIsRefusedRatherThanGuessedAt() {
        assertThatThrownBy(() -> apiKeyService.save(null, "hunter2", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not look like");
    }

    @Test
    void anEmptyKeyIsRefused() {
        assertThatThrownBy(() -> apiKeyService.save("OPENAI", "  ", null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /* ------------------------------------------------------------------ *
     * Cost
     * ------------------------------------------------------------------ */

    @Test
    void savingAKeySpendsNothing() {
        // The guarantee this suite exists to protect. Saving used to verify the key against the
        // provider first, which is one model call per save on the user's own account — so the
        // act of pasting a key cost them money, repeatedly if they pasted it twice. A key that
        // does not work now announces itself on the first question instead, where the chat's
        // error path gives the same advice a failed check would have.
        apiKeyService.save(null, ANTHROPIC_KEY, null);
        apiKeyService.clear();
        apiKeyService.save("OPENAI", "sk-proj-another-one-entirely", "gpt-4o");
        apiKeyService.describe();

        verifyNoInteractions(llmClient);
    }

    /* ------------------------------------------------------------------ *
     * Which key pays
     * ------------------------------------------------------------------ */

    @Test
    void withoutAnOwnKeyTheApplicationsKeyIsUsed() {
        LlmCredentials resolved = apiKeyService.resolve();

        assertThat(resolved.ownKey()).isFalse();
        assertThat(resolved.provider()).isEqualTo(LlmProvider.OPENROUTER);
        assertThat(resolved.apiKey()).isEqualTo("the-applications-own-key");
    }

    @Test
    void anOwnKeyTakesPrecedence() {
        apiKeyService.save("ANTHROPIC", ANTHROPIC_KEY, "claude-sonnet-5");

        LlmCredentials resolved = apiKeyService.resolve();

        assertThat(resolved.ownKey()).isTrue();
        assertThat(resolved.provider()).isEqualTo(LlmProvider.ANTHROPIC);
        assertThat(resolved.apiKey()).isEqualTo(ANTHROPIC_KEY);
        assertThat(resolved.model()).isEqualTo("claude-sonnet-5");
    }

    /**
     * A stored key that can no longer be decrypted (a rotated {@code AUTH_SECRET}, or a restart
     * without one) must be reported as such, and must not silently spend the app's key while
     * the profile says "your key".
     */
    @Test
    void anUnreadableKeyIsReportedAndNotSilentlyReplacedByTheAppsKey() {
        apiKeyService.save("ANTHROPIC", ANTHROPIC_KEY, null);
        // What a rotated secret looks like from here: a ciphertext the current key cannot open.
        jdbcTemplate.update("UPDATE app_users SET llm_key_cipher = ? WHERE email = ?",
                "bm90LWEtY2lwaGVydGV4dC10aGlzLWtleS1jYW4tb3Blbg==", EMAIL);

        Map<String, Object> described = apiKeyService.describe();
        assertThat(described.get("keyUnreadable")).isEqualTo(true);
        assertThat(described.get("usingOwnKey")).isEqualTo(false);

        assertThatThrownBy(() -> apiKeyService.resolve())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("can no longer be read");

        // Removing it is the deliberate way back to the app's key.
        apiKeyService.clear();
        assertThat(apiKeyService.resolve().ownKey()).isFalse();
    }

    @Test
    void theStoredKeyIsBoundToItsOwner() {
        apiKeyService.save("ANTHROPIC", ANTHROPIC_KEY, null);
        String sealed = storedCipher();

        // Copied into somebody else's row, it does not open for them.
        jdbcTemplate.update("DELETE FROM app_users WHERE email = ?", "thief@example.com");
        jdbcTemplate.update(Constants.Auth.INSERT_USER,
                "thief@example.com", "T", "not-a-real-hash", Instant.now().toString());
        jdbcTemplate.update("UPDATE app_users SET llm_provider = 'ANTHROPIC', llm_key_cipher = ? "
                + "WHERE email = ?", sealed, "thief@example.com");
        AuthContext.set("thief@example.com");
        try {
            assertThatThrownBy(() -> apiKeyService.resolve())
                    .hasMessageContaining("can no longer be read");
        } finally {
            AuthContext.set(EMAIL);
            jdbcTemplate.update("DELETE FROM app_users WHERE email = ?", "thief@example.com");
        }
    }

    @Test
    void theModelCanBeChangedWithoutPastingTheKeyAgain() {
        apiKeyService.save("ANTHROPIC", ANTHROPIC_KEY, null);

        Map<String, Object> after = apiKeyService.updateModel("claude-haiku-5-5");

        assertThat(after.get("model")).isEqualTo("claude-haiku-5-5");
        assertThat(apiKeyService.resolve().apiKey()).isEqualTo(ANTHROPIC_KEY);
        // Blank goes back to the provider's default.
        assertThat(apiKeyService.updateModel(" ").get("model"))
                .isEqualTo(LlmProvider.ANTHROPIC.defaultModel());
    }

    @Test
    void aModelIdOfTheWrongShapeIsRefused() {
        assertThatThrownBy(() -> apiKeyService.save("ANTHROPIC", ANTHROPIC_KEY, "claude; DROP TABLE"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("model id");
        // OpenRouter ids with slashes, dots and colons are fine.
        apiKeyService.save("OPENROUTER", "sk-or-v1-abcdefghijklmnop", "anthropic/claude-sonnet-4.5:beta");
        assertThat(apiKeyService.resolve().model()).isEqualTo("anthropic/claude-sonnet-4.5:beta");
    }

    @Test
    void changingTheModelWithNoKeySavedIsRefused() {
        assertThatThrownBy(() -> apiKeyService.updateModel("gpt-4o"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Save an API key first");
    }

    @Test
    void clearingRevertsToTheApplicationsKeyWithoutDeletingTheAccount() {
        apiKeyService.save(null, ANTHROPIC_KEY, null);

        Map<String, Object> after = apiKeyService.clear();

        assertThat(after.get("usingOwnKey")).isEqualTo(false);
        assertThat(after.get("hint")).isNull();
        assertThat(storedCipher()).isNull();
        assertThat(apiKeyService.resolve().ownKey()).isFalse();
        // The user is still a user.
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM app_users WHERE email = ?", Integer.class, EMAIL))
                .isEqualTo(1);
    }

    @Test
    void describeSaysWhetherThereIsAFallbackAtAll() {
        Map<String, Object> described = apiKeyService.describe();

        // The profile dialog needs this to say whether adding a key is optional or required.
        assertThat(described.get("defaultAvailable")).isEqualTo(true);
        assertThat(described.get("defaultProviderLabel")).isEqualTo("OpenRouter");
        assertThat(described.get("defaultModel")).isEqualTo("openai/gpt-4o");
    }

    @Test
    void signedOutCallersCannotReadOrWriteAKey() {
        AuthContext.clear();

        assertThatThrownBy(() -> apiKeyService.describe())
                .hasMessageContaining("account");
        assertThatThrownBy(() -> apiKeyService.save(null, ANTHROPIC_KEY, null))
                .hasMessageContaining("account");
    }
}
