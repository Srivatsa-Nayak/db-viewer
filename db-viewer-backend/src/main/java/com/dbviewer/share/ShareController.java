package com.dbviewer.share;

import com.dbviewer.auth.UnauthorizedException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** Read-only share links. Creating one needs an account; opening one does not. */
@Slf4j
@RestController
@RequiredArgsConstructor
@Tag(name = "Sharing")
public class ShareController {

    private final ShareService shareService;

    public record ShareRequest(String fileName) {
    }

    @PostMapping("/share")
    @Operation(summary = "Create a share link",
            description = "Creates a read-only link for the workspace named by X-Workspace-Id. "
                    + "Requires an account.")
    public ResponseEntity<?> create(@RequestBody(required = false) ShareRequest request) {
        try {
            return ResponseEntity.ok(
                    shareService.createLink(request == null ? null : request.fileName()));
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Create share link failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Could not create the share link."));
        }
    }

    @GetMapping("/share/{token}")
    @Operation(summary = "View a shared file",
            description = "Public: the token is the credential. Returns the schema read-only.")
    public ResponseEntity<?> view(@PathVariable String token) {
        try {
            return ResponseEntity.ok(shareService.viewShared(token));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Share view failed", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Could not open the shared file."));
        }
    }

    @GetMapping("/shares")
    @Operation(summary = "List my share links")
    public ResponseEntity<?> listMine() {
        try {
            return ResponseEntity.ok(Map.of("shares", shareService.listMine()));
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("List shares failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/share/{token}")
    @Operation(summary = "Revoke a share link")
    public ResponseEntity<?> revoke(@PathVariable String token) {
        try {
            shareService.revoke(token);
            return ResponseEntity.ok(Map.of("message", "Share link revoked"));
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Revoke share failed", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}
