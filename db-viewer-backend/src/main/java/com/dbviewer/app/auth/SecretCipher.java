package com.dbviewer.app.auth;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Symmetric encryption for the few secrets the application has to store and read back.
 *
 * <p>Only one thing needs this today: a user's own LLM API key. That key cannot be hashed the way
 * a password is — a password is only ever compared, while an API key has to be recovered in full
 * and sent to the provider — so it is encrypted at rest instead.
 *
 * <p>AES-GCM rather than AES-CBC because GCM authenticates as well as encrypts: a ciphertext
 * edited in the database fails to decrypt rather than decrypting to something else. The nonce is
 * fresh per call and stored in front of the ciphertext, which is what makes encrypting the same
 * key twice produce two different rows.
 *
 * <p>The key is derived from {@code app.auth.secret} by SHA-256, so deployments have one secret to
 * manage rather than two. That has a consequence worth stating plainly: <b>rotating
 * {@code AUTH_SECRET} makes every stored API key unreadable</b>, exactly as it invalidates every
 * session token. {@link #decrypt} answers null in that case instead of throwing, and the caller
 * asks the user to enter the key again — a stored secret that cannot be read is a re-entry prompt,
 * not a server error.
 */
@Slf4j
@Component
public class SecretCipher {

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecureRandom random = new SecureRandom();

    @Value("${app.auth.secret:}")
    private String configuredSecret;

    private SecretKey key;

    /** True when the secret is configured, so keys stored now survive a restart. */
    private boolean durable;

    @PostConstruct
    void init() {
        byte[] material;
        if (configuredSecret == null || configuredSecret.isBlank()) {
            // Mirrors JwtServiceImpl: a committed default would let anyone read every stored key
            // out of a leaked database file, so an ephemeral key is the safer failure. The user
            // is asked to re-enter theirs after a restart, which is annoying but not dangerous.
            material = new byte[32];
            random.nextBytes(material);
            durable = false;
            log.warn("app.auth.secret is not set - stored API keys will not survive a restart. "
                    + "Set AUTH_SECRET in any real deployment.");
        } else {
            material = sha256(configuredSecret.getBytes(StandardCharsets.UTF_8));
            durable = true;
        }
        key = new SecretKeySpec(material, "AES");
    }

    public boolean isDurable() {
        return durable;
    }

    /** Encrypts to {@code base64(nonce || ciphertext || tag)}. */
    public String encrypt(String plaintext) {
        try {
            byte[] nonce = new byte[NONCE_BYTES];
            random.nextBytes(nonce);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] combined = new byte[nonce.length + sealed.length];
            System.arraycopy(nonce, 0, combined, 0, nonce.length);
            System.arraycopy(sealed, 0, combined, nonce.length, sealed.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            // Encryption failing means the JVM has no AES, which is not a condition the caller
            // can do anything useful about.
            throw new IllegalStateException("Could not encrypt the secret.", e);
        }
    }

    /**
     * Reverses {@link #encrypt}, or returns null when the ciphertext cannot be read — a rotated
     * secret, a restart without one configured, or a row that has been tampered with. All three
     * mean the same thing to the caller: ask for the key again.
     */
    public String decrypt(String ciphertext) {
        if (ciphertext == null || ciphertext.isBlank()) {
            return null;
        }
        try {
            byte[] combined = Base64.getDecoder().decode(ciphertext);
            if (combined.length <= NONCE_BYTES) {
                return null;
            }
            byte[] nonce = new byte[NONCE_BYTES];
            System.arraycopy(combined, 0, nonce, 0, NONCE_BYTES);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            byte[] plain = cipher.doFinal(
                    combined, NONCE_BYTES, combined.length - NONCE_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("A stored secret could not be decrypted: {}", e.getMessage());
            return null;
        }
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable.", e);
        }
    }
}
