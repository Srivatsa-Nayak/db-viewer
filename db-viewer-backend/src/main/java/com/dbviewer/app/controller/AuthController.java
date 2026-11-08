package com.dbviewer.app.controller;

import com.dbviewer.app.exception.EmailAlreadyRegisteredException;
import com.dbviewer.app.service.ApiKeyService;
import com.dbviewer.app.service.AuthService;
import com.dbviewer.app.exception.UnauthorizedException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Sign-up and sign-in.
 *
 * <p>An account is optional: importing, editing and visualising all work anonymously. It is only
 * required for the two actions that take data out of the app - exporting a file and creating a
 * share link.
 */
@Slf4j
@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
@Tag(name = "Authentication")
public class AuthController {

    private final AuthService authService;
    private final ApiKeyService apiKeyService;

    public record Credentials(String email, String password, String displayName) {
    }

    /** Both halves are optional; send only what is changing. */
    public record ProfileUpdate(String displayName, String currentPassword, String newPassword) {
    }

    @PostMapping("/signup")
    @Operation(summary = "Create an account")
    public ResponseEntity<?> signup(@RequestBody Credentials request) {
        try {
            return ResponseEntity.ok(
                    authService.signup(request.email(), request.password(), request.displayName()));
        } catch (EmailAlreadyRegisteredException e) {
            // 409 Conflict, and a flag the UI keys off to offer "sign in instead" rather than
            // just printing an error.
            return ResponseEntity.status(409).body(Map.of(
                    "error", e.getMessage(),
                    "emailAlreadyRegistered", true,
                    "email", e.getEmail()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Signup failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Could not create the account."));
        }
    }

    @PostMapping("/login")
    @Operation(summary = "Sign in")
    public ResponseEntity<?> login(@RequestBody Credentials request) {
        try {
            return ResponseEntity.ok(authService.login(request.email(), request.password()));
        } catch (IllegalArgumentException e) {
            // 401 rather than 400: the request was well formed, the credentials were not.
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Login failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Could not sign in."));
        }
    }

    @PatchMapping("/profile")
    @Operation(summary = "Update profile",
            description = "Changes the signed-in user's display name and/or password. Changing "
                    + "the password requires the current one.")
    public ResponseEntity<?> updateProfile(@RequestBody ProfileUpdate request) {
        try {
            return ResponseEntity.ok(authService.updateProfile(
                    request.displayName(), request.currentPassword(), request.newPassword()));
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Profile update failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Could not update your profile."));
        }
    }

    /** The user's own model API key. Only ever a description of it - never the key itself. */
    public record ApiKeyUpdate(String provider, String apiKey, String model) {
    }

    @GetMapping("/api-key")
    @Operation(summary = "Model API key status",
            description = "Which key the chat assistant would use for this account, masked, and "
                    + "what the fallback is. The key itself is never returned.")
    public ResponseEntity<?> apiKey() {
        try {
            return ResponseEntity.ok(apiKeyService.describe());
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/api-key")
    @Operation(summary = "Store your own model API key",
            description = "Stores the key encrypted. The provider is deliberately not called "
                    + "to check it, so saving costs nothing; a wrong key is reported on the "
                    + "first question. Send `provider` as ANTHROPIC, OPENAI or OPENROUTER, or "
                    + "omit it to infer the provider from the key.")
    public ResponseEntity<?> saveApiKey(@RequestBody ApiKeyUpdate request) {
        try {
            return ResponseEntity.ok(apiKeyService.save(
                    request.provider(), request.apiKey(), request.model()));
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            // A malformed request: an empty key, or one of no recognisable shape. The key is not
            // checked against the provider, so "this key does not work" never arrives here.
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Could not store the API key", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Could not save the key."));
        }
    }

    @DeleteMapping("/api-key")
    @Operation(summary = "Forget your model API key",
            description = "Reverts to the application's own key.")
    public ResponseEntity<?> deleteApiKey() {
        try {
            return ResponseEntity.ok(apiKeyService.clear());
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/me")
    @Operation(summary = "Current user",
            description = "Returns the signed-in user, or null when the caller is anonymous.")
    public ResponseEntity<?> me() {
        Map<String, Object> user = authService.currentUser();
        return ResponseEntity.ok(user == null ? Map.of() : user);
    }
}
