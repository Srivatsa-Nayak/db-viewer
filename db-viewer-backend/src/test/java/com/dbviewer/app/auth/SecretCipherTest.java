package com.dbviewer.app.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

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
    void aConfiguredSecretMakesStoredKeysDurable() {
        // The inverse — a blank secret producing a per-boot key — is warned about at startup and
        // reported to the profile dialog, so the UI can explain why a key vanished.
        assertThat(cipher.isDurable()).isTrue();
    }
}
