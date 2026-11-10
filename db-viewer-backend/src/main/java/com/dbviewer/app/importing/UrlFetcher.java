package com.dbviewer.app.importing;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Downloads a schema file someone has published — a GitHub gist or a file in a GitHub repository
 * — so it can be imported without saving it to disk first.
 *
 * <p>The server fetching a URL a visitor typed is the textbook server-side request forgery
 * setup, so this is deliberately narrow rather than general:
 * <ul>
 *   <li><strong>HTTPS to an allow-list of hosts only</strong> — GitHub's raw-content hosts. A
 *       {@code github.com/.../blob/...} or {@code gist.github.com/...} page URL is rewritten to
 *       its raw form first, because that is what people copy from the address bar. No user-chosen
 *       host is ever contacted, so there is no route to an internal address.</li>
 *   <li><strong>No redirects</strong>, so an allowed host cannot bounce the request elsewhere.</li>
 *   <li><strong>A size cap and a timeout</strong>, so one URL cannot hold a request thread or
 *       fill memory on a small instance.</li>
 *   <li><strong>Only {@code .sql}, {@code .csv} and {@code .dbml}</strong>, the formats the
 *       importer reads.</li>
 * </ul>
 * Nothing is imported here: the content goes back to the browser, which runs the usual
 * pre-flight preview with it.
 */
@Component
public class UrlFetcher {

    /** Larger than any schema dump a person pastes a link to; far below the upload limit. */
    static final int MAX_BYTES = 5 * 1024 * 1024;
    private static final Duration TIMEOUT = Duration.ofSeconds(15);

    private static final Set<String> RAW_HOSTS = Set.of(
            "raw.githubusercontent.com", "gist.githubusercontent.com");
    private static final Set<String> EXTENSIONS = Set.of(".sql", ".csv", ".dbml");

    /** {@code https://github.com/{owner}/{repo}/blob/{ref}/{path}}. */
    private static final Pattern GITHUB_BLOB =
            Pattern.compile("^/([^/]+)/([^/]+)/blob/(.+)$");
    /** {@code https://gist.github.com/{user}/{id}} or {@code /{id}}. */
    private static final Pattern GIST_PAGE =
            Pattern.compile("^/(?:([^/]+)/)?([0-9a-fA-F]{6,})/?$");

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public record Fetched(String fileName, String content) { }

    public Fetched fetch(String url) {
        URI uri = toRawUri(url);
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(TIMEOUT)
                .header("User-Agent", "sql-visualizer-import")
                .GET()
                .build();
        HttpResponse<InputStream> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            throw new IllegalArgumentException("Could not reach " + uri.getHost() + ": " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalArgumentException("The download was interrupted.");
        }

        int status = response.statusCode();
        if (status == 404) {
            throw new IllegalArgumentException(
                    "Nothing at that address. Is the gist or repository public?");
        }
        if (status != 200) {
            throw new IllegalArgumentException("GitHub answered " + status + " for that address.");
        }

        byte[] body;
        try (InputStream in = response.body()) {
            body = in.readNBytes(MAX_BYTES + 1);
        } catch (IOException e) {
            throw new IllegalArgumentException("The download failed part way: " + e.getMessage());
        }
        if (body.length > MAX_BYTES) {
            throw new IllegalArgumentException("That file is over " + (MAX_BYTES / (1024 * 1024))
                    + " MB. Download it and use Import instead.");
        }
        return new Fetched(fileNameOf(uri), new String(body, StandardCharsets.UTF_8));
    }

    /**
     * The raw-content address for a URL, or an {@link IllegalArgumentException} saying why it is
     * not one this will fetch. Package-visible so the rules can be tested without a network.
     */
    static URI toRawUri(String url) {
        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("Paste the address of a file to import.");
        }
        URI uri;
        try {
            uri = new URI(url.trim());
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("That is not a valid address.");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
            throw new IllegalArgumentException("Only https:// addresses can be imported.");
        }
        if (uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) {
            throw new IllegalArgumentException("That address cannot be imported.");
        }

        String host = uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();

        if (host.equals("github.com") || host.equals("www.github.com")) {
            Matcher blob = GITHUB_BLOB.matcher(path);
            if (!blob.matches()) {
                throw new IllegalArgumentException(
                        "Link to a single file in the repository (its page, or the Raw button).");
            }
            uri = URI.create("https://raw.githubusercontent.com/" + blob.group(1) + "/"
                    + blob.group(2) + "/" + blob.group(3));
        } else if (host.equals("gist.github.com")) {
            Matcher gist = GIST_PAGE.matcher(path);
            if (!gist.matches() || gist.group(1) == null) {
                throw new IllegalArgumentException(
                        "Use the gist's Raw button, or its address with your user name in it.");
            }
            // `/raw` with no file name is the gist's first (usually only) file.
            uri = URI.create("https://gist.githubusercontent.com/" + gist.group(1) + "/"
                    + gist.group(2) + "/raw");
        } else if (!RAW_HOSTS.contains(host)) {
            throw new IllegalArgumentException(
                    "Only GitHub gists and files in GitHub repositories can be imported by address.");
        }

        if (uri.getRawQuery() != null || uri.getRawFragment() != null) {
            uri = URI.create(uri.getScheme() + "://" + uri.getHost() + uri.getRawPath());
        }
        String name = fileNameOf(uri).toLowerCase(Locale.ROOT);
        // A gist's bare /raw has no name to check; the content decides at preview time.
        boolean bareGistRaw = uri.getHost().equals("gist.githubusercontent.com") && name.equals("raw");
        if (!bareGistRaw && EXTENSIONS.stream().noneMatch(name::endsWith)) {
            throw new IllegalArgumentException("Only .sql, .csv and .dbml files can be imported.");
        }
        return uri;
    }

    static String fileNameOf(URI uri) {
        String path = uri.getPath() == null ? "" : uri.getPath();
        String last = path.substring(path.lastIndexOf('/') + 1);
        return last.isBlank() ? "imported.sql" : last;
    }
}
