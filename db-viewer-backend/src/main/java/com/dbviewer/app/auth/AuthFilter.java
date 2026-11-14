package com.dbviewer.app.auth;

import com.dbviewer.app.service.AuthService;
import com.dbviewer.app.service.JwtService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Binds the caller's identity to {@link AuthContext} for the duration of the request.
 *
 * <p>Never rejects anything: an absent or invalid token simply means anonymous, because almost
 * everything in the app is meant to work without an account. The handful of endpoints that do
 * require one call {@link AuthContext#require()} themselves.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
@RequiredArgsConstructor
public class AuthFilter extends OncePerRequestFilter {

    private static final String HEADER = "Authorization";
    private static final String PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final AuthService authService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            String header = request.getHeader(HEADER);
            if (header != null && header.startsWith(PREFIX)) {
                JwtService.VerifiedToken token = jwtService.verify(header.substring(PREFIX.length()).trim());
                // A token issued before the password last changed is treated like an expired
                // one: the request carries on anonymously, and the UI asks the user to sign in.
                if (token != null && authService.isSessionCurrent(token.email(), token.passwordStamp())) {
                    AuthContext.set(token.email());
                }
            }
            chain.doFilter(request, response);
        } finally {
            // Request threads are pooled, so an identity left behind would leak into the
            // next caller's request.
            AuthContext.clear();
        }
    }
}
