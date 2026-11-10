package com.dbviewer.app.controller;

import com.dbviewer.app.importing.UrlFetcher;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * {@code POST /import/fetch}: download a published schema file so the browser can preview it.
 *
 * <p>Touches no workspace and imports nothing — the browser gets the text back and runs the
 * normal pre-flight preview with it. See {@link UrlFetcher} for why only GitHub is allowed.
 * Rate-limited like every request.
 */
@RestController
@RequiredArgsConstructor
public class ImportFetchController {

    private final UrlFetcher urlFetcher;

    public record FetchRequest(String url) { }

    @PostMapping("/import/fetch")
    @Operation(summary = "Fetch A File To Import",
            description = "Downloads a .sql, .csv or .dbml file from a GitHub gist or repository "
                    + "and returns its name and text. Nothing is imported; the UI previews it first.",
            tags = {"DataFileUpload"})
    public ResponseEntity<?> fetch(@RequestBody FetchRequest request) {
        UrlFetcher.Fetched fetched = urlFetcher.fetch(request == null ? null : request.url());
        return ResponseEntity.ok(Map.of("fileName", fetched.fileName(), "content", fetched.content()));
    }
}
