package com.dbviewer.app.service.impl;

import com.dbviewer.app.service.JwtService;
import com.dbviewer.app.service.AuthService;
import com.dbviewer.app.service.WorkspaceOwnershipService;
import com.dbviewer.app.workspace.ClientContext;
import com.dbviewer.app.common.Constants;
import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.exception.EmailAlreadyRegisteredException;
import com.dbviewer.app.exception.UnauthorizedException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Accounts, stored in the default database rather than per workspace - a user exists across
 * every file they open.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthServiceImpl implements AuthService {

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final Pattern UPPERCASE = Pattern.compile("[A-Z]");
    /** Anything that is not a letter or a digit counts, including punctuation and spaces. */
    private static final Pattern SPECIAL = Pattern.compile("[^A-Za-z0-9]");
    /** Matches the display_name column, so a long name is refused rather than silently cut. */
    private static final int MAX_DISPLAY_NAME_LENGTH = 120;

    private final JdbcTemplate jdbcTemplate;
    private final JwtService jwtService;
    private final WorkspaceOwnershipService ownershipService;

    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    @Override
    public Map<String, Object> signup(String rawEmail, String password, String displayName) {
        String email = normalizeEmail(rawEmail);

        if (!EMAIL.matcher(email).matches()) {
            throw new IllegalArgumentException("Enter a valid email address.");
        }
        // Checked before the password, deliberately. No password will make this signup work, so
        // reporting a password problem first would send the user off to fix the wrong thing and
        // only discover the real one on the next attempt.
        if (findByEmail(email) != null) {
            throw new EmailAlreadyRegisteredException(email);
        }
        validatePassword(password);

        String name = displayName == null || displayName.isBlank()
                ? email.substring(0, email.indexOf('@'))
                : displayName.trim();

        try {
            jdbcTemplate.update(Constants.Auth.INSERT_USER,
                    email, name, passwordEncoder.encode(password), Instant.now().toString());
        } catch (DataAccessException e) {
            // Backstop for two signups racing past the check above. The column is UNIQUE, so the
            // database refuses the second one - turn that into the same friendly message rather
            // than a 500.
            if (isUniqueViolation(e)) {
                throw new EmailAlreadyRegisteredException(email);
            }
            throw e;
        }

        log.info("Registered account {}", email);
        adoptAnonymousWork(email);
        return session(email, name);
    }

    /**
     * Checks the password policy, reporting every unmet rule at once rather than one per
     * attempt - otherwise the user is sent round the loop three times to discover the rules.
     *
     * <p>Only applied on signup: an existing account whose password predates a rule must still
     * be able to sign in.
     */
    private void validatePassword(String password) {
        List<String> missing = new ArrayList<>();

        if (password == null || password.length() < MIN_PASSWORD_LENGTH) {
            missing.add("at least " + MIN_PASSWORD_LENGTH + " characters");
        }
        if (password == null || !UPPERCASE.matcher(password).find()) {
            missing.add("a capital letter");
        }
        if (password == null || !SPECIAL.matcher(password).find()) {
            missing.add("a special character");
        }

        if (!missing.isEmpty()) {
            throw new IllegalArgumentException("Password needs " + joinReadable(missing) + ".");
        }
    }

    private String joinReadable(List<String> parts) {
        if (parts.size() == 1) {
            return parts.get(0);
        }
        return String.join(", ", parts.subList(0, parts.size() - 1))
                + " and " + parts.get(parts.size() - 1);
    }

    @Override
    public Map<String, Object> login(String rawEmail, String password) {
        String email = normalizeEmail(rawEmail);
        Map<String, Object> user = findByEmail(email);

        // The same message for "no such user" and "wrong password", so the response cannot be
        // used to discover which addresses are registered.
        if (user == null || password == null
                || !passwordEncoder.matches(password, String.valueOf(user.get("password_hash")))) {
            throw new IllegalArgumentException("Email or password is incorrect.");
        }
        adoptAnonymousWork(email);
        return session(email, String.valueOf(user.get("display_name")));
    }

    /**
     * Moves anything this browser made while signed out onto the account it has just entered.
     *
     * <p>Without it, making an account would look like losing your work: every file open in the
     * explorer belongs to {@code anon:<clientId>}, and the moment the caller starts presenting
     * an account instead, none of them are theirs any more.
     *
     * <p>It only ever moves workspaces that are still anonymous, so signing in as a second user
     * on a shared browser cannot take over the first user's files.
     */
    private void adoptAnonymousWork(String email) {
        ownershipService.adoptAnonymous(ClientContext.get(), email);
    }

    /** The signed-in user's profile, or null when the request is anonymous. */
    @Override
    public Map<String, Object> currentUser() {
        if (!AuthContext.isAuthenticated()) {
            return null;
        }
        Map<String, Object> user = findByEmail(AuthContext.get());
        if (user == null) {
            return null;
        }
        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("email", user.get("email"));
        profile.put("displayName", user.get("display_name"));
        return profile;
    }

    @Override
    public Map<String, Object> updateProfile(String displayName, String currentPassword, String newPassword) {
        String email = AuthContext.require();
        Map<String, Object> user = findByEmail(email);
        if (user == null) {
            throw new UnauthorizedException("Sign in again to edit your profile.");
        }

        // Verified before anything is written, so a rejected password change cannot leave the
        // name updated and the password not — the two arrive in one request and should land
        // as one change.
        boolean changingPassword = newPassword != null && !newPassword.isEmpty();
        if (changingPassword) {
            if (currentPassword == null || currentPassword.isEmpty()
                    || !passwordEncoder.matches(currentPassword, String.valueOf(user.get("password_hash")))) {
                throw new IllegalArgumentException("Your current password is incorrect.");
            }
            if (newPassword.equals(currentPassword)) {
                throw new IllegalArgumentException("The new password must be different from the current one.");
            }
            validatePassword(newPassword);
        }

        String name = String.valueOf(user.get("display_name"));
        if (displayName != null && !displayName.isBlank() && !displayName.trim().equals(name)) {
            name = displayName.trim();
            if (name.length() > MAX_DISPLAY_NAME_LENGTH) {
                throw new IllegalArgumentException(
                        "Name must be " + MAX_DISPLAY_NAME_LENGTH + " characters or fewer.");
            }
            jdbcTemplate.update(Constants.Auth.UPDATE_DISPLAY_NAME, name, email);
        }

        if (changingPassword) {
            jdbcTemplate.update(Constants.Auth.UPDATE_PASSWORD_HASH,
                    passwordEncoder.encode(newPassword), email);
            log.info("Password changed for {}", email);
        }

        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("email", email);
        profile.put("displayName", name);
        return profile;
    }

    private Map<String, Object> session(String email, String displayName) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("token", jwtService.issue(email));
        result.put("email", email);
        result.put("displayName", displayName);
        return result;
    }

    private Map<String, Object> findByEmail(String email) {
        try {
            return jdbcTemplate.queryForMap(Constants.Auth.SELECT_USER_BY_EMAIL, email);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }

    /**
     * Walks the cause chain looking for a unique-constraint failure.
     *
     * <p>Spring only maps this to {@code DuplicateKeyException} when it recognises the driver's
     * error codes, which it does not for SQLite - so the message is inspected as well.
     */
    private boolean isUniqueViolation(DataAccessException error) {
        if (error instanceof DuplicateKeyException) {
            return true;
        }
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            String message = cause.getMessage();
            if (message != null && message.toUpperCase().contains("UNIQUE")) {
                return true;
            }
            if (cause.getCause() == cause) {
                break;
            }
        }
        return false;
    }
}
