package com.dbviewer.app.controller;

import com.dbviewer.app.auth.RequiresAccount;
import com.dbviewer.app.service.SnapshotService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Saved versions of the current file. Account-only: a version is a full copy of a file kept on
 * the server, and that storage belongs to someone who can be asked to delete it.
 */
@RestController
@RequiredArgsConstructor
@RequiresAccount
@RequestMapping("/snapshots")
public class SnapshotController {

    private final SnapshotService snapshotService;

    public record CreateRequest(String name) { }

    @GetMapping
    @Operation(summary = "List Versions", description = "This file's saved versions, newest first.",
            tags = {"Versions"})
    public ResponseEntity<?> list() {
        return ResponseEntity.ok(Map.of("snapshots", snapshotService.list()));
    }

    @PostMapping
    @Operation(summary = "Save A Version", description = "Saves the file's tables and rows as they are now.",
            tags = {"Versions"})
    public ResponseEntity<?> create(@RequestBody(required = false) CreateRequest request) {
        return ResponseEntity.ok(snapshotService.create(request == null ? null : request.name()));
    }

    @GetMapping("/{id}/schema")
    @Operation(summary = "A Version's Schema", description = "The tables and relationships a version recorded, "
            + "for comparing with the file now.", tags = {"Versions"})
    public ResponseEntity<?> schema(@PathVariable long id) {
        return ResponseEntity.ok(snapshotService.schema(id));
    }

    @PostMapping("/{id}/restore")
    @Operation(summary = "Restore A Version", description = "Replaces the file's tables and rows with the "
            + "version's. If it cannot be restored the file is left as it was.", tags = {"Versions"})
    public ResponseEntity<?> restore(@PathVariable long id) {
        return ResponseEntity.ok(snapshotService.restore(id));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete A Version", tags = {"Versions"})
    public ResponseEntity<?> delete(@PathVariable long id) {
        snapshotService.delete(id);
        return ResponseEntity.ok(Map.of("deleted", id));
    }
}
