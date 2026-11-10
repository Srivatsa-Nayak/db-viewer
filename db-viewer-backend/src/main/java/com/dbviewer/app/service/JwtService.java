package com.dbviewer.app.service;

/**
 * Issues and verifies the stateless session tokens handed to the browser after sign-in.
 *
 * @see com.dbviewer.app.service.impl.JwtServiceImpl
 */
public interface JwtService {

    /**
     * Signs a token identifying the given account.
     *
     * @param passwordStamp a short fingerprint of the account's password hash at sign-in
     *                      ({@code AuthService#passwordStamp}). Changing the password changes the
     *                      stamp, which is what makes every token issued before it stop working.
     */
    String issue(String email, String passwordStamp);

    /**
     * Returns who the token was issued for, or {@code null} when it is missing, forged, expired,
     * or signed by a previous run's key. All of those mean "anonymous".
     */
    VerifiedToken verify(String token);

    /**
     * A token that checked out.
     *
     * @param passwordStamp the stamp the token carries, or {@code null} for a token issued
     *                      before stamps existed — those cannot be revoked by a password change,
     *                      and simply expire within the token lifetime
     */
    record VerifiedToken(String email, String passwordStamp) { }
}
