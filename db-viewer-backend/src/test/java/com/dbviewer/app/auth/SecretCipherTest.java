package com.dbviewer.app.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Encryption of the secrets the application has to read back — today, a user's own model API key.
 *
 * <p>The properties below matter for a specific reason each, and all four are asserted rather
 * than assumed: a key must survive a round trip (or the feature does not work), two encryptions
 * of the same key must differ (or the database leaks which users share a key), an edited
 * ciphertext must fail (that is what GCM's tag is for), and a failure must be a null rather than
 * an exception (a secret that cannot be read is a re-entry prompt, not a 500).
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite",
        // 32+ characters, so the cipher derives a stable key rather than a per-boot random one.
        "app.auth.secret=test-secret-for-the-cipher-suite-0123456789"
})
class SecretCipherTest {

    private static final String API_KEY = "sk-ant-api03-ZG9udC1sb29rLWF0LW1lLXBsZWFzZQ";
    private static final String SECRET = "test-secret-for-the-cipher-suite-0123456789";

    @Autowired
    private SecretCipher cipher;

    @Test
    void encryptThenDecrypt_returnsTheOriginal() {
        assertThat(cipher.decrypt(cipher.encrypt(API_KEY))).isEqualTo(API_KEY);
    }

    @Test
    void ciphertextDoesNotContainThePlaintext() {
        assertThat(cipher.encrypt(API_KEY)).doesNotContain(API_KEY);
    }

    @Test
    void theSameKeyEncryptsDifferentlyEachTime() {
        // A fresh nonce per call. Without it, two users holding one team key would have identical
        // rows, which says something the database has no business saying.
        assertThat(cipher.encrypt(API_KEY)).isNotEqualTo(cipher.encrypt(API_KEY));
    }

    @Test
    void aTamperedCiphertextDecryptsToNull() {
        String sealed = cipher.encrypt(API_KEY);
        // Flip one character in the middle, well past the nonce.
        int at = sealed.length() / 2;
        char replacement = sealed.charAt(at) == 'A' ? 'B' : 'A';
        String edited = sealed.substring(0, at) + replacement + sealed.substring(at + 1);

        assertThat(cipher.decrypt(edited)).isNull();
    }

    @Test
    void garbageAndBlanksDecryptToNullRatherThanThrowing() {
        assertThat(cipher.decrypt("not base64 at all !!")).isNull();
        assertThat(cipher.decrypt("")).isNull();
        assertThat(cipher.decrypt(null)).isNull();
        // Valid base64, but too short to hold a nonce and a tag.
        assertThat(cipher.decrypt("AAAA")).isNull();
    }

    @Test
    void newCiphertextsAreVersioned() {
        assertThat(cipher.encrypt(API_KEY, "a@example.com")).startsWith("v1:");
        assertThat(cipher.isLegacy(cipher.encrypt(API_KEY))).isFalse();
    }

    /**
     * A ciphertext is bound to its owner. Without that, anyone able to write to the database
     * could copy one user's key into another user's row and spend it as them.
     */
    @Test
    void aCiphertextMovedToAnotherOwnerDoesNotDecrypt() {
        String sealed = cipher.encrypt(API_KEY, "alice@example.com");

        assertThat(cipher.decrypt(sealed, "alice@example.com")).isEqualTo(API_KEY);
        // Case does not matter: an email is one address however it was typed.
        assertThat(cipher.decrypt(sealed, "Alice@Example.com")).isEqualTo(API_KEY);
        assertThat(cipher.decrypt(sealed, "mallory@example.com")).isNull();
    }

    /** Keys saved before the v1 format was introduced must still be readable. */
    @Test
    void theFirstFormatIsStillRead() throws Exception {
        byte[] key = MessageDigest.getInstance("SHA-256")
                .digest(SECRET.getBytes(StandardCharsets.UTF_8));
        byte[] nonce = new byte[12];
        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        byte[] sealed = aes.doFinal(API_KEY.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[nonce.length + sealed.length];
        System.arraycopy(sealed, 0, combined, nonce.length, sealed.length);
        String legacy = Base64.getEncoder().encodeToString(combined);

        assertThat(cipher.isLegacy(legacy)).isTrue();
        assertThat(cipher.decrypt(legacy, "anyone@example.com")).isEqualTo(API_KEY);
    }

    @Test
    void theDerivedKeyIsNotTheSessionSigningSecretsHash() throws Exception {
        byte[] plainHash = MessageDigest.getInstance("SHA-256")
                .digest(SECRET.getBytes(StandardCharsets.UTF_8));
        assertThat(SecretCipher.hkdfSha256(SECRET.getBytes(StandardCharsets.UTF_8)))
                .hasSize(32)
                .isNotEqualTo(plainHash);
    }

    @Test
    void aConfiguredSecretMakesStoredKeysDurable() {
        // The inverse — a blank secret producing a per-boot key — is warned about at startup and
        // reported to the profile dialog, so the UI can explain why a key vanished.
        assertThat(cipher.isDurable()).isTrue();
    }
}
