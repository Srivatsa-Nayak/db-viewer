package com.dbviewer.app.workspace;

/**
 * Holds the calling browser's client id for the current request thread.
 *
 * <p>Workspaces belong to somebody. For a signed-in caller that is their account, but almost
 * everything in this app works signed out, and two anonymous visitors must still not see each
 * other's files. The client id is what gives an anonymous session an identity: the browser
 * generates one on first load, keeps it in localStorage and sends it on every request as
 * {@code X-Client-Id}.
 *
 * <p>It is not a credential and is not treated as one — it is a name for "this browser", in the
 * same spirit as a guest cart. Anything that genuinely needs to be protected (export, share)
 * still requires a real account.
 *
 * <p>A {@code null} value means the caller supplied no client id at all — a direct API or
 * Swagger call. Such a caller can still work with workspaces nobody has claimed, but can never
 * claim one, and can never touch one that somebody else owns.
 */
public final class ClientContext {

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    /** Client ids reach a database column and a log line, so the length is bounded. */
    private static final int MAX_LENGTH = 64;

    private ClientContext() {
    }

    public static void set(String clientId) {
        CURRENT.set(sanitize(clientId));
    }

    /** The calling browser's client id, or null when none was supplied or it was malformed. */
    public static String get() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }

    /**
     * Accepts only the shape the browser generates. A malformed id is dropped rather than
     * rejected: the request is still perfectly valid, it simply has no anonymous identity.
     */
    private static String sanitize(String clientId) {
        if (clientId == null) {
            return null;
        }
        String trimmed = clientId.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_LENGTH || !trimmed.matches("[A-Za-z0-9_-]+")) {
            return null;
        }
        return trimmed;
    }
}
