package com.dbviewer.app.controller;

import com.dbviewer.app.service.TemplateService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.Map;

/**
 * The starter-schema catalogue.
 *
 * <p>Listing and reading are public: the landing page shows templates before anyone signs in or
 * opens a file. Applying one writes into a workspace, so it carries the usual workspace header.
 */
@Slf4j
@RestController
@RequestMapping("/templates")
@RequiredArgsConstructor
@Tag(name = "Templates")
public class TemplateController {

    /**
     * The catalogue only changes when a new build ships, so the browser is allowed to keep it.
     * This is the request the landing page makes on first paint, and serving it from cache on
     * a repeat visit removes a round trip before the templates can render.
     */
    private static final CacheControl CATALOGUE_CACHE =
            CacheControl.maxAge(Duration.ofMinutes(10)).cachePublic();

    private final TemplateService templateService;

    @GetMapping
    @Operation(summary = "List Templates",
            description = "Every bundled starter schema, without SQL bodies. Public.")
    public ResponseEntity<?> list() {
        return ResponseEntity.ok()
                .cacheControl(CATALOGUE_CACHE)
                .body(Map.of(
                        "templates", templateService.list(),
                        "categories", templateService.categories()));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get Template",
            description = "One template including its SQL, so the UI can preview it before applying.")
    public ResponseEntity<?> get(@PathVariable String id) {
        try {
            return ResponseEntity.ok().cacheControl(CATALOGUE_CACHE).body(templateService.get(id));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/apply")
    @Operation(summary = "Apply Template",
            description = "Creates the template's tables and sample rows in the workspace named "
                    + "by X-Workspace-Id. Refused when that workspace already has tables.")
    public ResponseEntity<?> apply(@PathVariable String id) {
        try {
            return ResponseEntity.ok(templateService.apply(id));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Apply template error for {}", id, e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "The template could not be applied."));
        }
    }
}
