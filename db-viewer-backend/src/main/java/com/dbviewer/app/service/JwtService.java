package com.dbviewer.app.service;

/**
 * Issues and verifies the stateless session tokens handed to the browser after sign-in.
 *
 * @see com.dbviewer.app.service.impl.JwtServiceImpl
 */
public interface JwtService {

    /** Signs a token identifying the given account. */
    String issue(String email);

    /**
     * Returns the email the token was issued for, or {@code null} when it is missing, forged,
     * expired, or signed by a previous run's key. All of those mean "anonymous".
     */
    String verify(String token);
}
