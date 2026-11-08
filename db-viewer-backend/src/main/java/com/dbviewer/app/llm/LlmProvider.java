package com.dbviewer.app.llm;

/**
 * The model vendors the chat can talk to.
 *
 * <p>Two wire formats between three providers: OpenAI and OpenRouter both speak the OpenAI
 * chat-completions API, and Anthropic speaks its own Messages API. That split is the only reason
 * this is an enum rather than a string — {@link LlmClient} branches on it once, to pick a request
 * shape and a stream parser, and nothing else in the application needs to know which is in use.
 */
public enum LlmProvider {

    /** The application's own default. One account, many models, one key to fund. */
    OPENROUTER("OpenRouter", "openai/gpt-4o"),

    /** A user's own Anthropic key. */
    ANTHROPIC("Anthropic", "claude-sonnet-5"),

    /** A user's own OpenAI key. */
    OPENAI("OpenAI", "gpt-4o");

    private final String label;
    private final String defaultModel;

    LlmProvider(String label, String defaultModel) {
        this.label = label;
        this.defaultModel = defaultModel;
    }

    public String label() {
        return label;
    }

    public String defaultModel() {
        return defaultModel;
    }

    /** True when this provider speaks the OpenAI chat-completions wire format. */
    public boolean isOpenAiCompatible() {
        return this != ANTHROPIC;
    }

    /** Parses a stored or submitted provider name, falling back to null rather than throwing. */
    public static LlmProvider parse(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        for (LlmProvider provider : values()) {
            if (provider.name().equalsIgnoreCase(name.trim())) {
                return provider;
            }
        }
        return null;
    }

    /**
     * Guesses the provider from the shape of the key, so the user does not have to answer a
     * question their clipboard already answers.
     *
     * <p>The prefixes are the vendors' own and are stable: Anthropic issues {@code sk-ant-…},
     * OpenRouter {@code sk-or-…}, and OpenAI everything else beginning {@code sk-}. A guess is
     * only ever a default — the form still shows which provider was picked, and the user can
     * change it, because a wrong guess would otherwise fail at the far end with a 401 that
     * explains nothing.
     */
    public static LlmProvider detect(String apiKey) {
        if (apiKey == null) {
            return null;
        }
        String key = apiKey.trim();
        if (key.startsWith("sk-ant-")) {
            return ANTHROPIC;
        }
        if (key.startsWith("sk-or-")) {
            return OPENROUTER;
        }
        if (key.startsWith("sk-")) {
            return OPENAI;
        }
        return null;
    }
}
