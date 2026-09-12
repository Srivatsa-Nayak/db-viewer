package com.dbviewer.app.service.impl;

import com.dbviewer.app.service.DatabaseService;
import com.dbviewer.app.service.TemplateService;
import com.dbviewer.app.template.TemplateSchemaParser;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Serves the bundled starter schemas.
 *
 * <p>Templates live entirely on the backend: a {@code .sql} file plus an entry in
 * {@code templates/manifest.json}. The frontend only renders what this returns, so adding a
 * template never needs a frontend change or release.
 *
 * <p>Table names and relationship counts are <b>derived from the SQL</b> rather than repeated in
 * the manifest, so the numbers on a template card cannot drift away from what the template
 * actually creates.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TemplateServiceImpl implements TemplateService {

    private static final String DIRECTORY = "templates/";

    private final DatabaseService databaseService;
    private final ObjectMapper objectMapper;

    /** Parsed once at startup - the manifest and the SQL files are immutable build artifacts. */
    private final Map<String, Template> templates = new LinkedHashMap<>();

    /** Manifest entry as authored in templates/manifest.json. */
    private record ManifestEntry(
            String id, String name, String description, String category,
            List<String> tags, boolean featured) {
    }

    @PostConstruct
    void load() {
        try (var in = new ClassPathResource(DIRECTORY + "manifest.json").getInputStream()) {
            List<ManifestEntry> entries = objectMapper.readValue(
                    in, objectMapper.getTypeFactory()
                            .constructCollectionType(List.class, ManifestEntry.class));

            for (ManifestEntry entry : entries) {
                try {
                    templates.put(entry.id(), build(entry));
                } catch (Exception e) {
                    // One unreadable template must not take the whole catalogue - and the app -
                    // down with it.
                    log.error("Skipping template '{}': {}", entry.id(), e.getMessage());
                }
            }
            log.info("Loaded {} schema templates", templates.size());
        } catch (Exception e) {
            log.error("Could not read the template manifest; no templates will be offered", e);
        }
    }

    private Template build(ManifestEntry entry) throws Exception {
        String sql;
        try (var in = new ClassPathResource(DIRECTORY + entry.id() + ".sql").getInputStream()) {
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }

        // Everything measurable is derived from the parsed schema rather than counted by
        // scanning the file. Text-scanning previously miscounted twice, because the phrase
        // "foreign key" also occurs in a header comment and in sample data (a task titled
        // "Draw foreign key edges"), and both were read as real relationships.
        TemplateSchema schema = TemplateSchemaParser.parse(sql);
        List<String> tables = schema.tables().stream().map(TemplateTable::name).toList();

        return new Template(entry.id(), entry.name(), entry.description(), entry.category(),
                entry.tags() == null ? List.of() : entry.tags(), entry.featured(),
                tables, tables.size(), schema.relationships().size(), sql, schema);
    }

    /** Every template, without SQL bodies. */
    @Override
    public List<Template> list() {
        return templates.values().stream().map(Template::summary).toList();
    }

    /** One template including its SQL, so the UI can show a preview before applying it. */
    @Override
    public Template get(String id) {
        Template template = templates.get(id);
        if (template == null) {
            throw new IllegalArgumentException("No template called \"" + id + "\".");
        }
        return template;
    }

    /** The distinct categories, in the order they first appear in the manifest. */
    @Override
    public List<String> categories() {
        return templates.values().stream()
                .map(Template::category)
                .filter(c -> c != null && !c.isBlank())
                .distinct()
                .toList();
    }

    /**
     * Runs a template into the workspace on the current request.
     *
     * <p>Delegates to the same executor the .sql upload path uses, so a template behaves exactly
     * like a file the user imported themselves.
     */
    @Override
    public Map<String, Object> apply(String id) {
        Template template = get(id);
        Map<String, Object> result = new LinkedHashMap<>(databaseService.runScript(template.sql()));
        result.put("templateId", template.id());
        result.put("templateName", template.name());
        return result;
    }
}
