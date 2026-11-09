package com.dbviewer.app.service;

import com.dbviewer.app.llm.LlmCredentials;

import java.util.Map;

/**
 * The signed-in user's own model API key: storing it, forgetting it, and deciding whose key a
 * chat message is billed to.
 *
 * <p>Keys belong to the account rather than the workspace — a user brings one key to every file
 * they open — so they live in {@code app_users} in the default database, encrypted, beside the
 * password hash.
 */
public interface ApiKeyService {

    /**
     * What the profile dialog shows: which key is in use, masked, and what the fallback is.
     *
     * <p>Never includes the key itself. A secret the server will hand back is a secret that
     * leaks through a screenshot, a browser cache or a proxy log, and nothing in the UI needs
     * it — the masked hint is enough to tell a stale key from the current one.
     */
    Map<String, Object> describe();

    /**
     * Stores a key.
     *
     * <p>Checked for shape, not for validity — nothing here calls the provider. A live check
     * would prove the key works, but it costs one model call per save against the user's own
     * account, and a key they typed wrong is theirs to correct. It announces itself on the
     * first question instead, and the chat's error path gives the same advice a failed check
     * would have: the provider rejected it, re-enter it in your profile.
     *
     * @param provider {@code ANTHROPIC}, {@code OPENAI} or {@code OPENROUTER}; null to infer
     *                 it from the key's own prefix
     * @param model    a model id to override the provider's default, or null
     */
    Map<String, Object> save(String provider, String apiKey, String model);

    /**
     * Changes the model used with the stored key, without the key being pasted again — the key
     * is never shown back, so asking for it to change a model id would mean finding it again.
     *
     * @param model a model id, or blank for the provider's default
     * @throws IllegalArgumentException when no key is stored, or the id is not one
     */
    Map<String, Object> updateModel(String model);

    /** Forgets the stored key, so the user falls back to the application's own. */
    Map<String, Object> clear();

    /**
     * The credentials the next model call should use: the user's key when they have a usable
     * one, otherwise the application's default.
     *
     * @throws IllegalStateException when neither exists, which is a deployment that has not been
     *                               configured rather than anything the user did wrong
     */
    LlmCredentials resolve();
}
