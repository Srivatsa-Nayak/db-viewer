package com.dbviewer.app.controller;

import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.llm.ChatTurn;
import com.dbviewer.app.llm.LlmException;
import com.dbviewer.app.llm.StreamResult;
import com.dbviewer.app.service.ApiKeyService;
import com.dbviewer.app.service.ChatService;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
 */
@Slf4j
@RestController
@RequestMapping("/chat")
@RequiredArgsConstructor
@Tag(name = "Chat assistant")
public class ChatController {

    private final ChatService chatService;
    private final ApiKeyService apiKeyService;
    private final ObjectMapper json = new ObjectMapper();

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
            description = "Reports whether a model key is configured, and which one a message "
                    + "would use.")
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
     * configured, an empty question — comes back as an ordinary JSON error with a real status
     * code, which the browser can act on. Only failures that happen mid-answer have to be
     * reported inside the stream, where the status line has already been sent.
     */
    @PostMapping
    @Operation(summary = "Ask the schema assistant",
            description = "Streams the answer as server-sent events: `meta`, then `delta` per "
                    + "fragment, then `done` — or `error`. A failure before the stream starts is "
                    + "an ordinary JSON error instead.")
    public ResponseEntity<StreamingResponseBody> chat(@RequestBody ChatRequest request) {
        AuthContext.require();

        ChatService.ChatPrompt prompt;
        try {
            prompt = chatService.prepare(
                    request == null ? null : request.message(),
                    toTurns(request == null ? null : request.history()));
        } catch (IllegalArgumentException e) {
            return jsonError(400, e.getMessage());
        } catch (IllegalStateException e) {
            // No key anywhere. A configuration problem, not a bad request.
            return jsonError(503, e.getMessage());
        }

        StreamingResponseBody body = out -> {
            try {
                send(out, "meta", Map.of(
                        "provider", prompt.credentials().provider().label(),
                        "model", prompt.credentials().model(),
                        "usingOwnKey", prompt.credentials().ownKey(),
                        "tables", prompt.tableCount(),
                        "schemaTruncated", prompt.truncated()));

                StreamResult result = chatService.stream(prompt, fragment -> {
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
    private ResponseEntity<StreamingResponseBody> jsonError(int status, String message) {
        String payload;
        try {
            payload = json.writeValueAsString(Map.of("error", message));
        } catch (Exception e) {
            payload = "{\"error\":\"The assistant is unavailable.\"}";
        }
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(out -> {
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
            case 402 -> own
                    ? "Your " + provider + " account is out of credit."
                    : "The app's model account is out of credit. Add your own key in your profile "
                            + "to keep going.";
            case 404 -> "The model \"" + prompt.credentials().model() + "\" is not available on "
                    + (own ? "your " : "the app's ") + provider + " account.";
            case 429 -> "Rate limited by " + provider + ". Try again in a moment.";
            default -> e.getStatus() >= 500
                    ? provider + " is having trouble (" + e.getStatus() + "). Try again."
                    : e.getMessage();
        };
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
