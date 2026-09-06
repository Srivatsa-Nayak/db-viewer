package com.dbviewer.auth;

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

    public record Credentials(String email, String password, String displayName) {
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

    @GetMapping("/me")
    @Operation(summary = "Current user",
            description = "Returns the signed-in user, or null when the caller is anonymous.")
    public ResponseEntity<?> me() {
        Map<String, Object> user = authService.currentUser();
        return ResponseEntity.ok(user == null ? Map.of() : user);
    }
}
