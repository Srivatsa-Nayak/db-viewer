package com.dbviewer.app.auth;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.Mac;
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
 * <h2>Format v1</h2>
 *
 * <p>{@code v1:base64(nonce || ciphertext || tag)}, under a key derived by HKDF-SHA256 with its
 * own label, and with the owner (the account's email) bound in as GCM associated data. Two things
 * that changed from the first format, and why:
 *
 * <ul>
 *   <li><b>Its own key.</b> The first format used {@code SHA-256(AUTH_SECRET)} directly, and the
 *       session-token signer uses the same secret. HKDF with a purpose label means the two keys
 *       share nothing but their root, which is the textbook separation for one secret serving
 *       two jobs. A separate root can be configured too ({@code app.llm.key-secret}), so rotating
 *       {@code AUTH_SECRET} no longer has to wipe every saved key.</li>
 *   <li><b>Bound to its row.</b> Without associated data, anyone who could write to the database
 *       could copy one user's ciphertext into another user's row, and the second user would then
 *       spend the first one's key. With the email as AAD, a moved ciphertext fails to decrypt.</li>
 * </ul>
 *
 * <p>Values without the prefix are the first format and are still read, so nothing already saved
 * is lost; {@code ApiKeyServiceImpl} re-saves such a key in v1 the next time it is used.
 *
 * <p>When no secret is configured at all, an ephemeral key is generated and {@link #decrypt}
 * answers null after a restart — a re-entry prompt, not a server error.
 */
@Slf4j
@Component
public class SecretCipher {

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;

    static final String V1_PREFIX = "v1:";

    /** HKDF info: names what the derived key is for, so no other use of the root can collide. */
    private static final byte[] HKDF_INFO = "dbviewer/llm-api-key/aes-gcm/v1".getBytes(StandardCharsets.UTF_8);

    /** HKDF salt. Fixed, which RFC 5869 allows; it only has to be the same every time. */
    private static final byte[] HKDF_SALT = "dbviewer-secret-cipher".getBytes(StandardCharsets.UTF_8);

    private final SecureRandom random = new SecureRandom();

    @Value("${app.auth.secret:}")
    private String authSecret;

    /** Optional root for this cipher alone; falls back to {@code app.auth.secret}. */
    @Value("${app.llm.key-secret:}")
    private String keySecret;

    /** The current key (v1). */
    private SecretKey key;

    /** The first format's key, {@code SHA-256(AUTH_SECRET)}, kept only to read old rows. */
    private SecretKey legacyKey;

    /** True when a secret is configured, so keys stored now survive a restart. */
    private boolean durable;

    @PostConstruct
    void init() {
        String root = !isBlank(keySecret) ? keySecret : authSecret;
        if (isBlank(root)) {
            // Mirrors JwtServiceImpl: a committed default would let anyone read every stored key
            // out of a leaked database file, so an ephemeral key is the safer failure. The user
            // is asked to re-enter theirs after a restart, which is annoying but not dangerous.
            byte[] material = new byte[32];
            random.nextBytes(material);
            key = new SecretKeySpec(material, "AES");
            durable = false;
            log.warn("Neither app.llm.key-secret nor app.auth.secret is set - stored API keys "
                    + "will not survive a restart. Set AUTH_SECRET in any real deployment.");
        } else {
            key = new SecretKeySpec(hkdfSha256(root.getBytes(StandardCharsets.UTF_8)), "AES");
            durable = true;
        }
        legacyKey = isBlank(authSecret)
                ? null
                : new SecretKeySpec(sha256(authSecret.getBytes(StandardCharsets.UTF_8)), "AES");
    }

    public boolean isDurable() {
        return durable;
    }

    /** True when {@code ciphertext} is in the first format and should be re-saved in v1. */
    public boolean isLegacy(String ciphertext) {
        return ciphertext != null && !ciphertext.isBlank() && !ciphertext.startsWith(V1_PREFIX);
    }

    /** As {@link #encrypt(String, String)} with no owner bound. */
    public String encrypt(String plaintext) {
        return encrypt(plaintext, "");
    }

    /**
     * Encrypts to {@code v1:base64(nonce || ciphertext || tag)}.
     *
     * @param owner who the secret belongs to; the same value must be given to decrypt it
     */
    public String encrypt(String plaintext, String owner) {
        try {
            byte[] nonce = new byte[NONCE_BYTES];
            random.nextBytes(nonce);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(aad(owner));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] combined = new byte[nonce.length + sealed.length];
            System.arraycopy(nonce, 0, combined, 0, nonce.length);
            System.arraycopy(sealed, 0, combined, nonce.length, sealed.length);
            return V1_PREFIX + Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            // Encryption failing means the JVM has no AES, which is not a condition the caller
            // can do anything useful about.
            throw new IllegalStateException("Could not encrypt the secret.", e);
        }
    }

    /** As {@link #decrypt(String, String)} with no owner bound. */
    public String decrypt(String ciphertext) {
        return decrypt(ciphertext, "");
    }

    /**
     * Reverses {@link #encrypt}, or returns null when the ciphertext cannot be read — a rotated
     * secret, a restart without one configured, a row that has been tampered with, or one moved
     * from another owner. All of them mean the same thing to the caller: ask for the key again.
     */
    public String decrypt(String ciphertext, String owner) {
        if (ciphertext == null || ciphertext.isBlank()) {
            return null;
        }
        if (ciphertext.startsWith(V1_PREFIX)) {
            return open(ciphertext.substring(V1_PREFIX.length()), key, aad(owner));
        }
        // The first format: no prefix, SHA-256 key, no associated data.
        return legacyKey == null ? null : open(ciphertext, legacyKey, null);
    }

    private String open(String encoded, SecretKey with, byte[] aad) {
        try {
            byte[] combined = Base64.getDecoder().decode(encoded);
            if (combined.length <= NONCE_BYTES) {
                return null;
            }
            byte[] nonce = new byte[NONCE_BYTES];
            System.arraycopy(combined, 0, nonce, 0, NONCE_BYTES);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, with, new GCMParameterSpec(TAG_BITS, nonce));
            if (aad != null) {
                cipher.updateAAD(aad);
            }
            byte[] plain = cipher.doFinal(combined, NONCE_BYTES, combined.length - NONCE_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.warn("A stored secret could not be decrypted: {}", e.getMessage());
            return null;
        }
    }

    private static byte[] aad(String owner) {
        // Lower-cased so an email typed with different capitals at sign-in still matches.
        return ("owner:" + (owner == null ? "" : owner.trim().toLowerCase()))
                .getBytes(StandardCharsets.UTF_8);
    }

    /** RFC 5869 HKDF with HMAC-SHA256, one 32-byte output block. */
    static byte[] hkdfSha256(byte[] inputKeyMaterial) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(HKDF_SALT, "HmacSHA256"));
            byte[] prk = mac.doFinal(inputKeyMaterial);

            mac.init(new SecretKeySpec(prk, "HmacSHA256"));
            mac.update(HKDF_INFO);
            mac.update((byte) 0x01);
            return mac.doFinal();
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable.", e);
        }
    }

    private static byte[] sha256(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable.", e);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
