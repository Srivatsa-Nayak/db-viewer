package com.dbviewer.app.controller;

import com.dbviewer.app.auth.RequiresAccount;
import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.llm.ChatTurn;
import com.dbviewer.app.llm.LlmException;
import com.dbviewer.app.llm.StreamResult;
import com.dbviewer.app.llm.Usage;
import com.dbviewer.app.llm.UsageRecorder;
import com.dbviewer.app.ratelimit.RateLimiter;
import com.dbviewer.app.service.ApiKeyService;
import com.dbviewer.app.service.ChatService;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

/**
 * The canvas chat assistant.
 *
 * <p>Answers stream as server-sent events, for the reason every chat UI streams: a schema
 * summary takes ten to twenty seconds to generate in full, and a spinner for twenty seconds
 * reads as a hang while the same twenty seconds spent watching words appear reads as thinking.
 *
 * <p>Account-gated, and enforced here rather than only in the UI. Each message spends real money
 * against whichever key is in play — the application's own by default — which puts it in the
 * same category as export and share links, the two other things that require an account.
 *
 * <h2>Spend control</h2>
 *
 * <p>Accounts are free and instant, so an account alone does not limit anything: a script could
 * sign up and drain the application's key. Questions on the <em>app's</em> key are therefore
 * capped per user per hour and per day, and across everyone per day. The per-user limits are in
 * memory and reset on a restart; the global cap is counted from the persisted usage log, so a
 * redeploy does not hand out a fresh day's budget. A user's <em>own</em> key has a much looser
 * hourly limit, which protects the server's threads rather than anyone's wallet.
 */
@Slf4j
@RestController
@RequestMapping("/chat")
@RequiredArgsConstructor
@Tag(name = "Chat assistant")
public class ChatController {

    private static final Duration HOUR = Duration.ofHours(1);
    private static final Duration DAY = Duration.ofDays(1);

    private final ChatService chatService;
    private final ApiKeyService apiKeyService;
    private final RateLimiter rateLimiter;
    private final UsageRecorder usageRecorder;
    private final ObjectMapper json = new ObjectMapper();

    /** Answers being written right now, per user. */
    private final Map<String, Semaphore> inFlight = new ConcurrentHashMap<>();

    @Value("${app.llm.quota.app-key-per-hour:20}")
    private int appKeyPerHour;

    @Value("${app.llm.quota.app-key-per-day:100}")
    private int appKeyPerDay;

    @Value("${app.llm.quota.app-key-global-per-day:1000}")
    private int appKeyGlobalPerDay;

    @Value("${app.llm.quota.own-key-per-hour:120}")
    private int ownKeyPerHour;

    /**
     * Streams one user may have open at once. Each holds a server thread for as long as the model
     * takes; two allows a second panel or tab without letting one account occupy the pool.
     */
    @Value("${app.llm.max-concurrent-per-user:2}")
    private int maxConcurrentPerUser;

    /** One turn as the browser sends it. */
    public record HistoryTurn(String role, String content) {
    }

    public record ChatRequest(String message, List<HistoryTurn> history) {
    }

    /**
     * Whether the assistant can be used at all, and whose key it would spend.
     *
     * <p>Called when the panel opens. Without it the launcher would have to either always claim
     * to work — and fail on the first message in a deployment with no key configured — or never
     * appear.
     */
    @GetMapping("/config")
    @Operation(summary = "Chat availability",
            description = "Reports whether a model key is configured, which one a message "
                    + "would use, and how many questions are left today on the app's key.")
    public ResponseEntity<?> config() {
        Map<String, Object> result = new LinkedHashMap<>();
        boolean signedIn = AuthContext.isAuthenticated();
        result.put("requiresAccount", true);
        result.put("signedIn", signedIn);

        if (!signedIn) {
            // Nothing else is knowable: whose key applies is a question about an account.
            result.put("available", false);
            return ResponseEntity.ok(result);
        }
        try {
            var credentials = apiKeyService.resolve();
            result.put("available", true);
            result.put("usingOwnKey", credentials.ownKey());
            result.put("providerLabel", credentials.provider().label());
            result.put("model", credentials.model());
            if (!credentials.ownKey() && appKeyPerDay > 0) {
                RateLimiter.Decision today = rateLimiter.peek(
                        dayKey(AuthContext.get()), appKeyPerDay, DAY);
                result.put("quota", Map.of("limit", today.limit(), "remaining", today.remaining()));
            }
        } catch (IllegalStateException e) {
            result.put("available", false);
            result.put("error", e.getMessage());
        }
        return ResponseEntity.ok(result);
    }

