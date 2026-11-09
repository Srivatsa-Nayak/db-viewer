/**
 * The backend's own explanation of a failed request, wherever the app needs it.
 *
 * Every error the backend sends is `{"error": "..."}`, and every call site used to dig it out
 * with the same inline cast — fourteen copies across twelve files. One helper means one place to
 * change the day the shape does.
 */

/** The `error` field of a failed Axios response, if there is one. */
export const errorMessage = (err: unknown): string | undefined =>
    err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;

/** As {@link errorMessage}, with a fallback for when the backend said nothing usable. */
export const errorText = (err: unknown, fallback: string): string => errorMessage(err) || fallback;
