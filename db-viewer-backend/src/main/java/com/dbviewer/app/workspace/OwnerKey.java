package com.dbviewer.app.workspace;

import com.dbviewer.app.auth.AuthContext;

/**
 * Who the current request belongs to, as a single string for the {@code workspace_owners} table.
 *
 * <p>Two kinds of owner, deliberately in one namespace so a workspace row never has to say which
 * kind it holds:
 *
 * <ul>
 *   <li>{@code user:<email>} — a signed-in account. Survives sign-out, a new browser, another
 *       machine.</li>
 *   <li>{@code anon:<clientId>} — one anonymous browser. Survives a refresh, because the id is
 *       kept in localStorage, but nothing more.</li>
 * </ul>
 *
 * <p>The account wins whenever there is one, which is what makes signing in on a second machine
 * show the same files.
 */
public final class OwnerKey {

    public static final String USER_PREFIX = "user:";
    public static final String ANON_PREFIX = "anon:";

    private OwnerKey() {
    }

    /** The owner of the current request, or null when the caller has no identity at all. */
    public static String current() {
        if (AuthContext.isAuthenticated()) {
            return forUser(AuthContext.get());
        }
        String clientId = ClientContext.get();
        return clientId == null ? null : forAnonymous(clientId);
    }

    public static String forUser(String email) {
        return USER_PREFIX + email;
    }

    public static String forAnonymous(String clientId) {
        return ANON_PREFIX + clientId;
    }
}
