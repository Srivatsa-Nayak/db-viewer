package com.dbviewer.auth;

/**
 * Holds the signed-in user's email for the current request thread, or null when the caller is
 * anonymous.
 *
 * <p>Most of the app works without an account. Only the actions that hand data out - exporting a
 * file and creating a share link - require one, and they check here.
 */
public final class AuthContext {

    private static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();

    private AuthContext() {
    }

    public static void set(String email) {
        CURRENT_USER.set(email);
    }

    /** The signed-in user's email, or null when nobody is signed in. */
    public static String get() {
        return CURRENT_USER.get();
    }

    public static boolean isAuthenticated() {
        String email = CURRENT_USER.get();
        return email != null && !email.isBlank();
    }

    /**
     * Returns the signed-in user's email, or throws so the controller can turn it into a 401.
     * Enforced server-side on purpose: gating only in the UI would be trivially bypassed.
     */
    public static String require() {
        String email = CURRENT_USER.get();
        if (email == null || email.isBlank()) {
            throw new UnauthorizedException("Create a free account to use this feature.");
        }
        return email;
    }

    public static void clear() {
        CURRENT_USER.remove();
    }
}
