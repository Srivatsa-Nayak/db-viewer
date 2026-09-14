package com.dbviewer.app.service;

import java.util.Map;

/**
 * Accounts, stored in the default database rather than per workspace — a user exists across
 * every file they open.
 *
 * @see com.dbviewer.app.service.impl.AuthServiceImpl
 */
public interface AuthService {

    /**
     * Registers a new account and returns a signed-in session for it.
     *
     * @throws com.dbviewer.app.exception.EmailAlreadyRegisteredException if the email is taken
     * @throws IllegalArgumentException if the email is malformed or the password is too weak
     */
    Map<String, Object> signup(String rawEmail, String password, String displayName);

    /**
     * Exchanges credentials for a session.
     *
     * @throws IllegalArgumentException if the email is unknown or the password is wrong — the
     *         same message either way, so the response cannot be used to discover which
     *         addresses are registered
     */
    Map<String, Object> login(String rawEmail, String password);

    /** The signed-in user's profile, or {@code null} when the request is anonymous. */
    Map<String, Object> currentUser();

    /**
     * Updates the signed-in user's display name and/or password.
     *
     * <p>Both are optional; passing neither is a no-op that still returns the current profile.
     * Changing the password requires the current one, because a session token is a weaker
     * credential than the password it was issued for — anyone who borrows an unlocked browser
     * should not be able to lock the owner out of their own account.
     *
     * @throws com.dbviewer.app.exception.UnauthorizedException if nobody is signed in
     * @throws IllegalArgumentException if the current password is wrong or the new one is weak
     */
    Map<String, Object> updateProfile(String displayName, String currentPassword, String newPassword);
}