    /**
     * Streams an answer.
     *
     * <p>The prompt is built <em>before</em> the streaming body is returned, and that ordering is
     * required rather than tidy. {@link StreamingResponseBody} is written on a container thread
     * after the request has gone async, by which point the servlet filters have unwound and the
     * thread-locals holding the signed-in user and the active workspace are gone — so reading the
     * schema from inside the stream would read the wrong database, or none.
     *
     * <p>It also means a failure that happens before the first byte — no account, no key
     * configured, an empty question, a spent quota — comes back as an ordinary JSON error with a
     * real status code, which the browser can act on. Only failures that happen mid-answer have
     * to be reported inside the stream, where the status line has already been sent.
     */
    @RequiresAccount
    @PostMapping
    @Operation(summary = "Ask the schema assistant",
            description = "Streams the answer as server-sent events: `meta`, then `delta` per "
                    + "fragment, then `done` — or `error`. A failure before the stream starts is "
                    + "an ordinary JSON error instead; 429 means a limit was reached.")
    public ResponseEntity<StreamingResponseBody> chat(@RequestBody ChatRequest request) {
        String email = AuthContext.require();

        ChatService.ChatPrompt prompt;
        try {
            prompt = chatService.prepare(
                    request == null ? null : request.message(),
                    toTurns(request == null ? null : request.history()));
        } catch (IllegalArgumentException e) {
            return jsonError(400, e.getMessage(), null);
        } catch (IllegalStateException e) {
            // No usable key anywhere. A configuration problem, not a bad request.
            return jsonError(503, e.getMessage(), null);
        }

        Semaphore slots = inFlight.computeIfAbsent(email, k -> new Semaphore(maxConcurrentPerUser));
        if (!slots.tryAcquire()) {
            return jsonError(429, "You already have " + maxConcurrentPerUser
                    + " answers being written. Wait for one to finish, or stop it.", 5L);
        }

        List<String> charged;
        try {
            charged = chargeQuota(email, prompt.credentials().ownKey());
        } catch (QuotaExceeded e) {
            slots.release();
            return jsonError(429, e.getMessage(), e.retryAfterSeconds);
        }

        StreamingResponseBody body = out -> {
            long started = System.currentTimeMillis();
            StreamResult result = null;
            try {
                send(out, "meta", Map.of(
                        "provider", prompt.credentials().provider().label(),
                        "model", prompt.credentials().model(),
                        "usingOwnKey", prompt.credentials().ownKey(),
                        "tables", prompt.tableCount(),
                        "schemaTruncated", prompt.truncated(),
                        "omittedTables", prompt.omittedTables().size()));

                result = chatService.stream(prompt, fragment -> {
                    try {
                        send(out, "delta", Map.of("text", fragment));
                    } catch (IOException e) {
                        // The browser has gone. Unwrapped below and treated as a normal end.
                        throw new ClientGoneException(e);
                    }
                });

                if (result.refused()) {
                    // Said in words: an empty or partial bubble would read as a glitch.
                    send(out, "error", Map.of("message",
                            "The model declined to answer that. Try rephrasing the question."));
                } else if (result.characters() == 0) {
                    send(out, "error", Map.of("message", result.truncated()
                            ? "The model ran out of room before it started answering. Ask a "
                                    + "narrower question, or raise app.llm.max-tokens."
                            : "The model returned an empty answer. Try asking again."));
                } else {
                    // `truncated` is what lets the UI say the answer was cut off, instead of
                    // presenting half a CREATE TABLE as a finished reply.
                    send(out, "done", Map.of(
                            "characters", result.characters(),
                            "truncated", result.truncated()));
                }
            } catch (ClientGoneException e) {
                log.debug("Chat client disconnected mid-answer");
            } catch (LlmException e) {
                log.warn("Chat failed ({}): {}", e.getStatus(), e.getMessage());
                trySend(out, "error", Map.of("message", describe(e, prompt)));
            } catch (Exception e) {
                log.error("Chat failed", e);
                trySend(out, "error", Map.of("message", "Something went wrong answering that."));
            } finally {
                slots.release();
                if (result == null || result.characters() == 0) {
                    // Nothing was answered, so nothing is counted against the user — a provider
                    // outage should not use up anyone's questions for the day.
                    charged.forEach(rateLimiter::release);
                }
                if (result != null) {
                    usageRecorder.record(prompt.userEmail(), prompt.credentials(),
                            result.usage() == null ? Usage.NONE : result.usage(),
                            System.currentTimeMillis() - started);
                }
            }
        };

        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .header(HttpHeaders.CACHE_CONTROL, "no-cache, no-transform")
                // Nginx buffers proxied responses by default, which holds every fragment until
                // the answer is complete and turns a stream back into a wait.
                .header("X-Accel-Buffering", "no")
                .body(body);
    }

