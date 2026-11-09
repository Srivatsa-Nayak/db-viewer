package com.dbviewer.app.auth;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a handler that only a signed-in user may call.
 *
 * <p>Enforced by {@link RequiresAccountInterceptor} before the handler runs, and answered with
 * 401. It exists because the old rule — "remember to call {@code AuthContext.require()} first" —
 * was enforced by nothing: {@code POST /query} forgot, and ran arbitrary SQL for anyone. A
 * declaration on the mapping is visible in review, and {@code RequiresAccountTest} checks every
 * annotated route actually refuses an anonymous caller.
 *
 * <p>Handlers keep their own {@code require()} calls too, where they need the email: the
 * annotation is the gate, the call is how the handler learns who is asking.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface RequiresAccount {
}
