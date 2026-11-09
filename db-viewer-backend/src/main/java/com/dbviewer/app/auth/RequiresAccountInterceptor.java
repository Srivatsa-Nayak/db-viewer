package com.dbviewer.app.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Refuses an anonymous caller on any handler marked {@link RequiresAccount}.
 *
 * <p>Writes the 401 itself rather than throwing, because several of the guarded handlers catch
 * every exception and would turn the refusal into a 500; refusing before the handler is invoked
 * means none of them ever sees it.
 */
@Component
public class RequiresAccountInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (!(handler instanceof HandlerMethod method) || !requiresAccount(method)) {
            return true;
        }
        // A streamed answer ends with an async re-dispatch of the same request. It was already
        // checked on the way in, and the auth filter does not run again for it, so checking here
        // would append a 401 to a finished stream.
        if (request.getDispatcherType() == jakarta.servlet.DispatcherType.ASYNC) {
            return true;
        }
        if (AuthContext.isAuthenticated()) {
            return true;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"Create a free account to use this feature.\"}");
        return false;
    }

    static boolean requiresAccount(HandlerMethod method) {
        return method.hasMethodAnnotation(RequiresAccount.class)
                || method.getBeanType().isAnnotationPresent(RequiresAccount.class);
    }
}
