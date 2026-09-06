package com.dbviewer.auth;

import lombok.Getter;

/**
 * Signup was attempted with an address that already has an account.
 *
 * <p>Distinct from a plain validation error so the API can flag it explicitly: the UI turns it
 * into a "sign in instead" prompt rather than a dead end, which is the only useful next step.
 */
@Getter
public class EmailAlreadyRegisteredException extends RuntimeException {

    private final String email;

    public EmailAlreadyRegisteredException(String email) {
        super("An account with " + email + " already exists. Sign in instead.");
        this.email = email;
    }
}