    /* ------------------------------------------------------------------ *
     * Quota
     * ------------------------------------------------------------------ */

    private static final class QuotaExceeded extends RuntimeException {
        final long retryAfterSeconds;

        QuotaExceeded(String message, long retryAfterSeconds) {
            super(message);
            this.retryAfterSeconds = retryAfterSeconds;
        }
    }

    private static String hourKey(String email) {
        return "chat:hour:" + email;
    }

    private static String dayKey(String email) {
        return "chat:day:" + email;
    }

    private static String ownKeyHourKey(String email) {
        return "chat:own:hour:" + email;
    }

    /**
     * Counts this question against the limits that apply, or refuses it.
     *
     * @return the limiter keys that were charged, so a question that produces no answer can be
     *         given back
     */
    private List<String> chargeQuota(String email, boolean ownKey) {
        List<String> charged = new ArrayList<>();
        if (ownKey) {
            RateLimiter.Decision hour = rateLimiter.tryAcquire(ownKeyHourKey(email), ownKeyPerHour, HOUR);
            if (!hour.allowed()) {
                throw new QuotaExceeded("That is " + ownKeyPerHour + " questions this hour. Try again in "
                        + minutes(hour.retryAfterSeconds()) + ".", hour.retryAfterSeconds());
            }
            charged.add(ownKeyHourKey(email));
            return charged;
        }

        if (appKeyGlobalPerDay > 0 && usageRecorder.appKeyRequestsToday() >= appKeyGlobalPerDay) {
            throw new QuotaExceeded("The assistant has answered as many questions on the app's key "
                    + "as it can today. Add your own API key in your profile to keep going.",
                    secondsUntilUtcMidnight());
        }
        RateLimiter.Decision hour = rateLimiter.tryAcquire(hourKey(email), appKeyPerHour, HOUR);
        if (!hour.allowed()) {
            throw new QuotaExceeded("You have asked " + appKeyPerHour + " questions this hour on the "
                    + "app's key. Try again in " + minutes(hour.retryAfterSeconds())
                    + ", or add your own API key in your profile.", hour.retryAfterSeconds());
        }
        charged.add(hourKey(email));
        RateLimiter.Decision day = rateLimiter.tryAcquire(dayKey(email), appKeyPerDay, DAY);
        if (!day.allowed()) {
            rateLimiter.release(hourKey(email));
            throw new QuotaExceeded("You have used today's " + appKeyPerDay + " questions on the "
                    + "app's key. Add your own API key in your profile to keep going.",
                    day.retryAfterSeconds());
        }
        charged.add(dayKey(email));
        return charged;
    }

    private static String minutes(long seconds) {
        long m = Math.max(1, (seconds + 59) / 60);
        return m == 1 ? "a minute" : m + " minutes";
    }

    private static long secondsUntilUtcMidnight() {
        long now = System.currentTimeMillis() / 1000;
        return 86_400 - (now % 86_400);
    }

    /* ------------------------------------------------------------------ *
     * Responses
     * ------------------------------------------------------------------ */

