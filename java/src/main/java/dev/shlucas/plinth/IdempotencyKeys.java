package dev.shlucas.plinth;

import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public final class IdempotencyKeys {
    private IdempotencyKeys() {}

    /** Join the non-empty parts with ':'. Never adds randomness. */
    public static String of(Object... parts) {
        return Stream.of(parts)
                .filter(Objects::nonNull)
                .map(Object::toString)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.joining(":"));
    }
}
