package com.dbviewer.app.llm;

/**
 * Everything needed to make one model call, resolved before the call is made.
 *
 * @param provider which vendor, and therefore which wire format
 * @param apiKey   the decrypted key — never logged, never returned to the browser
 * @param model    the model id to ask for
 * @param ownKey   true when this is the user's own key rather than the application's default.
 *                 The UI says which is in use, because it changes who is being billed.
 */
public record LlmCredentials(LlmProvider provider, String apiKey, String model, boolean ownKey) {
}
