package com.dbviewer.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Accounts and share links.
 *
 * <p>The rule being pinned down here is the product one: the app works fully without an account,
 * except for the two actions that take data out of it - exporting and sharing. Both are enforced
 * server-side, so gating only in the UI would not be enough.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite",
        "app.auth.secret=a-test-signing-secret-long-enough-for-hmac"
})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class AuthAndSharingTest {

    private static final String WORKSPACE = "sharetestws";

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;

    private static String token;
    private static String shareToken;

    private String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    // ─── Accounts ─────────────────────────────────────────────────────────────────

    @Test
    @Order(1)
    void signup_shouldReturnAToken() throws Exception {
        String response = mockMvc.perform(post("/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "Sharer@Example.com",
                                "password", "A-good-password", "displayName", "Sharer"))))
                .andExpect(status().isOk())
                // Email is normalised, so casing cannot create a second account.
                .andExpect(jsonPath("$.email").value("sharer@example.com"))
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        token = "Bearer " + objectMapper.readTree(response).get("token").asText();
    }

    @Test
    @Order(2)
    void signup_shouldEnforceThePasswordPolicy() throws Exception {
        // Too short, no capital, no special character - all three reported at once, so the
        // user does not have to discover the rules one failed attempt at a time.
        mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "a@b.com", "password", "short"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("at least 8 characters")))
                .andExpect(jsonPath("$.error", containsString("a capital letter")))
                .andExpect(jsonPath("$.error", containsString("a special character")));

        // Long enough and has a special character, but no capital letter.
        mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "a@b.com", "password", "lowercase-only!"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("a capital letter")))
                .andExpect(jsonPath("$.error", not(containsString("at least 8"))));

        // Has a capital, but nothing outside letters and digits.
        mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "a@b.com", "password", "NoSpecials123"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("a special character")));

        mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "notanemail", "password", "A-good-password"))))
                .andExpect(status().isBadRequest());

    }

    @Test
    @Order(3)
    void signup_withAnExistingEmail_shouldSaySoAndFlagItForTheUi() throws Exception {
        mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "sharer@example.com", "password", "Another-Pass!"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error", containsString("already exists")))
                // The flag is what lets the UI offer "sign in instead" rather than a dead end.
                .andExpect(jsonPath("$.emailAlreadyRegistered").value(true))
                .andExpect(jsonPath("$.email").value("sharer@example.com"));

        // Casing must not create a second account.
        mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "SHARER@Example.COM", "password", "Another-Pass!"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.emailAlreadyRegistered").value(true));

        // An existing address plus a weak password must report the address, not the password:
        // no password would make this signup succeed, so the password is the wrong thing to fix.
        mockMvc.perform(post("/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "sharer@example.com", "password", "weak"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.emailAlreadyRegistered").value(true));

        // And only one row was ever created.
        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("query",
                                "SELECT COUNT(*) c FROM app_users WHERE email='sharer@example.com'"))))
                .andExpect(jsonPath("$.data[0].c").value(1));
    }

    @Test
    @Order(4)
    void login_shouldNotApplyTheSignupPolicyToExistingAccounts() throws Exception {
        // The policy guards new passwords. Applying it at sign-in would lock out an account
        // created before the rule existed.
        mockMvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "sharer@example.com", "password", "A-good-password"))))
                .andExpect(status().isOk());
    }

    @Test
    @Order(5)
    void login_shouldRejectABadPasswordWithoutRevealingWhetherTheUserExists() throws Exception {
        mockMvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "sharer@example.com", "password", "wrong"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Email or password is incorrect."));

        // An unknown address must produce the identical message, or the endpoint becomes a way
        // to discover which emails are registered.
        mockMvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "nobody@example.com", "password", "whatever"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").value("Email or password is incorrect."));
    }

    @Test
    @Order(6)
    void login_withTheRightPassword_shouldSucceed() throws Exception {
        mockMvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("email", "sharer@example.com", "password", "A-good-password"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Sharer"));
    }

    @Test
    @Order(7)
    void passwordsAreHashed_notStored() throws Exception {
        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("query",
                                "SELECT password_hash FROM app_users WHERE email='sharer@example.com'"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].password_hash", startsWith("$2")))
                .andExpect(jsonPath("$.data[0].password_hash", not(containsString("A-good-password"))));
    }

    @Test
    @Order(8)
    void me_shouldBeEmptyWhenAnonymousAndPopulatedWhenSignedIn() throws Exception {
        mockMvc.perform(get("/auth/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").doesNotExist());

        mockMvc.perform(get("/auth/me").header("Authorization", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("sharer@example.com"));
    }

    @Test
    @Order(9)
    void aForgedToken_shouldBeTreatedAsAnonymous() throws Exception {
        mockMvc.perform(get("/auth/me").header("Authorization", "Bearer not.a.real.token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").doesNotExist());
    }

    // ─── Sharing ──────────────────────────────────────────────────────────────────

    @Test
    @Order(10)
    void share_withoutAnAccount_shouldReturn401() throws Exception {
        mockMvc.perform(post("/share")
                        .header("X-Workspace-Id", WORKSPACE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("fileName", "store.sql"))))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/shares")).andExpect(status().isUnauthorized());
    }

    @Test
    @Order(11)
    void share_shouldCreateALinkAndReuseItForTheSameFile() throws Exception {
        mockMvc.perform(post("/create-table")
                        .header("X-Workspace-Id", WORKSPACE)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tableName": "shared_table", "columns": [{"name": "id", "type": "INT", "isPk": true}]}
                                """))
                .andExpect(status().isOk());

        String response = mockMvc.perform(post("/share")
                        .header("X-Workspace-Id", WORKSPACE)
                        .header("Authorization", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("fileName", "store.sql"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        shareToken = objectMapper.readTree(response).get("token").asText();

        // Sharing the same file again must not mint a second token to keep track of.
        mockMvc.perform(post("/share")
                        .header("X-Workspace-Id", WORKSPACE)
                        .header("Authorization", token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("fileName", "store.sql"))))
                .andExpect(jsonPath("$.token").value(shareToken));
    }

    @Test
    @Order(12)
    void viewingASharedLink_shouldBePublic() throws Exception {
        // No Authorization header: the token itself is the credential, otherwise the link
        // could not be handed to anyone.
        mockMvc.perform(get("/share/" + shareToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fileName").value("store.sql"))
                .andExpect(jsonPath("$.sharedBy").value("sharer@example.com"))
                .andExpect(jsonPath("$.tables[*].name", hasItem("shared_table")));
    }

    @Test
    @Order(13)
    void anUnknownShareToken_shouldReturn404() throws Exception {
        mockMvc.perform(get("/share/definitely-not-a-real-token"))
                .andExpect(status().isNotFound());
    }

    @Test
    @Order(14)
    void revoke_shouldMakeTheLinkStopWorking() throws Exception {
        mockMvc.perform(delete("/share/" + shareToken).header("Authorization", token))
                .andExpect(status().isOk());

        mockMvc.perform(get("/share/" + shareToken)).andExpect(status().isNotFound());
    }
}
