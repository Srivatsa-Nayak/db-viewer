package com.dbviewer.app.importing;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The address rules, which are the security boundary. No network. */
class UrlFetcherTest {

    @Test
    void aRepositoryPageBecomesItsRawFile() {
        assertThat(UrlFetcher.toRawUri("https://github.com/acme/shop/blob/main/db/schema.sql"))
                .hasToString("https://raw.githubusercontent.com/acme/shop/main/db/schema.sql");
    }

    @Test
    void aGistPageBecomesItsFirstRawFile() {
        assertThat(UrlFetcher.toRawUri("https://gist.github.com/someone/0123456789abcdef"))
                .hasToString("https://gist.githubusercontent.com/someone/0123456789abcdef/raw");
    }

    @Test
    void rawAddressesPassThrough_withoutTheirQuery() {
        assertThat(UrlFetcher.toRawUri("https://raw.githubusercontent.com/acme/shop/main/a.dbml?token=x"))
                .hasToString("https://raw.githubusercontent.com/acme/shop/main/a.dbml");
    }

    @Test
    void anyOtherHostIsRefused() {
        assertThatThrownBy(() -> UrlFetcher.toRawUri("https://example.com/schema.sql"))
                .hasMessageContaining("Only GitHub");
        // The classic targets of a forged server-side request.
        assertThatThrownBy(() -> UrlFetcher.toRawUri("https://169.254.169.254/latest/meta-data.sql"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> UrlFetcher.toRawUri("https://localhost/schema.sql"))
                .isInstanceOf(IllegalArgumentException.class);
        // A look-alike host is not GitHub.
        assertThatThrownBy(() -> UrlFetcher.toRawUri("https://raw.githubusercontent.com.evil.test/a.sql"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void onlyHttpsOnTheDefaultPort_andNoCredentials() {
        assertThatThrownBy(() -> UrlFetcher.toRawUri("http://raw.githubusercontent.com/a/b/main/x.sql"))
                .hasMessageContaining("https");
        assertThatThrownBy(() -> UrlFetcher.toRawUri("https://raw.githubusercontent.com:8443/a/b/main/x.sql"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> UrlFetcher.toRawUri("https://user:pw@raw.githubusercontent.com/a/b/main/x.sql"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> UrlFetcher.toRawUri("file:///etc/passwd"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void onlyTheFormatsTheImporterReads() {
        assertThatThrownBy(() -> UrlFetcher.toRawUri("https://raw.githubusercontent.com/a/b/main/run.sh"))
                .hasMessageContaining(".sql");
        assertThat(UrlFetcher.toRawUri("https://raw.githubusercontent.com/a/b/main/data.csv")).isNotNull();
    }

    @Test
    void blankAndMalformedAddressesSaySo() {
        assertThatThrownBy(() -> UrlFetcher.toRawUri("  ")).hasMessageContaining("Paste");
        assertThatThrownBy(() -> UrlFetcher.toRawUri("not a url")).isInstanceOf(IllegalArgumentException.class);
    }
}
