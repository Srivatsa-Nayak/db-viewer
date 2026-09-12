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
}