    /**
     * A JSON error, wrapped in the streaming body type the method has to declare.
     *
     * <p>The wrapping is not decoration. Spring decides whether a handler streams by looking at
     * the <em>declared</em> return type, so {@code ResponseEntity<?>} silently falls back to the
     * message converters and fails with "No converter for … with preset Content-Type
     * text/event-stream". Declaring {@code ResponseEntity<StreamingResponseBody>} fixes that and
     * costs this: an error before the stream begins has to be written as bytes too. It is still
     * an ordinary JSON response with a real status code, which is what the browser needs.
     */
    private ResponseEntity<StreamingResponseBody> jsonError(int status, String message,
                                                            Long retryAfterSeconds) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("error", message);
        if (retryAfterSeconds != null) {
            payload.put("retryAfter", retryAfterSeconds);
        }
        String text;
        try {
            text = json.writeValueAsString(payload);
        } catch (Exception e) {
            text = "{\"error\":\"The assistant is unavailable.\"}";
        }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON);
        if (retryAfterSeconds != null) {
            builder.header(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfterSeconds));
        }
        return builder.body(out -> {
            out.write(bytes);
            out.flush();
        });
    }

    /** Signals that the client closed the connection; not an error worth reporting. */
    private static final class ClientGoneException extends RuntimeException {
        ClientGoneException(Throwable cause) {
            super(cause);
        }
    }

    /**
     * Turns a provider failure into something the user can act on.
     *
     * <p>Which advice applies depends on whose key it is: a 401 on the user's own key means they
     * should re-enter it, while a 401 on the application's key is an operator's problem and
     * telling the user to check their key would send them to an empty field.
     */
    private String describe(LlmException e, ChatService.ChatPrompt prompt) {
        boolean own = prompt.credentials().ownKey();
        String provider = prompt.credentials().provider().label();
        return switch (e.getStatus()) {
            case 401, 403 -> own
                    ? provider + " rejected your API key. Re-enter it in your profile."
                    : "The app's model key was rejected. This is a server configuration problem.";
            // The provider's own words, because "out of credit" was often wrong: OpenRouter also
            // answers 402 when the key's credit or per-key limit cannot cover max_tokens, which a
            // top-up or a higher key limit fixes but a new key does not.
            case 402 -> own
                    ? provider + " would not run this on your key: " + paymentReason(e, true)
                    : "The app's model key cannot pay for this request (" + paymentReason(e, false)
                            + "). Add your own key in your profile to keep going.";
            case 404 -> "The model \"" + prompt.credentials().model() + "\" is not available on "
                    + (own ? "your " : "the app's ") + provider + " account.";
            case 429 -> "Rate limited by " + provider + ". Try again in a moment.";
            default -> e.getStatus() >= 500
                    ? provider + " is having trouble (" + e.getStatus() + "). Try again."
                    : e.getMessage();
        };
    }

    /**
     * The provider's explanation of a 402, for showing to the user.
     *
     * <p>On the app's key the "To increase, visit …" sentence is dropped: it links to that key's
     * settings page, which is the operator's business and identifies the key.
     */
    static String paymentReason(LlmException e, boolean ownKey) {
        String message = e.getMessage() == null ? "" : e.getMessage().strip();
        if (!ownKey) {
            int link = message.toLowerCase().indexOf("to increase, visit");
            if (link >= 0) {
                message = message.substring(0, link).strip();
            }
        }
        if (message.isEmpty() || message.startsWith("HTTP ")) {
            return "the account is out of credit";
        }
        return message.endsWith(".") ? message.substring(0, message.length() - 1) : message;
    }

    private List<ChatTurn> toTurns(List<HistoryTurn> history) {
        return history == null
                ? List.of()
                : history.stream()
                        .filter(t -> t != null)
                        .map(t -> new ChatTurn(t.role(), t.content()))
                        .toList();
    }

    /* ------------------------------------------------------------------ *
     * Server-sent events
     * ------------------------------------------------------------------ */

    private void send(OutputStream out, String event, Map<String, Object> data) throws IOException {
        String frame = "event: " + event + "\ndata: " + json.writeValueAsString(data) + "\n\n";
        out.write(frame.getBytes(StandardCharsets.UTF_8));
        // Flushed per frame, which is the entire point: buffering would deliver the whole answer
        // at once and make the stream indistinguishable from a slow request.
        out.flush();
    }

    /** A last-gasp error frame. If even this fails the connection is gone, and so is the user. */
    private void trySend(OutputStream out, String event, Map<String, Object> data) {
        try {
            send(out, event, data);
        } catch (IOException ignored) {
            log.debug("Could not deliver the {} frame; the client had already gone", event);
        }
    }
}
