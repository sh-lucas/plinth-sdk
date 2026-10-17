package dev.shlucas.plinth;

import java.time.Instant;
import java.util.Map;

/** Body of execute, preview and batch operations. Build with {@link #builder()} (execute) or {@link #previewBuilder()}. */
public final class ExecuteRequest {
    private final Map<String, Object> context;
    private final Object inputs;
    private final Instant effectiveAt;
    private final Map<String, Object> metadata;
    private final String memo;
    private final String idempotencyKey;

    private ExecuteRequest(Builder b) {
        this.context = b.context;
        this.inputs = b.inputs;
        this.effectiveAt = b.effectiveAt;
        this.metadata = b.metadata;
        this.memo = b.memo;
        this.idempotencyKey = b.idempotencyKey;
    }

    public Map<String, Object> context() { return context; }
    /** A Map or any Jackson-serializable object (for example a record). */
    public Object inputs() { return inputs; }
    public Instant effectiveAt() { return effectiveAt; }
    public Map<String, Object> metadata() { return metadata; }
    public String memo() { return memo; }
    public String idempotencyKey() { return idempotencyKey; }

    /** Builder for execute: {@code idempotencyKey} is required. */
    public static Builder builder() { return new Builder(true); }

    /** Builder for preview and batch operations: no idempotency key. */
    public static Builder previewBuilder() { return new Builder(false); }

    public static final class Builder {
        private final boolean keyRequired;
        private Map<String, Object> context;
        private Object inputs;
        private Instant effectiveAt;
        private Map<String, Object> metadata;
        private String memo;
        private String idempotencyKey;

        private Builder(boolean keyRequired) { this.keyRequired = keyRequired; }

        public Builder context(Map<String, Object> context) { this.context = context; return this; }
        public Builder contextBucket(String bucket) { this.context = Map.of("bucket", bucket); return this; }
        public Builder contextDomain(String domain) { this.context = Map.of("domain", domain); return this; }
        public Builder inputs(Object inputs) { this.inputs = inputs; return this; }
        public Builder effectiveAt(Instant effectiveAt) { this.effectiveAt = effectiveAt; return this; }
        public Builder metadata(Map<String, Object> metadata) { this.metadata = metadata; return this; }
        public Builder memo(String memo) { this.memo = memo; return this; }
        public Builder idempotencyKey(String key) { this.idempotencyKey = key; return this; }

        public ExecuteRequest build() {
            if (keyRequired && (idempotencyKey == null || idempotencyKey.isEmpty())) {
                throw new IllegalStateException("idempotencyKey is required");
            }
            return new ExecuteRequest(this);
        }
    }
}
