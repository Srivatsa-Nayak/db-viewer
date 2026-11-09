package com.dbviewer.app.service.impl;

import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.auth.SecretCipher;
import com.dbviewer.app.common.Constants;
import com.dbviewer.app.llm.LlmCredentials;
import com.dbviewer.app.llm.LlmProvider;
import com.dbviewer.app.service.ApiKeyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Stores and resolves model API keys.
 *
 * @see ApiKeyService for why keys live on the account rather than the workspace
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ApiKeyServiceImpl implements ApiKeyService {

    /** Leading characters kept in the masked hint — enough to identify the vendor. */
    private static final int HINT_PREFIX = 7;
    /** Trailing characters kept — enough to tell two keys from the same vendor apart. */
    private static final int HINT_SUFFIX = 4;
    /** Below this a key has nothing worth masking, so the hint is dropped entirely. */
    private static final int HINT_MIN_LENGTH = HINT_PREFIX + HINT_SUFFIX + 2;

    private final JdbcTemplate jdbcTemplate;
    private final SecretCipher cipher;

    @Value("${app.llm.api-key:}")
    private String defaultApiKey;

    @Value("${app.llm.provider:OPENROUTER}")
    private String defaultProviderName;

    @Value("${app.llm.model:}")
    private String defaultModel;

    /* ------------------------------------------------------------------ *
     * The application's own key
     * ------------------------------------------------------------------ */

    private LlmProvider defaultProvider() {
        LlmProvider provider = LlmProvider.parse(defaultProviderName);
        return provider == null ? LlmProvider.OPENROUTER : provider;
    }

    private boolean hasDefaultKey() {
        return defaultApiKey != null && !defaultApiKey.isBlank();
    }

    private String defaultModelOrFallback() {
        return defaultModel == null || defaultModel.isBlank()
                ? defaultProvider().defaultModel()
                : defaultModel.trim();
    }

    /* ------------------------------------------------------------------ *
     * The user's key
     * ------------------------------------------------------------------ */

    @Override
    public Map<String, Object> describe() {
        String email = AuthContext.require();
        Map<String, Object> row = findUser(email);

        Map<String, Object> result = new LinkedHashMap<>();
        LlmProvider stored = LlmProvider.parse(text(row, "llm_provider"));
        boolean hasStored = stored != null && text(row, "llm_key_cipher") != null;
        // Decrypted, not just looked for. A ciphertext that is there but cannot be read (the
        // secret was rotated, or the server restarted without one) is not a working key, and
        // the profile used to say "Using your key" about it while the chat could not use it.
        boolean unreadable = hasStored
                && cipher.decrypt(text(row, "llm_key_cipher"), email) == null;

        result.put("usingOwnKey", hasStored && !unreadable);
        result.put("keyUnreadable", unreadable);
        result.put("provider", hasStored ? stored.name() : null);
        result.put("providerLabel", hasStored ? stored.label() : null);
        result.put("model", hasStored ? modelOf(row, stored) : null);
        result.put("hint", hasStored ? text(row, "llm_key_hint") : null);

        // What happens if they do nothing. A UI that cannot say whether there is a fallback
        // cannot say whether adding a key is optional.
        result.put("defaultAvailable", hasDefaultKey());
        result.put("defaultProviderLabel", defaultProvider().label());
        result.put("defaultModel", defaultModelOrFallback());

        // Surfaced so a misconfigured deployment explains itself in the profile dialog instead
        // of silently forgetting the key on the next restart.
        result.put("keysSurviveRestart", cipher.isDurable());
        result.put("providers", providerCatalogue());
        return result;
    }

    /** The choices the profile form offers, with each vendor's default model as a placeholder. */
    private List<Map<String, Object>> providerCatalogue() {
        return java.util.Arrays.stream(LlmProvider.values())
                .map(p -> Map.<String, Object>of(
                        "id", p.name(),
                        "label", p.label(),
                        "defaultModel", p.defaultModel()))
                .toList();
    }

    @Override
    public Map<String, Object> save(String providerName, String apiKey, String model) {
        String email = AuthContext.require();

        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalArgumentException("Paste an API key.");
        }
        String key = apiKey.trim();

        LlmProvider provider = LlmProvider.parse(providerName);
        if (provider == null) {
            provider = LlmProvider.detect(key);
        }
        if (provider == null) {
            throw new IllegalArgumentException(
                    "That does not look like an Anthropic, OpenAI or OpenRouter key. "
                            + "Pick the provider explicitly if you are sure it is right.");
        }

        String chosenModel = chooseModel(provider, model);

        // Deliberately stored without asking the provider whether it works. Verifying would be
        // one model call per save — small, but real money on the user's own account, and it is
        // their key to get wrong. A key that does not work announces itself on the first
        // question instead, and the chat's error path names the provider and says to re-enter
        // it in the profile, which is the same advice a failed check here would have given.
        jdbcTemplate.update(Constants.Auth.UPDATE_LLM_KEY,
                provider.name(), cipher.encrypt(key, email), chosenModel, mask(key), email);
        log.info("Stored an own-key {} credential for {}", provider.label(), email);

        return describe();
    }

    @Override
    public Map<String, Object> updateModel(String model) {
        String email = AuthContext.require();
        LlmProvider stored = LlmProvider.parse(text(findUser(email), "llm_provider"));
        if (stored == null) {
            throw new IllegalArgumentException("Save an API key first, then choose its model.");
        }
        jdbcTemplate.update(Constants.Auth.UPDATE_LLM_MODEL, chooseModel(stored, model), email);
        return describe();
    }

    /** The provider's default for a blank id; otherwise the id, if it is shaped like one. */
    private String chooseModel(LlmProvider provider, String model) {
        if (model == null || model.isBlank()) {
            return provider.defaultModel();
        }
        String trimmed = model.trim();
        if (!LlmProvider.isValidModelId(trimmed)) {
            throw new IllegalArgumentException("That does not look like a model id. Use the id "
                    + "exactly as " + provider.label() + " lists it, for example "
                    + provider.defaultModel() + ".");
        }
        return trimmed;
    }

    @Override
    public Map<String, Object> clear() {
        String email = AuthContext.require();
        jdbcTemplate.update(Constants.Auth.CLEAR_LLM_KEY, email);
        log.info("Removed the stored model key for {}", email);
        return describe();
    }

    @Override
    public LlmCredentials resolve() {
        // Deliberately tolerant of an anonymous caller: the chat controller is the place that
        // decides whether an account is required, and resolving credentials is not that decision.
        String email = AuthContext.get();
        if (email != null && !email.isBlank()) {
            LlmCredentials own = ownCredentials(email);
            if (own != null) {
                return own;
            }
        }
        if (!hasDefaultKey()) {
            throw new IllegalStateException(
                    "No model API key is configured. Add your own key in your profile, or set "
                            + "app.llm.api-key on the server.");
        }
        return new LlmCredentials(
                defaultProvider(), defaultApiKey.trim(), defaultModelOrFallback(), false);
    }

    /** The user's key, or null when they have none or it can no longer be decrypted. */
    private LlmCredentials ownCredentials(String email) {
        Map<String, Object> row = findUser(email);
        LlmProvider provider = LlmProvider.parse(text(row, "llm_provider"));
        if (provider == null) {
            return null;
        }
        String stored = text(row, "llm_key_cipher");
        String key = cipher.decrypt(stored, email);
        if (key == null) {
            // The secret was rotated, or the server restarted without one configured. This used
            // to fall back to the application's key silently, which billed the operator for a
            // user who believed they were paying, and showed "your key" in the profile while
            // doing it. Refusing is the honest answer: the user re-enters the key, or removes it
            // to use the app's key on purpose.
            log.warn("The stored model key for {} could not be decrypted", email);
            throw new IllegalStateException(
                    "Your saved " + provider.label() + " API key can no longer be read - the "
                            + "server's secret has changed. Paste it again in your profile, or "
                            + "remove it to use the app's key.");
        }
        if (cipher.isLegacy(stored)) {
            // Saved before the cipher bound keys to their owner. Re-saved now that it has been
            // read, so the old format does not have to be supported for ever.
            try {
                jdbcTemplate.update(Constants.Auth.UPDATE_LLM_KEY_CIPHER,
                        cipher.encrypt(key, email), email);
            } catch (Exception e) {
                log.debug("Could not upgrade the stored key for {}: {}", email, e.getMessage());
            }
        }
        return new LlmCredentials(provider, key, modelOf(row, provider), true);
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    private Map<String, Object> findUser(String email) {
        try {
            return jdbcTemplate.queryForMap(Constants.Auth.SELECT_USER_BY_EMAIL, email);
        } catch (EmptyResultDataAccessException e) {
            return Map.of();
        }
    }

    private String modelOf(Map<String, Object> row, LlmProvider provider) {
        String stored = text(row, "llm_model");
        return stored == null ? provider.defaultModel() : stored;
    }

    /** Null-safe column read that also folds a blank string into null. */
    private String text(Map<String, Object> row, String column) {
        Object value = row.get(column);
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value);
        return text.isBlank() ? null : text;
    }

    /** {@code sk-ant-…4f2a}. Identifies the key without being one. */
    private String mask(String key) {
        if (key.length() < HINT_MIN_LENGTH) {
            return "…";
        }
        return key.substring(0, HINT_PREFIX) + "…" + key.substring(key.length() - HINT_SUFFIX);
    }
}
