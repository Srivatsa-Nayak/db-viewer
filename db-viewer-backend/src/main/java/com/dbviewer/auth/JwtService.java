package com.dbviewer.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

/** Issues and verifies the stateless session tokens handed to the browser after sign-in. */
@Slf4j
@Service
public class JwtService {

    private static final Duration TOKEN_LIFETIME = Duration.ofDays(30);

    @Value("${app.auth.secret:}")
    private String configuredSecret;

    private SecretKey signingKey;

    @PostConstruct
    void init() {
        if (configuredSecret == null || configuredSecret.isBlank()) {
            // Deliberately random rather than a hardcoded fallback: a default secret committed to
            // the repository would let anyone mint valid tokens. The cost is that everyone is
            // signed out when the process restarts, which is the safer failure.
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            signingKey = Keys.hmacShaKeyFor(random);
            log.warn("app.auth.secret is not set - generated a random signing key. "
                    + "Sessions will not survive a restart. Set AUTH_SECRET in any real deployment.");
        } else if (configuredSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException(
                    "app.auth.secret must be at least 32 characters for HMAC-SHA256");
        } else {
            signingKey = Keys.hmacShaKeyFor(configuredSecret.getBytes(StandardCharsets.UTF_8));
        }
    }

    public String issue(String email) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(email)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(TOKEN_LIFETIME)))
                .signWith(signingKey)
                .compact();
    }

    /** Returns the email the token was issued for, or null when it is missing, forged or expired. */
    public String verify(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            return Jwts.parser()
                    .verifyWith(signingKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload()
                    .getSubject();
        } catch (Exception e) {
            // Expired, tampered with, or signed by a previous run's key. All mean "anonymous".
            return null;
        }
    }
}
